import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { email, passphrase } from "../synthetic-provider.mjs";

async function openForm(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeFocused();
}
async function credentials(page: Page, address = email, password = passphrase) {
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

test("keyboard, error focus, narrow layout, autofill attributes and password visibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 680 });
  await openForm(page);
  const input = page.getByLabel("Email address");
  const secret = page.getByLabel("Password", { exact: true });
  await expect(input).toHaveAttribute("autocomplete", "username");
  await expect(secret).toHaveAttribute("autocomplete", "current-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill(email);
  await input.press("Tab");
  await expect(secret).toBeFocused();
  await secret.fill("incorrect synthetic passphrase");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(secret).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(secret).toHaveAttribute("type", "password");
  await secret.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Couldn’t sign in");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(input).toHaveValue(email);
  await expect(secret).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".account-shell")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("duplicate submissions are blocked, sign-in keeps the local draft, and saving is explicit", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the Costco demo" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await credentials(
    page,
    info.project.name === "desktop" ? email : info.project.name + "-" + email,
  );
  let submissions = 0;
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/sign-in") submissions++;
    if (path.startsWith("/api/account/") && request.method() !== "GET")
      writes.push(path);
  });
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("£176.78").first()).toBeVisible();
  expect(submissions).toBe(1);
  expect(writes).toHaveLength(0);
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-gather-session",
  );
  expect(session).toMatchObject({
    secure: true,
    httpOnly: true,
  });
  const retained = await page.evaluate(() =>
    JSON.stringify({
      storage: { ...localStorage, ...sessionStorage },
      cookie: document.cookie,
    }),
  );
  expect(retained).not.toContain("__Host-gather-session");
  expect(retained).not.toContain(passphrase);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText("No saved receipts yet.")).toBeVisible();
  await page.getByRole("button", { name: "Save current receipt" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Receipt saved to your account",
  );
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("You’re signed out");
  await page.getByRole("link", { name: "Continue as guest" }).click();
  await expect(page.getByText("£176.78").first()).toBeVisible();
});

test("registration, verification, reset and invalid link screens", async ({
  page,
}) => {
  const address = "browser-" + randomUUID() + "@example.test";
  async function follow(kind: "verify" | "reset") {
    const mailbox = await page.request.get("/__test/mail", {
      params: { email: address, kind },
    });
    expect(mailbox.ok()).toBe(true);
    const { code } = await mailbox.json();
    await page.goto(
      "/auth/action?mode=" +
        (kind === "verify" ? "verifyEmail" : "resetPassword") +
        "&oobCode=" +
        code +
        "&continueUrl=https://attacker.example",
    );
    await expect(page).toHaveURL(/\/auth\/action$/);
    return code as string;
  }
  await openForm(page);
  await page.getByRole("button", { name: "Create an account" }).click();
  await credentials(page, address);
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "verification email is on its way",
  );
  await follow("verify");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Email verified");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill(address);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "reset link is on its way",
  );
  const used = await follow("reset");
  await page
    .getByLabel("New password", { exact: true })
    .fill("another strong browser passphrase");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  await page.goto("/auth/action?mode=resetPassword&oobCode=" + used);
  await page
    .getByLabel("New password", { exact: true })
    .fill("another strong browser passphrase");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(
    page.getByRole("heading", { name: "This link can’t be used" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request a new link" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
});

test("connection errors preserve the email and account expiry returns to sign-in", async ({
  page,
}) => {
  await openForm(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (input === "/api/auth/sign-in") {
        window.fetch = original;
        return Promise.reject(
          new TypeError("Synthetic connection interruption"),
        );
      }
      return original(input, options);
    };
  });
  await credentials(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  await credentials(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  const revoked = await page.request.post("/api/auth/sign-out", {
    headers: { Origin: new URL(page.url()).origin },
    data: {},
  });
  expect(revoked.ok()).toBe(true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your session ended");
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("Google sign-in keeps a selected receipt in its original tab", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (input === "/api/auth/session")
        return Promise.resolve(
          Response.json({ availability: "ready", session: null, google: true }),
        );
      if (input === "/api/auth/google/start")
        return Promise.resolve(
          Response.json({
            url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
          }),
        );
      return original(input, options);
    };
  });
  await page.goto("/");
  await page
    .getByLabel("Upload receipt images")
    .setInputFiles(resolve("tests/fixtures/prepared-section.jpg"));
  await expect(page.locator(".selected-image")).toHaveCount(1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const google = page.getByRole("link", {
    name: "Open Google sign-in in a new tab",
  });
  await expect(google).toHaveAttribute("target", "_blank");
  await expect(google).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByRole("link", { name: "Continue as guest" }).click();
  await expect(page.locator(".selected-image")).toHaveCount(1);
});
