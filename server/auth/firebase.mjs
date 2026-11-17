import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AuthError } from "./errors.mjs";
import { emailSchema, identitySchema } from "./identity.mjs";

const service = "https://identitytoolkit.googleapis.com/v1/accounts:";
const unknownLogin = new Set([
  "EMAIL_NOT_FOUND",
  "USER_NOT_FOUND",
  "INVALID_PASSWORD",
  "USER_DISABLED",
  "INVALID_LOGIN_CREDENTIALS",
  "INVALID_EMAIL",
  "TOO_MANY_ATTEMPTS_TRY_LATER",
]);
const invalidCode = new Set([
  "EXPIRED_OOB_CODE",
  "INVALID_OOB_CODE",
  "USER_DISABLED",
  "USER_NOT_FOUND",
]);
const weakPassword = new Set([
  "WEAK_PASSWORD",
  "PASSWORD_DOES_NOT_MEET_REQUIREMENTS",
]);

function waitForProvider(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AuthError("unavailable")), 8000);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function firebaseAdapter({
  projectId,
  apiKey,
  continueUrl,
  admin,
  fetcher = fetch,
}) {
  const issuer = "https://securetoken.google.com/" + projectId;
  async function request(operation, body) {
    const url = new URL(service + operation);
    url.searchParams.set("key", apiKey);
    let response, json;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      json = await response.json();
    } catch {
      throw new AuthError("unavailable");
    }
    if (response.ok && json && typeof json === "object" && !Array.isArray(json))
      return { data: json };
    if (response.status === 400 && typeof json?.error?.message === "string")
      return { failure: json.error.message.split(/[ :]/, 1)[0] };
    throw new AuthError("unavailable");
  }

  async function login(email, password) {
    const result = await request("signInWithPassword", {
      email,
      password,
      returnSecureToken: true,
    });
    if (unknownLogin.has(result.failure)) return null;
    if (
      typeof result.data?.idToken !== "string" ||
      result.data.idToken.length > 10_000
    )
      throw new AuthError("unavailable");
    try {
      const claims = await waitForProvider(
        admin.verifyIdToken(result.data.idToken, true),
      );
      if (
        claims.iss !== issuer ||
        claims.aud !== projectId ||
        claims.firebase?.sign_in_provider !== "password"
      )
        throw new AuthError("unavailable");
      const identity = identitySchema.safeParse({
        issuer,
        subject: claims.sub,
        email: claims.email,
        authenticatedAt: claims.auth_time * 1000,
      });
      if (!identity.success) throw new AuthError("unavailable");
      return {
        identity: identity.data,
        verified: claims.email_verified === true,
        token: result.data.idToken,
      };
    } catch (error) {
      if (
        [
          "auth/user-disabled",
          "auth/id-token-revoked",
          "auth/user-not-found",
        ].includes(error?.code)
      )
        return null;
      throw new AuthError("unavailable");
    }
  }

  async function verification(idToken) {
    const result = await request("sendOobCode", {
      requestType: "VERIFY_EMAIL",
      idToken,
      continueUrl,
    });
    if (
      !result.data &&
      !["TOO_MANY_ATTEMPTS_TRY_LATER", "USER_DISABLED"].includes(result.failure)
    )
      throw new AuthError("unavailable");
  }

  async function actionEmail(code, expectedType) {
    const result = await request("resetPassword", { oobCode: code });
    if (
      invalidCode.has(result.failure) ||
      (result.data && result.data.requestType !== expectedType)
    )
      throw new AuthError("expired_link");
    const parsed = emailSchema.safeParse(result.data?.email);
    if (!parsed.success) throw new AuthError("unavailable");
    return parsed.data;
  }

  return {
    async signIn(email, password) {
      const signed = await login(email, password);
      if (!signed?.verified) throw new AuthError("sign_in_failed");
      return signed.identity;
    },

    async register(email, password) {
      const result = await request("signUp", {
        email,
        password,
        returnSecureToken: true,
      });
      if (
        ["EMAIL_EXISTS", "TOO_MANY_ATTEMPTS_TRY_LATER"].includes(result.failure)
      )
        return;
      if (weakPassword.has(result.failure))
        throw new AuthError("invalid", "password");
      if (typeof result.data?.idToken !== "string")
        throw new AuthError("unavailable");
      await verification(result.data.idToken);
    },

    async resend(email, password) {
      const signed = await login(email, password);
      if (signed && !signed.verified) await verification(signed.token);
    },

    async recover(email) {
      const result = await request("sendOobCode", {
        requestType: "PASSWORD_RESET",
        email,
        continueUrl,
      });
      if (!result.data && !unknownLogin.has(result.failure))
        throw new AuthError("unavailable");
    },

    verificationAccount: (code) => actionEmail(code, "VERIFY_EMAIL"),

    async verifyEmail(code) {
      const result = await request("update", { oobCode: code });
      if (invalidCode.has(result.failure)) throw new AuthError("expired_link");
      if (result.data?.emailVerified !== true)
        throw new AuthError("unavailable");
    },

    async recoveryIdentity(code) {
      const email = await actionEmail(code, "PASSWORD_RESET");
      // The email comes from Firebase's verified reset code. Only its authoritative UID is used to revoke sessions.
      let user;
      try {
        user = await waitForProvider(admin.getUserByEmail(email));
      } catch (error) {
        if (error?.code === "auth/user-not-found")
          throw new AuthError("expired_link");
        throw new AuthError("unavailable");
      }
      if (user.disabled || typeof user.uid !== "string" || !user.uid)
        throw new AuthError("expired_link");
      return { issuer, subject: user.uid };
    },

    async reset(code, password) {
      const result = await request("resetPassword", {
        oobCode: code,
        newPassword: password,
      });
      if (invalidCode.has(result.failure)) throw new AuthError("expired_link");
      if (weakPassword.has(result.failure))
        throw new AuthError("invalid", "password");
      if (!result.data) throw new AuthError("unavailable");
    },
  };
}

export function firebaseAccountProvider(settings) {
  // Admin SDK intentionally supports unsigned emulator tokens under this flag.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new AuthError("unavailable");
  const app = initializeApp(
    {
      projectId: settings.projectId,
      credential: cert(settings.credential),
    },
    "gather-accounts",
  );
  return {
    provider: firebaseAdapter({ ...settings, admin: getAuth(app) }),
    close: () => deleteApp(app),
  };
}
