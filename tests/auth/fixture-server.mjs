import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { PGlite } from "@electric-sql/pglite";
import { accountApi } from "../../server/auth/http.mjs";
import { accountStore } from "../../server/auth/store.mjs";
import { accountDocuments } from "../../server/auth/documents.mjs";
import { accountService } from "../../server/auth/service.mjs";
import { migrateAccounts } from "../../server/auth/migrate.mjs";
import { syntheticPassword } from "./synthetic-provider.mjs";

export async function testDatabase() {
  const db = new PGlite();
  await migrateAccounts(db);
  return db;
}

/** @param {{
 *   database: PGlite,
 *   now?: () => number,
 *   options?: { idleMs?: number, absoluteMs?: number, recentMs?: number, compromisedPasswords?: Set<string> },
 *   provider?: ReturnType<typeof syntheticPassword>,
 *   google?: null | { start(): Promise<{ state: string, nonce: string, verifier: string, url: string }>, finish(search: string, attempt: object): Promise<{ issuer: string, subject: string, email: string, authenticatedAt: number }> },
 *   tls?: import("node:https").ServerOptions,
 *   port?: number,
 *   minimumDelay?: number,
 *   next?: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
 * }} settings */
export async function fixtureServer({
  database,
  now = Date.now,
  options = {},
  provider = syntheticPassword(now),
  google = null,
  tls,
  port = 0,
  minimumDelay = 0,
  next = (_req, res) => res.writeHead(404).end(),
}) {
  const config = {
    origin: "",
    trustProxy: true,
    absoluteMs: 24 * 60 * 60_000,
    idleMs: 30 * 60_000,
    recentMs: 10 * 60_000,
    rateKey: Buffer.alloc(32, 123),
    allowedEmail: "",
    ...options,
  };
  const store = accountStore(database, config, now);
  const service = accountService({
    config,
    password: provider,
    google,
    store,
    now,
    minimumDelay,
  });
  const documents = accountDocuments(database, now);
  const route = accountApi({ config, service, documents });
  const handle = (req, res) => {
    // The real TLS proxy always overwrites this header before forwarding.
    if (!req.headers["x-gather-client-ip"])
      req.headers["x-gather-client-ip"] = "192.0.2.1";
    void route(req, res, () => next(req, res));
  };
  const server = tls ? httpsServer(tls, handle) : httpServer(handle);
  const ready = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await ready;
  config.origin =
    (tls ? "https" : "http") + "://127.0.0.1:" + server.address().port;
  return {
    origin: config.origin,
    provider,
    store,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
