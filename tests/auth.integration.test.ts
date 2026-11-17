import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountRuntime } from "../server/auth/runtime.mjs";
import { AuthError } from "../server/auth/errors.mjs";
import { migrateAccounts } from "../server/auth/migrate.mjs";
import { newItem, newState } from "../src/lib/model";
import { fixtureServer, testDatabase } from "./auth/fixture-server.mjs";
import { passphrase, syntheticPassword } from "./auth/synthetic-provider.mjs";

type Fixture = Awaited<ReturnType<typeof fixtureServer>>;
let db: Awaited<ReturnType<typeof testDatabase>>;
let time = Date.now();
const now = () => time;
const provider = syntheticPassword(now);
let first: Fixture;
let second: Fixture;
const alice = "integration-alice@example.test";
const bob = "integration-bob@example.test";
const google = {
  async start() {
    return {
      state: "only-this-state",
      nonce: "nonce",
      verifier: "verifier",
      url: "https://accounts.google.com/test",
    };
  },
  async finish(search: string) {
    const values = new URLSearchParams(search);
    if (values.get("state") !== "only-this-state")
      throw new AuthError("external_failed");
    if (values.get("error") === "access_denied")
      throw new AuthError("external_cancelled");
    return {
      issuer: "https://accounts.google.com",
      subject: (await provider.signIn(alice, passphrase)).subject,
      email: alice,
      authenticatedAt: now(),
    };
  },
};

beforeAll(async () => {
  db = await testDatabase();
  provider.add(alice, passphrase, true);
  provider.add(bob, passphrase, true);
  first = await fixtureServer({ database: db, provider, google, now });
  second = await fixtureServer({ database: db, provider, now });
});
beforeEach(() => {
  time += 16 * 60_000;
});
afterAll(async () => {
  await first?.close();
  await second?.close();
  await db?.close();
});

