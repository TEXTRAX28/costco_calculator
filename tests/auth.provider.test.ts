import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  firebaseAdapter,
  firebaseAccountProvider,
} from "../server/auth/firebase.mjs";
import { googleProvider } from "../server/auth/google.mjs";
import { authSettings } from "../server/auth/config.mjs";

const issuer = "https://accounts.google.com";
const clientId = "123-example.apps.googleusercontent.com";
const callback = "https://example.test/api/auth/google/callback";
const secret = "example-client-secret";
const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongSigner = generateKeyPairSync("rsa", { modulusLength: 2048 });
const json64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function fakeOidc(overrides: Record<string, unknown> = {}, wrongKey = false) {
  let nonce = "";
  let verifier = "";
  let fetches = 0;
  const provider = googleProvider(
    { clientId, clientSecret: secret, callback },
    async (input: string | URL, options: RequestInit) => {
      fetches++;
      switch (new URL(input).pathname) {
        case "/.well-known/openid-configuration":
          return Response.json({
            issuer,
            authorization_endpoint: issuer + "/authorize",
            token_endpoint: issuer + "/token",
            jwks_uri: issuer + "/jwk",
            code_challenge_methods_supported: ["S256"],
            id_token_signing_alg_values_supported: ["RS256"],
          });
        case "/token": {
          const body = new URLSearchParams(options.body as URLSearchParams);
          expect(body.get("redirect_uri")).toBe(callback);
          expect(body.get("client_id")).toBe(clientId);
          expect(body.get("client_secret")).toBe(secret);
          expect(body.get("code_verifier")).toBe(verifier);
          const now = Math.floor(Date.now() / 1000);
          const claims = {
            iss: issuer,
            sub: "a-verified-subject",
            aud: clientId,
            nonce,
            iat: now,
            exp: now + 300,
            email: "synthetic@example.test",
            email_verified: true,
            ...overrides,
          };
          const message =
            json64({ alg: "RS256", kid: "signed-test" }) + "." + json64(claims);
          const key = wrongKey ? wrongSigner.privateKey : signer.privateKey;
          const signature = createSign("RSA-SHA256")
            .update(message)
            .sign(key, "base64url");
          return Response.json({
            access_token: "fixture-only",
            id_token: message + "." + signature,
            token_type: "Bearer",
            expires_in: 300,
          });
        }
        case "/jwk":
          return Response.json({
            keys: [
              {
                ...signer.publicKey.export({ format: "jwk" }),
                kid: "signed-test",
                alg: "RS256",
                use: "sig",
              },
            ],
          });
        default:
          throw new Error("Unexpected OIDC request in test");
      }
    },
  );
  return {
    async start() {
      const attempt = await provider.start();
      nonce = attempt.nonce;
      verifier = attempt.verifier;
      return attempt;
    },
    finish: provider.finish,
    get fetches() {
      return fetches;
    },
  };
}

describe("Google provider contract with locally signed OpenID Connect responses", () => {
  it("uses S256 and a nonce, exchanges the code, and validates signed identity claims", async () => {
    const provider = fakeOidc();
    const attempt = await provider.start();
    const url = new URL(attempt.url);
    expect(url.origin).toBe(issuer);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe(attempt.nonce);
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(url.searchParams.get("code_challenge")).not.toBe(attempt.verifier);
    await expect(
      provider.finish("?code=synthetic&state=" + attempt.state, attempt),
    ).resolves.toMatchObject({
      issuer,
      subject: "a-verified-subject",
      email: "synthetic@example.test",
    });
    expect(provider.fetches).toBe(3);
  });

  it.each([
    ["wrong nonce", { nonce: "wrong-nonce" }, false],
    ["wrong issuer", { iss: "https://attacker.example" }, false],
    ["wrong audience", { aud: "not-the-gather-client" }, false],
    ["expired", { exp: 1 }, false],
    ["unverified email", { email_verified: false }, false],
    ["forged signature", {}, true],
  ] as const)("rejects %s", async (_case, claims, forged) => {
    const provider = fakeOidc(claims, forged);
    const attempt = await provider.start();
    await expect(
      provider.finish("?code=synthetic&state=" + attempt.state, attempt),
    ).rejects.toHaveProperty("code");
  });

  it("rejects mismatched or repeated state and handles a matching cancellation without token exchange", async () => {
    const provider = fakeOidc();
    const attempt = await provider.start();
    await expect(
      provider.finish("?state=no&code=synthetic", attempt),
    ).rejects.toMatchObject({ code: "external_failed" });
    await expect(
      provider.finish(
        "?state=" + attempt.state + "&state=duplicate&code=synthetic",
        attempt,
      ),
    ).rejects.toMatchObject({ code: "external_failed" });
    await expect(
      provider.finish(
        "?state=" + attempt.state + "&error=access_denied",
        attempt,
      ),
    ).rejects.toMatchObject({ code: "external_cancelled" });
    expect(provider.fetches).toBe(1);
  });

  it("reports discovery failure without surfacing upstream details", async () => {
    const provider = googleProvider(
      { clientId, clientSecret: secret, callback },
      async () => {
        throw new Error("Private network detail");
      },
    );
    await expect(provider.start()).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("Firebase adapter failure handling and production setup", () => {
  it.each([500, 503])(
    "maps HTTP %d to unavailable without exposing a response body",
    async (status) => {
      const provider = firebaseAdapter({
        projectId: "demo-gather-auth",
        apiKey: "unused-test-key",
        continueUrl: "https://example.test/auth",
        admin: {},
        fetcher: async () =>
          Response.json({ error: { message: "upstream secret" } }, { status }),
      });
      await expect(
        provider.signIn("person@example.test", "test-password"),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );

  it("rejects an unreachable provider and malformed responses", async () => {
    const settings = {
      projectId: "demo-gather-auth",
      apiKey: "unused-test-key",
      continueUrl: "https://example.test/auth",
      admin: {},
    };
    const disconnected = firebaseAdapter({
      ...settings,
      fetcher: async () => {
        throw new TypeError("network");
      },
    });
    const malformed = firebaseAdapter({
      ...settings,
      fetcher: async () => new Response("not json"),
    });
    for (const provider of [disconnected, malformed])
      await expect(
        provider.signIn("person@example.test", "test-password"),
      ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects emulator mode in the production factory before creating a Firebase client", () => {
    const original = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
    try {
      expect(() => firebaseAccountProvider({})).toThrow(/unavailable/);
      expect(() =>
        authSettings(process.cwd(), {
          GATHER_AUTH_ENABLED: "1",
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
        }),
      ).toThrow(/emulator/);
    } finally {
      if (original === undefined)
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      else process.env.FIREBASE_AUTH_EMULATOR_HOST = original;
    }
  });

  it("does not accept HTTP origins in production or redirects embedded in the origin", () => {
    const settings = { GATHER_AUTH_ENABLED: "1", NODE_ENV: "production" };
    expect(() =>
      authSettings(process.cwd(), {
        ...settings,
        GATHER_AUTH_ORIGIN: "http://localhost:4175",
      }),
    ).toThrow(/ORIGIN/);
    expect(() =>
      authSettings(process.cwd(), {
        ...settings,
        GATHER_AUTH_ORIGIN: "https://example.test/auth",
      }),
    ).toThrow(/ORIGIN/);
    expect(
      authSettings(process.cwd(), { GATHER_AUTH_ENABLED: "0" }),
    ).toBeNull();
  });
});
