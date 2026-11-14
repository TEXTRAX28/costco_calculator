import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { indexBuiltFiles, serveBuiltFile } from "../../server/built-site.mjs";
import { OPENAI_ESTIMATE_GUARD_USD } from "../../src/lib/openai-schema.mjs";
import { aiCostcoDraft } from "../fixtures/ai-receipt";

async function installed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
}

test("the install shell uses real icons and restores the draft offline without a scan", async ({
  page,
  context,
  request,
}) => {
  const manifestFile = await request.get("/manifest.webmanifest");
  expect(manifestFile.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  const manifest = await manifestFile.json();
  expect(manifest).toMatchObject({
    name: "Gather",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "192x192",
    "512x512",
    "512x512",
  ]);
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "crossorigin",
    "use-credentials",
  );
  for (const path of [
    "/icons/apple-touch-icon.png",
    ...manifest.icons.map((icon: { src: string }) => icon.src),
  ]) {
    const asset = await request.get(path);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toBe("image/png");
    expect((await asset.body()).subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
  }
  await installed(page);
  let posts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/receipts/"))
      posts++;
  });
  await page.getByRole("button", { name: "Try the Costco demo" }).click();
  await expect(page.getByText("Draft saved on this device")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "You’re offline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Digital receipt" }),
  ).toContainText("£176.78");
  await page
    .getByRole("button", { name: "Privacy Policy", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Privacy Policy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const entries = await page.evaluate(async () => {
    const versioned = (await caches.keys()).filter((key) =>
      key.startsWith("gather-shell-"),
    );
    return (
      await Promise.all(
        versioned.map(async (key) => (await caches.open(key)).keys()),
      )
    )
      .flat()
      .map((request) => new URL(request.url).pathname)
      .sort();
  });
  expect(entries).toContain("/index.html");
  expect(entries).toContain("/manifest.webmanifest");
  expect(
    entries.every(
      (path) =>
        ["/index.html", "/manifest.webmanifest"].includes(path) ||
        path.startsWith("/icons/") ||
        path.startsWith("/assets/"),
    ),
  ).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText("You’re offline.", { exact: false })).toHaveCount(
    0,
  );
  expect(posts).toBe(0);
});

