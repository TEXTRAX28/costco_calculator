import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer, testDatabase } from "./fixture-server.mjs";
import { email, passphrase, syntheticPassword } from "./synthetic-provider.mjs";
import { indexBuiltFiles, serveBuiltFile } from "../../server/built-site.mjs";
import { createReceiptApi } from "../../server/receipt-api.mjs";

const folder = await mkdtemp(join(tmpdir(), "gather-auth-test-"));
const key = join(folder, "key.pem");
const certificate = join(folder, "cert.pem");
const binary = existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
  ? "C:/Program Files/Git/usr/bin/openssl.exe"
  : "openssl";
let tls;
try {
  execFileSync(
    binary,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      certificate,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  tls = { key: await readFile(key), cert: await readFile(certificate) };
} finally {
  await Promise.allSettled([unlink(key), unlink(certificate)]);
  await rmdir(folder);
}

const routes = await indexBuiltFiles(
  resolve(import.meta.dirname, "../../dist"),
);
const database = await testDatabase();
const provider = syntheticPassword();
provider.add(email, passphrase, true);
provider.add("mobile-" + email, passphrase, true);
provider.add("webkit-mobile-" + email, passphrase, true);
for (const project of ["desktop", "mobile", "webkit-mobile"]) {
  provider.add("library-" + project + "-" + email, passphrase, true);
  provider.add("names-" + project + "-" + email, passphrase, true);
}
const scan = createReceiptApi();
const server = await fixtureServer({
  database,
  provider,
  tls,
  port: 4191,
  minimumDelay: 120,
  next(req, res) {
    const request = new URL(req.url || "/", "https://127.0.0.1:4191");
    if (request.pathname === "/__test/mail" && req.method === "GET") {
      const code = provider.lastLink(
        request.searchParams.get("email"),
        request.searchParams.get("kind"),
      );
      res.writeHead(code ? 200 : 404, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ code }));
      return;
    }
    void scan(req, res, async () => {
      if (!(await serveBuiltFile(req, res, request.pathname, routes)))
        res.writeHead(404).end();
    });
  },
});
console.log("Gather account browser fixture ready.");
async function stop() {
  await server.close();
  await database.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
