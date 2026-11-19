import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { costcoDemo } from "../../../src/lib/demo";
import { newState, receiptStamp } from "../../../src/lib/model";
import { STORAGE_KEY } from "../../../src/lib/storage";
import { email, passphrase } from "../synthetic-provider.mjs";

async function signIn(page: Page, address: string) {
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("save from Summary, then reopen itemized receipts and their original split", async ({
  page,
}, info) => {
  const address = "library-" + info.project.name + "-" + email;
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the Costco demo" }).click();
  await page
    .getByRole("button", { name: "Confirm receipt & add people" })
    .click();
  for (const name of ["Alex", "Jamie"]) {
    await page
      .getByRole("textbox", { name: "Person’s name", exact: true })
      .fill(name);
    await page.getByRole("button", { name: "Add person", exact: true }).click();
  }
  await page.getByRole("button", { name: "Let’s share it" }).click();
  await page
    .getByRole("button", { name: "Whole receipt", exact: true })
    .click();
  await page
    .getByTestId("whole-assignment")
    .getByRole("checkbox", { name: "Alex (person 1)" })
    .check();
  await page
    .getByTestId("whole-assignment")
    .getByRole("checkbox", { name: "Jamie (person 2)" })
    .check();
  await page
    .getByRole("button", { name: "Finalize split", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign in to save" }).click();
  await signIn(page, address);
  const keep = page.getByRole("region", { name: "Keep this receipt" });
  const save = keep.getByRole("button", { name: "Save receipt", exact: true });
  await expect(save).toBeVisible();
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const layoutAudit = () =>
    new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  expect(
    (await layoutAudit().include(".summary-save-card").analyze()).violations,
  ).toEqual([]);
  await expect(page.getByTestId("person-total-0")).toHaveText("£88.39");
  await expect(page.getByTestId("person-total-1")).toHaveText("£88.39");
  if (info.project.name === "webkit-mobile")
    await keep.screenshot({ path: info.outputPath("summary-save-card.png") });

  const writes: string[] = [];
  let droppedResponse = false;
  await page.route("**/api/account/receipts/*", async (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.continue();
    writes.push(new URL(request.url()).pathname);
    const { payload } = request.postDataJSON();
    expect(payload).toMatchObject({
      savedAsFinal: true,
      finalizedStamp: "",
      receipt: { rawText: "" },
    });
    if (droppedResponse) return route.continue();
    droppedResponse = true;
    // The server saves successfully but the phone loses that response.
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort();
  });
  await save.click();
  await expect(keep.getByRole("alert")).toContainText(
    "couldn’t reach the account server",
  );
  await save.click();
  await expect(keep.getByRole("status")).toHaveText(
    "Receipt saved to your Library.",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toBe(writes[1]);
  await page.unroute("**/api/account/receipts/*");
  await keep.getByRole("button", { name: "View Library" }).click();
  await expect(
    page.getByRole("button", { name: "Open receipt Costco", exact: true }),
  ).toHaveCount(1);
  expect(
    (await layoutAudit().include(".account-library").analyze()).violations,
  ).toEqual([]);
  if (info.project.name === "webkit-mobile")
    await page.getByRole("region", { name: "Saved receipts" }).screenshot({
      path: info.outputPath("library-receipt.png"),
    });

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.goto("/?account=1");
  await signIn(page, address);
  await page
    .getByRole("button", { name: "Open receipt Costco", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your saved receipt." }),
  ).toBeFocused();
  const receipt = page.getByRole("region", { name: "Digital receipt" });
  await expect(receipt.getByRole("listitem")).toHaveCount(18);
  await expect(receipt.getByTestId("digital-item-3")).toContainText(
    "Chicken skewers",
  );
  await expect(receipt.locator(".receipt-grand-total")).toContainText(
    "£176.78",
  );
  await page.getByRole("button", { name: "View split", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Every penny has a home." }),
  ).toBeVisible();
  await expect(page.getByTestId("person-total-0")).toHaveText("£88.39");
  await expect(page.getByTestId("person-total-1")).toHaveText("£88.39");
  await expect(
    keep.getByRole("button", { name: "View Library" }),
  ).toBeVisible();

  const legacy = newState();
  legacy.receipt = { ...costcoDemo(), merchant: "Older Costco copy" };
  legacy.people = [
    { id: "a", name: "Alex" },
    { id: "b", name: "Jamie" },
  ];
  legacy.splitMode = "whole";
  legacy.wholeAssignment.participants = ["a", "b"];
  legacy.step = "summary";
  legacy.reviewedStamp = receiptStamp(legacy.receipt);
  const stored = await page.request.put(
    "/api/account/receipts/" + randomUUID(),
    {
      headers: { Origin: new URL(page.url()).origin },
      data: { payload: legacy },
    },
  );
  expect(stored.ok()).toBe(true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", {
      name: "Open receipt Older Costco copy",
      exact: true,
    })
    .click();
  await expect(
    receipt.getByRole("heading", { name: "Older Costco copy" }),
  ).toBeVisible();
  await expect(receipt.getByRole("listitem")).toHaveCount(18);
  await page.getByRole("button", { name: "View split", exact: true }).click();
  await expect(page.getByTestId("person-total-0")).toHaveText("£88.39");
  await expect(page.getByTestId("person-total-1")).toHaveText("£88.39");
  await expect(
    page.getByRole("heading", { name: "Ready to finalize" }),
  ).toBeVisible();
});