async function call(
  path: string,
  {
    fixture = first,
    body,
    cookie,
    method,
    origin,
    ip = "192.0.2.89",
  }: {
    fixture?: Fixture;
    body?: unknown;
    cookie?: string;
    method?: string;
    origin?: string;
    ip?: string;
  } = {},
) {
  return fetch(fixture.origin + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    redirect: "manual",
    headers: {
      "X-Gather-Client-IP": ip,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? {
            "Content-Type": "application/json",
            Origin: origin ?? fixture.origin,
          }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const signIn = (address: string, cookie?: string, ip = "192.0.2.92") =>
  call("/api/auth/sign-in", {
    body: { email: address, password: passphrase },
    cookie,
    ip,
  });
const cookiePair = (response: Response) => {
  const value = response.headers.getSetCookie()[0];
  if (!value)
    throw new Error("Response did not set a cookie. HTTP " + response.status);
  return value.split(";", 1)[0];
};

describe("account integration with the migrated PostgreSQL schema", () => {
  it("can reapply the migration and keeps missing production configuration closed", async () => {
    await expect(migrateAccounts(db)).resolves.toBe(1);
    const prior = process.env.GATHER_AUTH_ENABLED;
    process.env.GATHER_AUTH_ENABLED = "0";
    try {
      await expect(
        accountRuntime(process.cwd()).close(),
      ).resolves.toBeUndefined();
    } finally {
      if (prior === undefined) delete process.env.GATHER_AUTH_ENABLED;
      else process.env.GATHER_AUTH_ENABLED = prior;
    }
    const guest = await call("/api/auth/session");
    expect(await guest.json()).toMatchObject({ session: null, google: true });
    expect((await call("/api/account/receipts")).status).toBe(401);
  });

  it("rotates Secure HttpOnly sessions, keeps a stable app ID and signs out on the server", async () => {
    const response = await signIn(alice);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /__Host-gather-session=.+; Path=\/; Secure; HttpOnly; SameSite=Lax/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const old = cookiePair(response);
    const initial = (await response.json()).session;
    expect(initial.user.id).not.toBe(
      (await provider.signIn(alice, passphrase)).subject,
    );
    const again = await signIn(alice, old);
    const active = cookiePair(again);
    expect(active).not.toBe(old);
    expect((await again.json()).session.user.id).toBe(initial.user.id);
    expect(
      (await call("/api/account/groups", { cookie: old, fixture: second }))
        .status,
    ).toBe(401);
    expect(
      (await call("/api/account/groups", { cookie: active, fixture: second }))
        .status,
    ).toBe(200);
    expect(
      (await call("/api/auth/sign-out", { cookie: active, body: {} })).status,
    ).toBe(200);
    expect((await call("/api/account/groups", { cookie: active })).status).toBe(
      401,
    );
  });

  it("expires idle and absolute sessions and requires recent authentication to revoke other sessions", async () => {
    const older = await signIn(alice, undefined, "192.0.2.109");
    const current = cookiePair(older);
    time += 11 * 60_000;
    expect(
      (await call("/api/auth/sign-out-all", { cookie: current, body: {} }))
        .status,
    ).toBe(403);
    time += 20 * 60_000;
    expect(
      (await call("/api/account/receipts", { cookie: current })).status,
    ).toBe(401);
    const response = await signIn(alice, undefined, "192.0.2.109");
    const active = cookiePair(response);
    const userId = (await response.json()).session.user.id;
    await db.query(
      "UPDATE gather_sessions SET expires_at = $1 WHERE user_id = $2",
      [now() - 1, userId],
    );
    expect(
      (await call("/api/account/receipts", { cookie: active })).status,
    ).toBe(401);

    const olderDevice = cookiePair(
      await signIn(alice, undefined, "192.0.2.109"),
    );
    const newest = cookiePair(await signIn(alice, undefined, "192.0.2.109"));
    expect(
      (await call("/api/auth/sign-out-all", { cookie: newest, body: {} }))
        .status,
    ).toBe(200);
    expect(
      (await call("/api/account/receipts", { cookie: olderDevice })).status,
    ).toBe(401);
    expect(
      (await call("/api/account/receipts", { cookie: newest })).status,
    ).toBe(401);
  });

  it("requires same-origin JSON for login, logout and account writes; ignores unsafe return URLs", async () => {
    const credentials = {
      email: bob,
      password: passphrase,
      destination: "//attacker.example",
    };
    expect(
      (
        await call("/api/auth/sign-in", {
          origin: "https://attacker.example",
          body: credentials,
        })
      ).status,
    ).toBe(403);
    const response = await call("/api/auth/sign-in", { body: credentials });
    expect((await response.clone().json()).destination).toBe("/");
    const cookie = cookiePair(response);
    for (const [path, method] of [
      ["/api/auth/sign-out", "POST"],
      ["/api/account/receipts/" + randomUUID(), "DELETE"],
    ]) {
      const rejected = await call(path, {
        cookie,
        method,
        body: {},
        origin: "null",
      });
      expect(rejected.status).toBe(403);
      expect(rejected.headers.has("access-control-allow-origin")).toBe(false);
    }
    const noOrigin = await fetch(first.origin + "/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(noOrigin.status).toBe(403);
    expect((await call("/api/account/receipts", { cookie })).status).toBe(200);
  });

  it("keeps receipt, group and history ownership private and saves only by explicit authenticated request", async () => {
    const a = cookiePair(await signIn(alice, undefined, "192.0.2.185"));
    const b = cookiePair(await signIn(bob, undefined, "192.0.2.186"));
    const id = randomUUID();
    const receipt = newState();
    receipt.receipt.merchant = "Synthetic receipt";
    receipt.receipt.rawText =
      "This OCR source must stay out of the account draft";
    receipt.receipt.items.push(newItem());
    const entry = "/api/account/receipts/" + id;
    const group = "/api/account/groups/" + id;
    const put = (path: string, payload: unknown, cookie: string) =>
      call(path, { body: { payload }, method: "PUT", cookie });
    expect(
      (
        await call(entry, {
          body: { payload: receipt, ownerId: randomUUID() },
          method: "PUT",
          cookie: a,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("/api/account/receipts", { cookie: a }).then((r) => r.json()))
        .entries,
    ).toHaveLength(0);
    const duplicate = await Promise.all([
      put(entry, receipt, a),
      put(entry, receipt, a),
    ]);
    expect(duplicate.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await put(group, { name: "Friends", people: ["A", "B"] }, a)).status,
    ).toBe(200);
    expect(
      (await call(entry, { cookie: a }).then((r) => r.json())).document.payload
        .receipt.rawText,
    ).toBe("");
    expect(
      (await call("/api/account/receipts", { cookie: a }).then((r) => r.json()))
        .entries,
    ).toHaveLength(1);
    for (const path of [entry, group]) {
      expect((await call(path, { cookie: b })).status).toBe(404);
      expect(
        (await call(path, { method: "DELETE", body: {}, cookie: b })).status,
      ).toBe(404);
    }
    for (const path of ["/api/account/receipts", "/api/account/groups"])
      expect(
        (await call(path, { cookie: b }).then((r) => r.json())).entries,
      ).toEqual([]);
    expect((await call("/api/account/jobs/" + id, { cookie: b })).status).toBe(
      404,
    );
  });

  it("verifies expiring single-use email links and revokes existing sessions during recovery", async () => {
    const email = "registration@example.test";
    const register = await call("/api/auth/register", {
      body: { email, password: passphrase },
    });
    const repeat = await call("/api/auth/register", {
      body: { email, password: passphrase },
    });
    expect(await register.json()).toEqual(await repeat.json());
    const verification = provider.lastLink(email, "verify")!;
    expect((await signIn(email)).status).toBe(401);
    expect(
      (await call("/api/auth/verify", { body: { code: verification } })).status,
    ).toBe(200);
    expect(
      (await call("/api/auth/verify", { body: { code: verification } })).status,
    ).toBe(400);
    const old = cookiePair(await signIn(email));
    const recover = (address: string) =>
      call("/api/auth/recover", { body: { email: address } });
    const existing = await recover(email);
    const missing = await recover("unknown@example.test");
    expect([existing.status, await existing.json()]).toEqual([
      missing.status,
      await missing.json(),
    ]);
    const expired = provider.lastLink(email, "reset")!;
    time += 61_000;
    const reset = (code: string) =>
      call("/api/auth/reset", {
        body: { code, password: "replacement test passphrase" },
      });
    expect((await reset(expired)).status).toBe(400);
    await recover(email);
    const fresh = provider.lastLink(email, "reset")!;
    expect((await reset(fresh)).status).toBe(200);
    expect((await reset(fresh)).status).toBe(400);
    expect(
      (await call("/api/account/groups", { cookie: old, fixture: second }))
        .status,
    ).toBe(401);
  });

  it("shares account throttles across instances and exposes one generic wrong-credential response", async () => {
    time += 16 * 60_000;
    const attempt = (fixture: Fixture, email: string, ip: string) =>
      call("/api/auth/sign-in", {
        fixture,
        ip,
        body: { email, password: "wrong password" },
      });
    const wrong = await attempt(first, alice, "192.0.2.133");
    const missing = await attempt(first, "unknown@example.test", "192.0.2.134");
    expect([wrong.status, await wrong.json()]).toEqual([
      missing.status,
      await missing.json(),
    ]);
    for (let i = 0; i < 7; i++)
      expect(
        (await attempt(i % 2 ? first : second, alice, "192.0.2." + (100 + i)))
          .status,
      ).toBe(401);
    expect((await attempt(second, alice, "192.0.2.200")).status).toBe(429);
    for (let i = 0; i < 12; i++)
      expect(
        (
          await attempt(
            i % 2 ? first : second,
            "different" + i + "@example.test",
            "2001:db8:98:23::" + (i + 1),
          )
        ).status,
      ).toBe(401);
    expect(
      (await attempt(first, "another@example.test", "2001:db8:98:23::aa"))
        .status,
    ).toBe(429);
    time += 16 * 60_000;
    expect((await attempt(second, alice, "192.0.2.200")).status).toBe(401);
  });

  it("reports provider errors safely and never leaks exception text", async () => {
    const fail = await fixtureServer({
      database: db,
      now,
      provider: {
        ...provider,
        signIn: async () => {
          throw new Error("private upstream error");
        },
      },
    });
    try {
      const response = await call("/api/auth/sign-in", {
        fixture: fail,
        body: { email: bob, password: passphrase },
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private upstream");
      expect(response.headers.has("set-cookie")).toBe(false);
    } finally {
      await fail.close();
    }
  });

  it("blocks listed passwords on registration and reset before reaching Firebase", async () => {
    const email = "blocked-password-flow@example.test";
    const offending = "example previously exposed passphrase";
    const fixture = await fixtureServer({
      database: db,
      now,
      provider,
      options: { compromisedPasswords: new Set([offending]) },
    });
    try {
      const registered = await call("/api/auth/register", {
        fixture,
        body: { email, password: offending },
      });
      const reset = await call("/api/auth/reset", {
        fixture,
        body: { code: "unused-test-code", password: offending },
      });
      for (const response of [registered, reset]) {
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          code: "compromised_password",
          field: "password",
        });
      }
      expect(provider.lastLink(email, "verify")).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("binds OAuth to the initiating browser, consumes state once and keeps equal emails and subjects separate across issuers", async () => {
    const start = () =>
      call("/api/auth/google/start", {
        body: { destination: "https://attacker.example" },
      });
    const callback = (search: string, cookie?: string) =>
      call("/api/auth/google/callback?" + search, { cookie });
    const startResponse = await start();
    expect(
      (await callback("state=only-this-state&code=code")).headers.get(
        "location",
      ),
    ).toBe("/auth?status=failed");
    const completed = await callback(
      "state=only-this-state&code=code",
      cookiePair(startResponse),
    );
    expect(completed.headers.get("location")).toBe("/");
    const externalCookie = cookiePair(completed);
    const external = (
      await call("/api/auth/session", { cookie: externalCookie }).then((r) =>
        r.json(),
      )
    ).session;
    const local = (
      await signIn(alice, undefined, "192.0.2.180").then((r) => r.json())
    ).session;
    expect(external.user.email).toBe(local.user.email);
    expect(external.user.id).not.toBe(local.user.id);
    expect(
      (
        await callback(
          "state=only-this-state&code=code",
          cookiePair(startResponse),
        )
      ).headers.get("location"),
    ).toBe("/auth?status=failed");
    const cancelled = await callback(
      "state=only-this-state&error=access_denied",
      cookiePair(await start()),
    );
    expect(cancelled.headers.get("location")).toBe("/auth?status=cancelled");
    const stale = cookiePair(await start());
    time += 11 * 60_000;
    expect(
      (await callback("state=only-this-state&code=code", stale)).headers.get(
        "location",
      ),
    ).toBe("/auth?status=failed");
  });
});
