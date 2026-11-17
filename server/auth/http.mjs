import { isIP } from "node:net";
import { z } from "zod";
import { authError, AuthError } from "./errors.mjs";
import { emailSchema, newPasswordSchema, passwordSchema } from "./identity.mjs";
import { safeDestination } from "./service.mjs";
import { documentSchemas } from "./documents.mjs";

const sessionCookie = "__Host-gather-session";
const oauthCookie = "__Host-gather-oauth";
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const code = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);
const empty = z.strictObject({});
const credentials = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  destination: z.string().max(200).optional(),
});
const newCredentials = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
});
const mailSchema = {
  register: newCredentials,
  resend: z.strictObject({ email: emailSchema, password: passwordSchema }),
  recover: z.strictObject({ email: emailSchema }),
};
const destination = z.strictObject({
  destination: z.string().max(200).optional(),
});
const endpoints = new Map([
  ["/api/auth/session", "GET"],
  ...[
    "sign-in",
    "sign-out",
    "sign-out-all",
    "register",
    "resend",
    "recover",
    "verify",
    "reset",
    "google/start",
  ].map((path) => ["/api/auth/" + path, "POST"]),
  ["/api/auth/google/callback", "GET"],
]);
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const accountPath =
  /^\/api\/account\/(receipts|groups)(?:\/([a-f0-9-]{36}))?$/i;

function token(req, name) {
  const matches = (req.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(name + "="));
  const value = matches.length === 1 ? matches[0].slice(name.length + 1) : "";
  return tokenFormat.test(value) ? value : null;
}

function cookie(name, value, age) {
  return (
    name +
    "=" +
    value +
    "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" +
    age
  );
}

async function readJson(req, limit) {
  if (
    typeof req.headers["content-type"] !== "string" ||
    req.headers["content-type"].split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    req.headers["content-encoding"] ||
    Number(req.headers["content-length"]) > limit
  )
    throw new AuthError("invalid");
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => req.destroy(), 8000);
  timer.unref?.();
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) throw new AuthError("invalid");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw new AuthError("invalid");
  } finally {
    clearTimeout(timer);
  }
}

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const field = result.error.issues[0]?.path[0];
  throw new AuthError(
    "invalid",
    ["email", "password"].includes(field) ? field : undefined,
  );
}

function network(req, config, post) {
  if (!localAddresses.has(req.socket.remoteAddress))
    throw new AuthError("unsafe_request");
  const origin = req.headers.origin;
  if ((post || origin) && origin !== config.origin)
    throw new AuthError("unsafe_request");
  if (
    post &&
    ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"])
  )
    throw new AuthError("unsafe_request");
  let address = config.trustProxy
    ? req.headers["x-gather-client-ip"]
    : req.socket.remoteAddress;
  if (typeof address !== "string" || !isIP(address))
    throw new AuthError("unsafe_request");
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4)
    address = address.slice(7);
  // Bucket IPv6 clients by /64. URL normalizes equivalent IPv6 spellings.
  if (isIP(address) === 6) {
    const normalized = new URL("http://[" + address + "]/").hostname.slice(
      1,
      -1,
    );
    const [first, rest] = normalized.split("::");
    const left = first ? first.split(":") : [];
    const right = rest ? rest.split(":") : [];
    const parts =
      rest === undefined
        ? left
        : [
            ...left,
            ...Array(8 - left.length - right.length).fill("0"),
            ...right,
          ];
    address = parts.slice(0, 4).join(":") + "::/64";
  }
  return address;
}

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(res, status, data, additional = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    ...additional,
  });
  res.end(JSON.stringify(data));
}

function go(res, location, cookies) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(303, { ...headers, Location: location, "Set-Cookie": cookies });
  res.end();
}

