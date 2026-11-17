import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, join, relative, sep } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

const loopback = (hostname) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

function validate(condition, name) {
  if (!condition)
    throw new Error("Check " + name + " in the server environment.");
}

export function authSettings(root, env = process.env) {
  const file = join(root, ".env.local");
  const local = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const setting = (name) => (env[name] ?? local[name] ?? "").trim();
  const flag = (name) => {
    const value = setting(name);
    validate(["", "0", "1"].includes(value), name);
    return value === "1";
  };
  if (!flag("GATHER_AUTH_ENABLED")) return null;
  validate(
    !setting("FIREBASE_AUTH_EMULATOR_HOST"),
    "Firebase emulator settings",
  );
  const exactOrigin = setting("GATHER_AUTH_ORIGIN");
  const parsedOrigin = URL.parse(exactOrigin);
  const trustProxy = flag("GATHER_AUTH_TRUST_PROXY");
  validate(
    parsedOrigin?.origin === exactOrigin &&
      (parsedOrigin.protocol === "https:" ||
        (parsedOrigin.protocol === "http:" &&
          (env.NODE_ENV ?? local.NODE_ENV) !== "production" &&
          loopback(parsedOrigin.hostname) &&
          !trustProxy)),
    "GATHER_AUTH_ORIGIN",
  );
  validate(
    loopback(parsedOrigin.hostname) || trustProxy,
    "GATHER_AUTH_TRUST_PROXY",
  );

  const databaseUrl = URL.parse(setting("GATHER_AUTH_DATABASE_URL"));
  validate(
    databaseUrl &&
      ["postgres:", "postgresql:"].includes(databaseUrl.protocol) &&
      databaseUrl.hostname &&
      databaseUrl.pathname.length > 1 &&
      !databaseUrl.search &&
      !databaseUrl.hash,
    "GATHER_AUTH_DATABASE_URL",
  );
  const caFile = setting("GATHER_AUTH_DATABASE_CA_FILE");
  validate(!caFile || isAbsolute(caFile), "GATHER_AUTH_DATABASE_CA_FILE");
  const databaseCa = caFile ? readFileSync(caFile, "utf8") : undefined;

  const projectId = setting("FIREBASE_PROJECT_ID");
  const apiKey = setting("FIREBASE_API_KEY");
  const credentialFile = setting("GATHER_FIREBASE_CREDENTIAL_FILE");
  validate(/^[a-z][a-z0-9-]{4,29}$/.test(projectId), "FIREBASE_PROJECT_ID");
  validate(/^[A-Za-z0-9_-]{30,128}$/.test(apiKey), "FIREBASE_API_KEY");
  validate(isAbsolute(credentialFile), "GATHER_FIREBASE_CREDENTIAL_FILE");
  let credential;
  try {
    const realFile = realpathSync(credentialFile);
    const pathFromApp = relative(realpathSync(root), realFile);
    validate(
      isAbsolute(pathFromApp) || pathFromApp.startsWith(".." + sep),
      "GATHER_FIREBASE_CREDENTIAL_FILE",
    );
    credential = JSON.parse(readFileSync(realFile, "utf8"));
  } catch {
    throw new Error(
      "Check GATHER_FIREBASE_CREDENTIAL_FILE in the server environment.",
    );
  }
  validate(
    credential?.type === "service_account" &&
      credential.project_id === projectId &&
      typeof credential.private_key === "string" &&
      typeof credential.client_email === "string",
    "GATHER_FIREBASE_CREDENTIAL_FILE",
  );
  const rateKey = setting("GATHER_AUTH_RATE_KEY");
  validate(/^[a-f0-9]{64}$/i.test(rateKey), "GATHER_AUTH_RATE_KEY");
  const allowedEmail = setting("GATHER_BETA_ALLOWED_EMAIL").toLowerCase();
  validate(
    !allowedEmail || z.email().safeParse(allowedEmail).success,
    "GATHER_BETA_ALLOWED_EMAIL",
  );
  const passwordBlocklist = setting("GATHER_AUTH_PASSWORD_BLOCKLIST_FILE");
  const compromisedPasswords = new Set();
  if (passwordBlocklist) {
    const name = "GATHER_AUTH_PASSWORD_BLOCKLIST_FILE";
    validate(isAbsolute(passwordBlocklist), name);
    const stats = statSync(passwordBlocklist);
    validate(stats.isFile() && stats.size > 0 && stats.size <= 8_000_000, name);
    for (const value of readFileSync(passwordBlocklist, "utf8").split(/\r?\n/u))
      if (value) compromisedPasswords.add(value);
    validate(compromisedPasswords.size > 0, name);
  }

  const clientId = setting("GOOGLE_OIDC_CLIENT_ID");
  const clientSecret = setting("GOOGLE_OIDC_CLIENT_SECRET");
  const host = parsedOrigin.hostname;
  const googleSupported =
    (loopback(host) ||
      (!isIP(host.replace(/^\[|\]$/g, "")) && host.includes("."))) &&
    /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId) &&
    /^[A-Za-z0-9_-]{12,256}$/.test(clientSecret);

  const minutes = (name, fallback, min, max) => {
    const value = setting(name) || String(fallback);
    validate(
      /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max,
      name,
    );
    return Number(value) * 60_000;
  };
  const idleMs = minutes("GATHER_AUTH_IDLE_MINUTES", 30, 5, 1440);
  const absoluteMs = minutes("GATHER_AUTH_MAX_MINUTES", 10080, 60, 43200);
  validate(absoluteMs > idleMs, "GATHER_AUTH_MAX_MINUTES");

  return {
    origin: exactOrigin,
    trustProxy,
    idleMs,
    absoluteMs,
    recentMs: 10 * 60_000,
    rateKey: Buffer.from(rateKey, "hex"),
    allowedEmail,
    compromisedPasswords,
    database: {
      connectionString: databaseUrl.toString(),
      ssl:
        loopback(databaseUrl.hostname) && !databaseCa
          ? false
          : {
              rejectUnauthorized: true,
              ...(databaseCa ? { ca: databaseCa } : {}),
            },
    },
    firebase: {
      projectId,
      apiKey,
      credential,
      continueUrl: exactOrigin + "/auth",
    },
    google: googleSupported
      ? {
          clientId,
          clientSecret,
          callback: exactOrigin + "/api/auth/google/callback",
        }
      : null,
  };
}
