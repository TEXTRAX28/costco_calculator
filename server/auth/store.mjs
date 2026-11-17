import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { AuthError } from "./errors.mjs";

const hash = (token) => createHash("sha256").update(token).digest();
export const newToken = () => randomBytes(32).toString("base64url");

async function lockIdentity(db, { issuer, subject }) {
  await db.query(
    "INSERT INTO gather_identities(issuer, subject) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [issuer, subject],
  );
  const { rows } = await db.query(
    "SELECT user_id, blocked_until, reject_auth_through FROM gather_identities WHERE issuer = $1 AND subject = $2 FOR UPDATE",
    [issuer, subject],
  );
  return rows[0];
}

export function accountStore(database, config, now = Date.now) {
  const sessionInfo = (row) => ({
    user: { id: row.user_id, email: row.email },
    createdAt: Number(row.created_at),
    expiresAt: Math.min(
      Number(row.expires_at),
      Number(row.last_seen) + config.idleMs,
    ),
  });

  return {
    async ready() {
      const { rows } = await database.query(
        "SELECT max(version) AS version FROM gather_schema_version",
      );
      return rows[0]?.version === 1;
    },

    async createSession(identity, previousToken) {
      const token = newToken();
      const session = await database.transaction(async (db) => {
        const { issuer, subject, email, authenticatedAt } = identity;
        const bound = await lockIdentity(db, identity);
        const time = now();
        if (
          Number(bound.blocked_until) > time ||
          (Number(bound.reject_auth_through) &&
            authenticatedAt <= Number(bound.reject_auth_through))
        )
          throw new AuthError("sign_in_failed");
        const userId = bound.user_id || randomUUID();
        if (!bound.user_id)
          await db.query(
            "INSERT INTO gather_users(id, created_at) VALUES ($1, $2)",
            [userId, time],
          );
        await db.query(
          "UPDATE gather_identities SET user_id = $3, email = $4 WHERE issuer = $1 AND subject = $2",
          [issuer, subject, userId, email],
        );
        if (previousToken)
          await db.query("DELETE FROM gather_sessions WHERE token_hash = $1", [
            hash(previousToken),
          ]);
        const expiresAt = time + config.absoluteMs;
        await db.query(
          `INSERT INTO gather_sessions(token_hash, user_id, issuer, subject, created_at, last_seen, expires_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6)`,
          [hash(token), userId, issuer, subject, time, expiresAt],
        );
        return sessionInfo({
          user_id: userId,
          email,
          created_at: time,
          last_seen: time,
          expires_at: expiresAt,
        });
      });
      return { token, session };
    },

    async session(token, touch = false) {
      if (!token) return null;
      const time = now();
      const predicate =
        "s.token_hash = $1 AND s.expires_at > $2 AND s.last_seen > $3";
      const params = [hash(token), time, time - config.idleMs];
      const { rows } = touch
        ? await database.query(
            `UPDATE gather_sessions AS s SET last_seen = greatest(s.last_seen, $2::bigint)
             FROM gather_identities AS i
             WHERE ${predicate} AND i.issuer = s.issuer AND i.subject = s.subject
             RETURNING s.user_id, i.email, s.created_at, s.last_seen, s.expires_at`,
            params,
          )
        : await database.query(
            `SELECT s.user_id, i.email, s.created_at, s.last_seen, s.expires_at
             FROM gather_sessions AS s JOIN gather_identities AS i USING (issuer, subject)
             WHERE ${predicate}`,
            params,
          );
      return rows[0] ? sessionInfo(rows[0]) : null;
    },

    async signOut(token) {
      if (token)
        await database.query(
          "DELETE FROM gather_sessions WHERE token_hash = $1",
          [hash(token)],
        );
    },

    async revokeUser(userId) {
      await database.transaction(async (db) => {
        await db.query(
          "SELECT issuer FROM gather_identities WHERE user_id = $1 ORDER BY issuer, subject FOR UPDATE",
          [userId],
        );
        await db.query(
          "UPDATE gather_identities SET reject_auth_through = greatest(reject_auth_through, $2::bigint) WHERE user_id = $1",
          [userId, now()],
        );
        await db.query("DELETE FROM gather_sessions WHERE user_id = $1", [
          userId,
        ]);
      });
    },

    async beginRecovery(identity) {
      await database.transaction(async (db) => {
        const bound = await lockIdentity(db, identity);
        const time = now();
        if (Number(bound.blocked_until) > time)
          throw new AuthError("throttled");
        await db.query(
          `UPDATE gather_identities
           SET blocked_until = $3, reject_auth_through = greatest(reject_auth_through, $3::bigint)
           WHERE issuer = $1 AND subject = $2`,
          [identity.issuer, identity.subject, time + 35_000],
        );
        if (bound.user_id)
          await db.query("DELETE FROM gather_sessions WHERE user_id = $1", [
            bound.user_id,
          ]);
      });
    },

    async finishRecovery(identity) {
      await database.query(
        `UPDATE gather_identities
         SET reject_auth_through = CASE WHEN reject_auth_through = blocked_until THEN $3
                                        ELSE greatest(reject_auth_through, $3::bigint) END,
             blocked_until = 0
         WHERE issuer = $1 AND subject = $2`,
        [identity.issuer, identity.subject, now()],
      );
    },

    async allow(buckets) {
      const time = now();
      const entries = buckets.map(({ scope, value, windowMs, maximum }) => ({
        key: createHmac("sha256", config.rateKey)
          .update(scope + "\0" + value)
          .digest(),
        end: Math.floor(time / windowMs) * windowMs + windowMs,
        maximum,
      }));
      // Every instance acquires shared buckets in the same order.
      entries.sort((a, b) => Buffer.compare(a.key, b.key));
      return database.transaction(async (db) => {
        let allowed = true;
        for (const { key, end, maximum } of entries) {
          const { rows } = await db.query(
            `INSERT INTO gather_auth_limits(bucket_key, window_end, attempts) VALUES ($1, $2, 1)
             ON CONFLICT (bucket_key, window_end) DO UPDATE
             SET attempts = least(gather_auth_limits.attempts + 1, 10000)
             RETURNING attempts`,
            [key, end],
          );
          if (rows[0].attempts > maximum) allowed = false;
        }
        return allowed;
      });
    },

    async addOAuth(token, attempt, destination) {
      await database.query(
        `INSERT INTO gather_oauth_attempts(token_hash, state, nonce, verifier, destination, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          hash(token),
          attempt.state,
          attempt.nonce,
          attempt.verifier,
          destination,
          now() + 10 * 60_000,
        ],
      );
    },

    async takeOAuth(token) {
      if (!token) return null;
      const { rows } = await database.query(
        "DELETE FROM gather_oauth_attempts WHERE token_hash = $1 AND expires_at > $2 RETURNING state, nonce, verifier, destination",
        [hash(token), now()],
      );
      return rows[0] || null;
    },

    async prune() {
      const time = now();
      await database.transaction(async (db) => {
        await db.query(
          "DELETE FROM gather_sessions WHERE expires_at <= $1 OR last_seen <= $2",
          [time, time - config.idleMs],
        );
        await db.query(
          "DELETE FROM gather_oauth_attempts WHERE expires_at <= $1",
          [time],
        );
        await db.query(
          "DELETE FROM gather_auth_limits WHERE window_end <= $1",
          [time],
        );
        await db.query(
          "DELETE FROM gather_identities WHERE user_id IS NULL AND blocked_until < $1 AND reject_auth_through < $1",
          [time - 86_400_000],
        );
      });
    },
  };
}