export function accountApi({
  availability = "ready",
  config,
  service,
  documents,
} = {}) {
  return async (req, res, next) => {
    const raw = req.url || "";
    const queryAt = raw.indexOf("?");
    const pathname = queryAt < 0 ? raw : raw.slice(0, queryAt);
    const isAccount = pathname.startsWith("/api/account/");
    if (!isAccount && !pathname.startsWith("/api/auth/")) return next();
    try {
      const authMethod = endpoints.get(pathname);
      const saved = isAccount && accountPath.exec(pathname);
      if (!authMethod && !saved) throw new AuthError("not_found");
      const method = req.method;
      const allowed = authMethod
        ? [authMethod]
        : saved[2]
          ? ["GET", "PUT", "DELETE"]
          : ["GET"];
      if (!allowed.includes(method))
        return json(
          res,
          405,
          { code: "invalid", message: "This request method is unavailable." },
          { Allow: allowed.join(", ") },
        );
      if (availability !== "ready") {
        if (pathname === "/api/auth/session")
          return json(res, 200, { availability, session: null, google: false });
        throw new AuthError("unavailable");
      }
      if (raw.length > 4096) throw new AuthError("invalid");
      const ip = network(req, config, method !== "GET");
      const currentToken = token(req, sessionCookie);
      const setSession = (value) =>
        cookie(sessionCookie, value, Math.floor(config.absoluteMs / 1000));
      const endSession = cookie(sessionCookie, "", 0);
      const endOAuth = cookie(oauthCookie, "", 0);

      if (pathname === "/api/auth/session") {
        const status = await service.status(currentToken);
        return json(res, 200, { availability: "ready", ...status });
      }
      if (pathname === "/api/auth/google/callback") {
        try {
          const result = await service.finishGoogle(
            ip,
            queryAt < 0 ? "" : raw.slice(queryAt),
            token(req, oauthCookie),
            currentToken,
          );
          return go(res, result.destination, [
            setSession(result.token),
            endOAuth,
          ]);
        } catch (error) {
          const { code: reason } = authError(error);
          const status =
            reason === "external_cancelled"
              ? "cancelled"
              : reason === "unavailable"
                ? "unavailable"
                : "failed";
          return go(res, "/auth?status=" + status, [endOAuth]);
        }
      }
      if (saved) {
        const session = await service.requireSession(currentToken);
        const owner = session.user.id;
        const kind = saved[1].toLowerCase();
        const id = saved[2];
        if (id && !z.uuid().safeParse(id).success)
          throw new AuthError("not_found");
        const send = (data) =>
          json(res, 200, { ...data, expiresAt: session.expiresAt });
        if (method === "GET")
          return send(
            id
              ? { document: await documents.get(owner, kind, id) }
              : { entries: await documents.list(owner, kind) },
          );
        if (method === "DELETE") {
          parse(empty, await readJson(req, 4096));
          await service.throttleSave(ip, owner);
          await documents.remove(owner, kind, id);
          return send({ ok: true });
        }
        await service.throttleSave(ip, owner);
        const body = parse(
          z.strictObject({ payload: documentSchemas[kind] }),
          await readJson(req, kind === "receipts" ? 800_000 : 8192),
        );
        return send({
          document: await documents.save(owner, kind, id, body.payload),
        });
      }

      const body = await readJson(req, 4096);
      const action = pathname.slice("/api/auth/".length);
      if (action === "sign-in") {
        const input = parse(credentials, body);
        const { token: value, session } = await service.signIn(
          ip,
          input,
          currentToken,
        );
        return json(
          res,
          200,
          { session, destination: safeDestination(input.destination) },
          { "Set-Cookie": setSession(value) },
        );
      }
      if (action === "sign-out" || action === "sign-out-all") {
        parse(empty, body);
        if (action === "sign-out-all") await service.signOutAll(currentToken);
        else await service.signOut(currentToken);
        return json(res, 200, { ok: true }, { "Set-Cookie": endSession });
      }
      if (Object.hasOwn(mailSchema, action)) {
        await service.mail(action, ip, parse(mailSchema[action], body));
        return json(res, 202, { ok: true });
      }
      if (action === "verify") {
        await service.verify(ip, parse(z.strictObject({ code }), body).code);
        return json(res, 200, { ok: true });
      }
      if (action === "reset") {
        const input = parse(
          z.strictObject({ code, password: newPasswordSchema }),
          body,
        );
        await service.reset(ip, input.code, input.password);
        return json(res, 200, { ok: true }, { "Set-Cookie": endSession });
      }
      const input = parse(destination, body);
      const result = await service.beginGoogle(ip, input.destination);
      return json(
        res,
        200,
        { url: result.url },
        { "Set-Cookie": cookie(oauthCookie, result.value, 600) },
      );
    } catch (error) {
      const safe = authError(error);
      return json(res, safe.status, {
        code: safe.code,
        message: safe.message,
        ...(safe.field ? { field: safe.field } : {}),
      });
    }
  };
}
