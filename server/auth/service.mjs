import { setTimeout as delay } from "node:timers/promises";
import { AuthError } from "./errors.mjs";
import { identitySchema } from "./identity.mjs";
import { newToken } from "./store.mjs";

const minute = 60_000;
const rules = {
  sign_in: [12, 1, 8, 15],
  mail: [15, 60, 6, 60],
  verify: [16, 15, 6, 60],
  reset: [12, 15, 6, 60],
  google: [12, 15],
  save: [60, 1, 30, 1],
};

export function safeDestination(value) {
  return value === "/?account=1" ? value : "/";
}

export function accountService({
  store,
  password,
  google,
  config,
  now = Date.now,
  minimumDelay = 850,
}) {
  const invited = (email) =>
    !config.allowedEmail || email === config.allowedEmail;
  function checkPassword(password) {
    if (config.compromisedPasswords?.has(password))
      throw new AuthError("compromised_password", "password");
  }

  async function throttle(action, ip, account) {
    const [networkLimit, networkMinutes, accountLimit, accountMinutes] =
      rules[action];
    const buckets = [
      {
        scope: action + ":ip",
        value: ip,
        windowMs: networkMinutes * minute,
        maximum: networkLimit,
      },
    ];
    if (account && accountLimit)
      buckets.push({
        scope: action + ":user",
        value: account,
        windowMs: accountMinutes * minute,
        maximum: accountLimit,
      });
    if (!(await store.allow(buckets))) throw new AuthError("throttled");
  }

  async function throttleActionAccount(action, value) {
    const [, , maximum, minutes] = rules[action];
    if (
      !(await store.allow([
        { scope: action + ":user", value, windowMs: minutes * minute, maximum },
      ]))
    )
      throw new AuthError("throttled");
  }

  async function uniform(operation) {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      await delay(Math.max(0, minimumDelay - (performance.now() - start)));
    }
  }

  async function issue(identity, previousToken) {
    const vetted = identitySchema.safeParse(identity);
    if (!vetted.success) throw new AuthError("unavailable");
    if (!invited(vetted.data.email)) throw new AuthError("sign_in_failed");
    return store.createSession(vetted.data, previousToken);
  }

  return {
    async status(token) {
      if (!(await store.ready())) throw new AuthError("unavailable");
      return { session: await store.session(token), google: Boolean(google) };
    },

    async signIn(ip, input, previousToken) {
      await throttle("sign_in", ip, input.email);
      const identity = await uniform(async () => {
        if (!invited(input.email)) throw new AuthError("sign_in_failed");
        return password.signIn(input.email, input.password);
      });
      return issue(identity, previousToken);
    },

    async mail(mode, ip, input) {
      await throttle("mail", ip, input.email);
      if (mode === "register") checkPassword(input.password);
      await uniform(async () => {
        if (invited(input.email))
          await password[mode](input.email, input.password);
      });
    },

    async verify(ip, code) {
      await throttle("verify", ip);
      await throttleActionAccount(
        "verify",
        await password.verificationAccount(code),
      );
      await password.verifyEmail(code);
    },

    async reset(ip, code, newPassword) {
      await throttle("reset", ip);
      checkPassword(newPassword);
      const identity = await password.recoveryIdentity(code);
      await throttleActionAccount(
        "reset",
        identity.issuer + "\0" + identity.subject,
      );
      // Revoke before changing credentials so an outage cannot preserve old sessions.
      await store.beginRecovery(identity);
      try {
        await password.reset(code, newPassword);
      } catch (error) {
        if (error instanceof AuthError && error.code !== "unavailable")
          await store.finishRecovery(identity);
        throw error;
      }
      await store.finishRecovery(identity);
    },

    async signOut(token) {
      await store.signOut(token);
    },

    async signOutAll(token) {
      const session = await store.session(token);
      if (!session) throw new AuthError("session_required");
      if (now() - session.createdAt >= config.recentMs)
        throw new AuthError("recent_sign_in");
      await store.revokeUser(session.user.id);
    },

    async beginGoogle(ip, destination) {
      if (!google) throw new AuthError("unavailable");
      await throttle("google", ip);
      const value = newToken();
      const attempt = await google.start();
      await store.addOAuth(value, attempt, safeDestination(destination));
      return { value, url: attempt.url };
    },

    async finishGoogle(ip, search, attemptToken, previousToken) {
      if (!google) throw new AuthError("unavailable");
      await throttle("google", ip);
      const attempt = await store.takeOAuth(attemptToken);
      if (!attempt) throw new AuthError("external_failed");
      const identity = await google.finish(search, attempt);
      return {
        ...(await issue(identity, previousToken)),
        destination: safeDestination(attempt.destination),
      };
    },

    async requireSession(token) {
      const session = await store.session(token, true);
      if (!session) throw new AuthError("session_required");
      return session;
    },

    throttleSave: (ip, userId) => throttle("save", ip, userId),
  };
}
