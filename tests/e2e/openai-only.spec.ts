import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareOpenAiRequest } from "../../server/openai-reader.mjs";
import { OPENAI_ESTIMATE_GUARD_USD } from "../../src/lib/openai-schema.mjs";
import { aiCostcoDraft } from "../fixtures/ai-receipt";

// These journeys intercept the page transport. The PWA suite uses real workers.
test.use({ serviceWorkers: "block" });

const scan = (page: Page) =>
  page.getByRole("button", {
    name: "Read receipt with OpenAI credits",
    exact: true,
  });
const consent = (page: Page) =>
  page.getByRole("checkbox", {
    name: /^Send these receipt sections to OpenAI/,
  });

async function uploadPhotos(page: Page, count: number, height = 850) {
  const photo = await page.evaluate((height) => {
    const canvas = document.createElement("canvas");
    canvas.width = 700;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "28px monospace";
    context.fillText("SYNTHETIC CAFE", 32, 80);
    context.fillText("2 Ramen   18.80   37.20", 32, 160);
    context.fillText("TOTAL GBP 37.20", 32, 240);
    return canvas.toDataURL("image/png").split(",")[1];
  }, height);
  await page.getByLabel("Upload receipt images").setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `test-receipt-${index + 1}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    })),
  );
  await expect(page.locator(".selected-image")).toHaveCount(count);
}

// Fake responses exercise browser transport and review without using credits.
async function stubOpenAi(
  page: Page,
  fails = false,
  receipt?: ReturnType<typeof aiCostcoDraft>,
) {
  const requests: { photo: number; part: number }[][] = [];
  let remaining = 1;
  await page.route("**/api/receipts/openai/config", (route) =>
    route.fulfill({
      json: {
        provider: "OpenAI",
        model: "gpt-6-astra",
        configured: remaining > 0,
        remaining,
        estimateGuardUsd: OPENAI_ESTIMATE_GUARD_USD,
        availability: remaining ? "ready" : "exhausted",
      },
    }),
  );
  await page.route("**/api/receipts/openai", async (route) => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual([
      "consent",
      "panels",
      "useCredits",
    ]);
    expect(body.consent).toBe(true);
    expect(body.useCredits).toBe(true);
    const panels = body.panels as {
      photo: number;
      part: number;
      data: string;
    }[];
    // Exercise the real adapter's JPEG and cost validation on browser output.
    expect(() => prepareOpenAiRequest(panels)).not.toThrow();
    requests.push(panels.map(({ photo, part }) => ({ photo, part })));
    remaining = 0;
    if (fails) {
      await route.fulfill({
        status: 429,
        json: { error: "OpenAI rate limit reached.", attemptUsed: true },
      });
      return;
    }
    await route.fulfill({
      json: {
        receipt: receipt ?? {
          merchant: "SYNTHETIC CAFE",
          date: "",
          currency: "GBP",
          subtotal: "37.20",
          printedTotal: "37.20",
          printedTax: "",
          taxRegistrationNumber: "",
          pricesIncludeTax: true,
          printedItemCount: 1,
          taxCodes: [],
          items: [
            {
              description: "Ramen",
              quantity: "2",
              unitPrice: "18.80",
              lineTotal: "37.20",
              discount: "0",
              taxCode: "",
              note: "",
              sourcePhotos: [...new Set(panels.map((panel) => panel.photo))],
            },
          ],
          adjustments: [],
          warnings: [],
        },
      },
    });
  });
  return requests;
}

test("shows the tall photo’s section count and disables OpenAI scanning without a key", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await uploadPhotos(page, 1, 2000);
  await expect(
    page.getByText("1 of 12 photos or PDF pages · 2 of 24 scan sections", {
      exact: true,
    }),
  ).toBeVisible();
  const openaiScan = page.getByRole("group", { name: "OpenAI scan" });
  await expect(openaiScan).toBeVisible();
  await expect(openaiScan).not.toContainText("US$");
  await expect(
    page.getByRole("button", { name: /On-device scan|Assisted scan/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Add a server-side OpenAI API key and restart Gather.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(scan(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Enter manually", exact: true }),
  ).toBeEnabled();
  expect((await request.get("/api/receipts/providers")).status()).toBe(404);
  expect(
    (
      await request.post("/api/receipts/recognize", {
        data: {},
        headers: { origin: new URL(page.url()).origin },
      })
    ).status(),
  ).toBe(404);
});

test("ordered photos use a single authorized OpenAI request and preserve exact splits", async ({
  page,
}) => {
  const requests = await stubOpenAi(page);
  await page.goto("/");
  await uploadPhotos(page, 2);
  await expect(scan(page)).toBeDisabled();
  await consent(page).check();
  await page
    .getByRole("button", { name: "Move image 2 earlier", exact: true })
    .click();
  await expect(consent(page)).not.toBeChecked();
  await expect(scan(page)).toBeDisabled();
  expect(requests).toHaveLength(0);
  await consent(page).check();
  await scan(page).click();
  const receipt = page.getByRole("region", { name: "Digital receipt" });
  await expect(receipt).toContainText("£18.60 each");
  await expect(receipt).toContainText("£37.20");
  expect(requests).toEqual([
    [
      { photo: 1, part: 1 },
      { photo: 2, part: 1 },
    ],
  ]);
  await page
    .getByRole("button", { name: "Confirm receipt & add people" })
    .click();
  for (const name of ["Alex", "Sam"]) {
    await page.getByLabel("Person’s name").fill(name);
    await page.getByRole("button", { name: "Add person", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Let’s share it", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Share all equally", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finalize split", exact: true })
    .click();
  await expect(page.getByTestId("person-total-0")).toHaveText("£18.60");
  await expect(page.getByTestId("person-total-1")).toHaveText("£18.60");
});

test("a text-bearing PDF sends its rendered pages through the OpenAI scan", async ({
  page,
}) => {
  const requests = await stubOpenAi(page);
  await page.goto("/");
  await page
    .getByLabel("Upload receipt images")
    .setInputFiles(resolve("tests/fixtures/pdfs/digital-two-page.pdf"));
  await expect(page.locator(".selected-image")).toHaveCount(2);
  await expect(
    page.getByText("2 of 12 photos or PDF pages · 2 of 24 scan sections", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Read PDF text on this device" }),
  ).toHaveCount(0);
  await consent(page).check();
  await scan(page).click();
  await expect(
    page.getByRole("region", { name: "Digital receipt" }),
  ).toBeVisible();
  expect(requests).toEqual([
    [
      { photo: 1, part: 1 },
      { photo: 2, part: 1 },
    ],
  ]);
});

test("a mocked two-photo Costco scan exports the exact VAT and split", async ({
  page,
}) => {
  const requests = await stubOpenAi(page, false, aiCostcoDraft());
  await page.goto("/");
  await uploadPhotos(page, 2);
  await consent(page).check();
  await scan(page).click();
  const receipt = page.getByRole("region", { name: "Digital receipt" });
  await expect(receipt.locator('[data-testid^="digital-item-"]')).toHaveCount(
    18,
  );
  await expect(receipt.getByTestId("digital-item-3")).toContainText("−£2.00");
  await expect(receipt).toContainText("£13.62");
  await expect(receipt.locator(".receipt-grand-total")).toContainText(
    "£176.78",
  );
  expect(requests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Confirm receipt & add people" })
    .click();
  for (const name of ["Alex", "Sam"]) {
    await page.getByLabel("Person’s name").fill(name);
    await page.getByRole("button", { name: "Add person", exact: true }).click();
  }
  await page.getByRole("button", { name: "Let’s share it" }).click();
  await page
    .getByRole("button", { name: "Share all equally", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finalize split", exact: true })
    .click();
  const amounts = await Promise.all(
    [0, 1].map((index) =>
      page.getByTestId(`person-total-${index}`).textContent(),
    ),
  );
  expect(
    amounts.reduce(
      (sum, amount) => sum + Number(amount?.replace(/[^0-9]/g, "")),
      0,
    ),
  ).toBe(17678);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download summary" }).click();
  const summary = await readFile((await (await download).path())!, "utf8");
  expect(summary).toContain("Receipt total: £176.78");
  expect(summary).toContain("Allocated: £176.78");
  expect(summary).toContain(`Alex (person 1): ${amounts[0]}`);
  expect(summary).toContain(`Sam (person 2): ${amounts[1]}`);
});

test("a failed scan keeps the photos and updates the allowance without retrying", async ({
  page,
}) => {
  const requests = await stubOpenAi(page, true);
  await page.goto("/");
  await uploadPhotos(page, 1);
  await consent(page).check();
  await scan(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "OpenAI rate limit reached. One app attempt was used.",
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The app’s OpenAI scan allowance is used up." }),
  ).toBeVisible();
  await expect(consent(page)).not.toBeChecked();
  await expect(scan(page)).toBeDisabled();
  await expect(page.locator(".selected-image")).toHaveCount(1);
  expect(requests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your receipt." }),
  ).toBeVisible();
});

test("leaving during a scan preserves the prior draft and never replays the upload", async ({
  page,
}) => {
  await stubOpenAi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the Costco demo" }).click();
  await expect(page.getByText("Draft saved on this device")).toBeVisible();
  await page.getByRole("link", { name: "Gather home" }).click();
  await uploadPhotos(page, 1);
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let submissions = 0;
  await page.route("**/api/receipts/openai", async (route) => {
    submissions++;
    await held;
    await route.fulfill({ json: { receipt: aiCostcoDraft() } }).catch(() => {});
  });
  await consent(page).check();
  page.once("dialog", (dialog) => dialog.accept());
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/receipts/openai"),
  );
  await scan(page).click();
  await sent;
  try {
    // Exercise the close/navigation event without losing the test's tab.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect(page.getByRole("alert")).toContainText(
      "Scan cancelled. If the request reached the server",
    );
    await expect(page.locator(".selected-image")).toHaveCount(1);
    await expect(consent(page)).not.toBeChecked();
    await expect(scan(page)).toBeDisabled();
  } finally {
    release();
  }
  await page.reload();
  await expect(page.locator(".selected-image")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "2 Review" })).toBeEnabled();
  await page.getByRole("button", { name: "2 Review" }).click();
  const draft = page.getByRole("region", { name: "Digital receipt" });
  await expect(draft.getByRole("heading", { name: "Costco" })).toBeVisible();
  await expect(draft).toContainText("£176.78");
  expect(submissions).toBe(1);
});
