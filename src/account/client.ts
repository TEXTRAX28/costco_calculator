import { z } from "zod";
import { savedReceiptSchema } from "../lib/draft-schema.mjs";

const sessionSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email() }),
  createdAt: z.number(),
  expiresAt: z.number(),
});
const accountStatus = z.object({
  availability: z.enum(["ready", "disabled", "unavailable"]),
  session: sessionSchema.nullable(),
  google: z.boolean(),
});
const allowedDestination = z.enum(["/", "/?account=1"]);
const entry = z.object({
  id: z.uuid(),
  title: z.string(),
  savedAt: z.number(),
});
const group = z.object({ name: z.string(), people: z.array(z.string()) });
export type Session = z.infer<typeof sessionSchema>;
export type AccountStatus = z.infer<typeof accountStatus> & { notice?: string };
export type AccountEntry = z.infer<typeof entry>;
export type SavedReceipt = z.infer<typeof savedReceiptSchema>;
export type SavedReceiptEntry = AccountEntry & { payload: SavedReceipt };

export class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly code = "connection",
    readonly field?: "email" | "password",
  ) {
    super(message);
  }
}

const safeError = z.object({
  code: z.string(),
  message: z.string(),
  field: z.enum(["email", "password"]).optional(),
});

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  data?: { method?: "POST" | "PUT" | "DELETE"; body: unknown },
): Promise<T> {
  let response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(32_000),
      ...(data
        ? {
            method: data.method || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data.body),
          }
        : {}),
    });
  } catch {
    throw new AccountRequestError(
      "Gather couldn’t reach the account server. Check your connection and try again.",
    );
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = safeError.safeParse(json);
    if (parsed.success)
      throw new AccountRequestError(
        parsed.data.message,
        parsed.data.code,
        parsed.data.field,
      );
    throw new AccountRequestError(
      "Accounts are temporarily unavailable. Try again in a moment.",
      "unavailable",
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new AccountRequestError(
      "The account server sent an unreadable response. Try again.",
      "unavailable",
    );
  return parsed.data;
}

const success = z.object({ ok: z.literal(true) });
const auth = "/api/auth/";
const pathFor = (kind: "receipts" | "groups", id?: string) =>
  "/api/account/" + kind + (id ? "/" + encodeURIComponent(id) : "");

export const accounts = {
  status: () => request(auth + "session", accountStatus),
  signIn: (email: string, password: string, destination: string) =>
    request(
      auth + "sign-in",
      z.object({ session: sessionSchema, destination: allowedDestination }),
      {
        body: { email, password, destination },
      },
    ),
  mail: (
    mode: "register" | "resend" | "recover",
    email: string,
    password: string,
  ) =>
    request(auth + mode, success, {
      body: mode === "recover" ? { email } : { email, password },
    }),
  verify: (code: string) =>
    request(auth + "verify", success, { body: { code } }),
  reset: (code: string, password: string) =>
    request(auth + "reset", success, { body: { code, password } }),
  signOut: (all = false) =>
    request(auth + (all ? "sign-out-all" : "sign-out"), success, { body: {} }),
  async startGoogle(destination: string) {
    const { url } = await request(
      auth + "google/start",
      z.object({ url: z.url() }),
      { body: { destination } },
    );
    if (new URL(url).origin !== "https://accounts.google.com")
      throw new AccountRequestError(
        "Google sign-in couldn’t start. Try again from Gather.",
      );
    return url;
  },
  list: (kind: "receipts" | "groups") =>
    request(
      pathFor(kind),
      z.object({ entries: z.array(entry), expiresAt: z.number() }),
    ),
  receipt: (id: string) =>
    request(
      pathFor("receipts", id),
      z.object({
        document: entry.extend({ payload: savedReceiptSchema }),
        expiresAt: z.number(),
      }),
    ),
  group: (id: string) =>
    request(
      pathFor("groups", id),
      z.object({
        document: entry.extend({ payload: group }),
        expiresAt: z.number(),
      }),
    ),
  save: (kind: "receipts" | "groups", id: string, payload: unknown) =>
    request(
      pathFor(kind, id),
      z.object({ document: entry, expiresAt: z.number() }),
      {
        method: "PUT",
        body: { payload },
      },
    ),
  remove: (kind: "receipts" | "groups", id: string) =>
    request(pathFor(kind, id), success.extend({ expiresAt: z.number() }), {
      method: "DELETE",
      body: {},
    }),
};