test.describe("scan connection recovery", () => {
  test.use({ serviceWorkers: "block" });

  test("rechecking a recovered server never submits a paid scan", async ({
    page,
  }) => {
    let status: "offline" | "expired" | "ready" = "offline";
    let checks = 0;
    let posts = 0;
    await page.route("**/api/receipts/openai/config", async (route) => {
      checks++;
      if (status === "offline") await route.abort("failed");
      else if (status === "expired") await route.fulfill({ status: 401 });
      else
        await route.fulfill({
          json: {
            provider: "OpenAI",
            model: "gpt-6-astra",
            configured: true,
            remaining: 2,
            estimateGuardUsd: OPENAI_ESTIMATE_GUARD_USD,
            availability: "ready",
          },
        });
    });
    await page.route("**/api/receipts/openai", async (route) => {
      posts++;
      await route.abort();
    });
    await page.goto("/");
    await page
      .getByLabel("Upload receipt images")
      .setInputFiles("tests/fixtures/prepared-section.jpg");
    const retry = page.getByRole("button", { name: "Check scan connection" });
    await expect(retry).toBeVisible();
    status = "expired";
    await retry.click();
    await expect(
      page.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute("href", "/");
    status = "ready";
    await retry.click();
    await expect(page.getByText(/^2 scan attempts remaining/)).toBeVisible();
    await expect(page.locator(".selected-image")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Read receipt with OpenAI credits" }),
    ).toBeDisabled();
    expect(checks).toBeGreaterThanOrEqual(3);
    expect(posts).toBe(0);
  });
});

test("app updates wait for a relaunch and cached navigation respects a server denial", async ({
  page,
  context,
}) => {
  const [routes, html, script] = await Promise.all([
    indexBuiltFiles("dist"),
    readFile("dist/index.html", "utf8"),
    readFile("dist/sw.js", "utf8"),
  ]);
  let newer = false;
  let denied = false;
  let stalled = false;
  let batches = 0;
  let statusChecks = 0;
  const configPath = "/api/receipts/openai/config";
  const scanPath = "/api/receipts/openai";
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    if (req.method === "GET" && path === configPath) {
      statusChecks++;
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          provider: "OpenAI",
          model: "gpt-6-astra",
          configured: batches === 0,
          remaining: batches === 0 ? 1 : 0,
          estimateGuardUsd: OPENAI_ESTIMATE_GUARD_USD,
          availability: batches ? "exhausted" : "ready",
        }),
      );
    } else if (req.method === "POST" && path === scanPath) {
      batches++;
      for await (const _ of req) {
        /* Consume the synthetic upload. */
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ receipt: aiCostcoDraft() }));
    } else if (stalled && path === "/") {
      // Simulate having Wi-Fi while the app server stops answering.
      return;
    } else if (denied && path === "/") {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("Sign in to Gather.");
    } else if (newer && path === "/sw.js") {
      res.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      res.end(script.replace('const version = "', 'const version = "updated-'));
    } else if (newer && (path === "/" || path === "/index.html")) {
      res.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-store",
        "x-gather-shell": "1",
      });
      res.end(html.replace("<body>", '<body data-beta-version="updated">'));
    } else if (!(await serveBuiltFile(req, res, path, routes))) {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    await page.goto(origin);
    await installed(page);
    await page
      .getByLabel("Upload receipt images")
      .setInputFiles([
        "tests/fixtures/prepared-section.jpg",
        "tests/fixtures/camera-receipt.png",
      ]);
    await expect(page.locator(".selected-image")).toHaveCount(2);
    newer = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration!.update();
    });
    await expect(
      page.getByRole("status").filter({ hasText: "An update is ready" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-beta-version");
    await expect(page.locator(".selected-image")).toHaveCount(2);

    await page
      .getByRole("checkbox", { name: /^Send these receipt sections/ })
      .check();
    await page
      .getByRole("button", { name: "Read receipt with OpenAI credits" })
      .click();
    const receipt = page.getByRole("region", { name: "Digital receipt" });
    await expect(receipt).toContainText("£176.78");
    expect(batches).toBe(1);
    const privatePaths = await page.evaluate(async () => {
      const shellNames = (await caches.keys()).filter((name) =>
        name.startsWith("gather-shell-"),
      );
      const files = await Promise.all(
        shellNames.map(async (name) => (await caches.open(name)).keys()),
      );
      return files
        .flat()
        .map((entry) => new URL(entry.url).pathname)
        .filter((path) => path.startsWith("/api/"));
    });
    expect(privatePaths).toEqual([]);
    await expect(page.getByText("Draft saved on this device")).toBeVisible();
    await page.close();
    const relaunched = await context.newPage();
    await expect
      .poll(async () => {
        await relaunched.goto(origin);
        return relaunched.locator("body").getAttribute("data-beta-version");
      })
      .toBe("updated");
    await expect(
      relaunched.getByRole("region", { name: "Digital receipt" }),
    ).toContainText("£176.78");
    await installed(relaunched);
    const shells = await relaunched.evaluate(async () =>
      (await caches.keys()).filter((name) => name.startsWith("gather-shell-")),
    );
    expect(shells).toEqual([expect.stringMatching(/^gather-shell-updated-/)]);
    stalled = true;
    await relaunched.reload({ timeout: 9000 });
    await expect(
      relaunched.getByRole("region", { name: "Digital receipt" }),
    ).toContainText("£176.78");
    stalled = false;
    denied = true;
    expect((await relaunched.reload())?.status()).toBe(401);
    await expect(relaunched.locator("body")).toContainText(
      "Sign in to Gather.",
    );
    expect(statusChecks).toBeGreaterThanOrEqual(2);
    expect(batches).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
