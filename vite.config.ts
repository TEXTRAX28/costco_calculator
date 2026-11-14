import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createReceiptApi } from "./server/receipt-api.mjs";
import { privateFileDeny } from "./server/private-paths.mjs";
import { openAiSettings } from "./server/openai-settings.mjs";

const privacyEmail = process.env.GATHER_PRIVACY_EMAIL?.trim() ?? "";
const privacyOperator = process.env.GATHER_PRIVACY_OPERATOR?.trim() ?? "";
if (
  privacyEmail &&
  !/^[a-z0-9._+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(privacyEmail)
)
  throw new Error("GATHER_PRIVACY_EMAIL must be a single email address.");

export default defineConfig({
  cacheDir: ".vite",
  publicDir: ".receipt-assets",
  envDir: false as const,
  envPrefix: [],
  define: {
    "import.meta.env.GATHER_PRIVACY_EMAIL": JSON.stringify(privacyEmail),
    "import.meta.env.GATHER_PRIVACY_OPERATOR": JSON.stringify(privacyOperator),
  },
  // Avoid a first-PDF dependency optimization reload discarding selected files.
  optimizeDeps: {
    entries: ["index.html"],
    include: ["pdfjs-dist"],
  },
  plugins: [
    react(),
    {
      name: "private-local-receipt-api",
      configureServer(server) {
        server.middlewares.use(
          createReceiptApi(openAiSettings(server.config.root)),
        );
      },
    },
    {
      name: "local-dev-csp",
      apply: "serve",
      transformIndexHtml: {
        order: "post",
        handler: (html) =>
          html
            .replace(
              "script-src 'self' 'wasm-unsafe-eval'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
            )
            .replace(
              "connect-src 'self'",
              "connect-src 'self' ws://127.0.0.1:*",
            ),
      },
    },
  ],
  build: { target: "es2022" },
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    fs: { deny: privateFileDeny },
    watch: {
      ignored: [
        "**/receipt_training/**",
        "**/qa-artifacts/**",
        "**/graphify-out/**",
        "**/playwright-report/**",
        "**/test-results/**",
      ],
    },
  },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 15000, maxWorkers: 2 },
});
