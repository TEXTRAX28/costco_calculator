import { defineConfig, devices } from "@playwright/test";

const baseURL = "https://127.0.0.1:4191";
const channel = process.env.GATHER_TEST_CHROME === "1" ? "chrome" : undefined;

export default defineConfig({
  testDir: "./tests/auth/browser",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
  outputDir: "qa-artifacts/auth-browser",
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  // Give each browser its own synthetic IP in the local authentication fixture.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel,
        extraHTTPHeaders: { "X-Gather-Client-IP": "192.0.2.101" },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        channel,
        deviceScaleFactor: 1,
        extraHTTPHeaders: { "X-Gather-Client-IP": "192.0.2.102" },
      },
    },
    {
      name: "webkit-mobile",
      use: {
        ...devices["iPhone 13"],
        extraHTTPHeaders: { "X-Gather-Client-IP": "192.0.2.103" },
      },
    },
  ],
  webServer: {
    command: "node tests/auth/browser-server.mjs",
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
