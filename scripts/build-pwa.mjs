import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const files = [
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/gather-192.png",
  "icons/gather-512.png",
  "icons/gather-maskable-512.png",
];
await mkdir(resolve(dist, "icons"), { recursive: true });
await Promise.all(
  files.map((file) =>
    copyFile(resolve(root, "pwa", file), resolve(dist, file)),
  ),
);

// Vite emits fingerprinted application chunks and workers in this directory.
// Keep PDF support resources, API routes and pairing pages outside precaching.
const chunks = (await readdir(resolve(dist, "assets"), { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => "assets/" + entry.name)
  .sort();
const shell = ["index.html", ...files, ...chunks];
const hash = createHash("sha256");
const template = await readFile(resolve(root, "pwa/service-worker.js"), "utf8");
hash.update(template);
for (const file of shell) {
  hash.update(file + "\0");
  hash.update(await readFile(resolve(dist, file)));
}
const script = template
  .replace('/* GATHER_SHELL_VERSION */ ""', JSON.stringify(hash.digest("hex")))
  .replace(
    "/* GATHER_SHELL_ASSETS */ []",
    JSON.stringify(shell.map((file) => "/" + file)),
  );
await writeFile(resolve(dist, "sw.js"), script);
