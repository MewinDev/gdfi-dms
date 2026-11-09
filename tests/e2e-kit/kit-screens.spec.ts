import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The Manual Test Kit in the browser (playwright.kit.config.ts): the sign-in list with roles and
 * branches, two sample accounts opening two sample loans, the Test kit panel and the test sheet.
 * Screenshots go to docs/screenshots/test-kit/. Reads only (besides the sign-in rows in the audit log).
 */
const DIR = "docs/screenshots/test-kit";
mkdirSync(DIR, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });

async function signInAs(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("[data-kit-accounts]").getByRole("button", { name: new RegExp(`^Continue as ${name}\\b`) }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async ({ request }) => {
  const html = await (await request.get("/login")).text();
  if (!html.includes("data-kit-accounts")) throw new Error("This server does not show the kit's sample accounts. Run npm run kit:start and point KIT_BASE_URL at the gdfi_dms server.");
});

test("sign-in list: each sample account with its role and branches", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  const list = page.locator("[data-kit-accounts]");
  await expect(list.getByRole("button")).toHaveCount(9); // the inactive LA is not listed
  await expect(list.getByRole("button", { name: /^Continue as LA 1\b/ })).toContainText("Loan Associate · Angono, Antipolo");
  await expect(list.getByRole("button", { name: /^Continue as Branch Supervisor\b/ })).toContainText("Branch Supervisor · Angono, Antipolo");
  await expect(list.getByRole("button", { name: /^Continue as Receiving LA A. Mabini\b/ })).toContainText("A. Mabini");
  await expect(list.getByRole("button", { name: /Inactive LA/ })).toHaveCount(0);
  await shot(page, "sign-in-list");
});

test("LA 1 opens GD1012026902013 (on hold by LA 1 and LA 2)", async ({ page }) => {
  await signInAs(page, "LA 1");
  await page.goto("/loans/GD1012026902013");
  await expect(page.getByRole("main")).toContainText("GD1012026902013");
  await expect(page.getByRole("main")).toContainText(/On hold/);
  await shot(page, "la1-GD1012026902013-on-hold");
});

test("DP 1 opens GD1012026902023 (Check and verify blocking)", async ({ page }) => {
  await signInAs(page, "DP 1");
  await page.goto("/loans/GD1012026902023");
  await expect(page.getByRole("main")).toContainText("GD1012026902023");
  await shot(page, "dp1-GD1012026902023");
});

test("Admin: Settings > Test kit and the test sheet", async ({ page }) => {
  await signInAs(page, "Admin");
  await page.goto("/admin/settings");
  await expect(page.locator("#card-test-kit")).toBeVisible();
  await page.goto("/admin/settings?open=test-kit");
  const panel = page.locator("[data-test-kit]");
  await expect(panel.locator("[data-kit-baseline]")).toContainText("migrations, the last");
  await expect(panel.getByRole("button", { name: "Reset to start" })).toBeEnabled();
  await shot(page, "settings-test-kit");
  // The typed confirmation: Reset is not done without RESET (Cancel here; nothing is reset).
  await panel.getByRole("button", { name: "Reset to start" }).click();
  const ask = page.getByRole("alertdialog", { name: "Reset to the starting state?" });
  await expect(ask.getByLabel("Type RESET to confirm")).toBeVisible();
  await shot(page, "settings-test-kit-reset-question");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await page.goto("/admin/test-kit/sheet");
  await expect(page.locator("[data-test-sheet]")).toContainText("GD1012026902001");
  await shot(page, "test-sheet");
});
