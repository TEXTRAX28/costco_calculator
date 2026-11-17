import { randomBytes } from "node:crypto";
import { AuthError } from "../../server/auth/errors.mjs";

const issuer = "https://securetoken.google.com/demo-gather-auth";
export const email = "alice@example.test";
export const passphrase = "example account passphrase";

export function syntheticPassword(now = Date.now) {
  const users = new Map();
  const links = new Map();
  let sequence = 0;

  function issue(kind, user) {
    const code = randomBytes(32).toString("base64url");
    links.set(code, { kind, user, expires: now() + 60_000 });
    return code;
  }

  function lookup(code, kind) {
    const record = links.get(code);
    if (!record || record.kind !== kind || record.expires <= now())
      throw new AuthError("expired_link");
    return record;
  }

  function add(address, password = passphrase, verified = false) {
    const user = { address, password, verified, sub: "test-uid-" + ++sequence };
    users.set(address, user);
    return user;
  }

  return {
    add,
    lastLink(address, kind) {
      return [...links]
        .reverse()
        .find(
          ([, entry]) => entry.kind === kind && entry.user.address === address,
        )?.[0];
    },
    async signIn(address, password) {
      const user = users.get(address);
      if (!user?.verified || user.password !== password)
        throw new AuthError("sign_in_failed");
      return {
        issuer,
        email: address,
        subject: user.sub,
        authenticatedAt: now(),
      };
    },
    async register(address, password) {
      if (!users.has(address)) issue("verify", add(address, password));
    },
    async resend(address, password) {
      const user = users.get(address);
      if (user && !user.verified && user.password === password)
        issue("verify", user);
    },
    async recover(address) {
      const user = users.get(address);
      if (user) issue("reset", user);
    },
    async verificationAccount(code) {
      return lookup(code, "verify").user.address;
    },
    async verifyEmail(code) {
      const { user } = lookup(code, "verify");
      links.delete(code);
      user.verified = true;
    },
    async recoveryIdentity(code) {
      return { issuer, subject: lookup(code, "reset").user.sub };
    },
    async reset(code, password) {
      const { user } = lookup(code, "reset");
      links.delete(code);
      user.password = password;
    },
  };
}
