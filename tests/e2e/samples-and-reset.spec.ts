import { expect, test } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox } from "./helpers";

// The dev server runs with TEST_MODE=true (.env). "Hidden when TEST_MODE is off" is a unit test.
test.beforeEach(async () => {
  await resetLoans();
});

test("fresh start: Home shows the empty state and the three sample loans", async ({ page }) => {
  await signIn(page, "la");
  await expect(page.getByText("Nothing needs you yet. Find a loan or pick a sample to start.")).toBeVisible();
  const samples = page.getByRole("region", { name: "Sample loans" });
  await expect(samples.getByRole("button")).toHaveCount(3);
  await expect(samples.getByText("TEST MODE")).toBeVisible();

  // Home has no search box: a card opens My loans with the PN in its box. Nothing is searched or saved.
  await samples.getByRole("button", { name: /Ana Villanueva/ }).click();
  await expect(page).toHaveURL(/\/loans\?fill=PN-0001003/);
  await expect(visibleSearchBox(page)).toHaveValue("PN-0001003");
  await expect(visibleSearchBox(page)).toBeFocused();
  expect(await db.loan.count()).toBe(0);
});

test("Find a loan: only the 3 samples are listed; a card fills the box; other mock PNs still work if typed", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const samples = page.getByRole("region", { name: "Sample loans" });
  const cards = samples.getByRole("button");
  await expect(cards).toHaveCount(3);
  for (const s of ["PN-0001001", "PN-0001003", "PN-0001004"]) await expect(samples.getByText(new RegExp(s))).toBeVisible();
  for (const c of await cards.all()) await expect(c).toContainText("Try it");
  await expect(page.getByText("PN-0001008")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Data-check samples" })).toHaveCount(0);

  await samples.getByRole("button", { name: /Maria Santos/ }).click();
  const box = page.getByRole("main").getByLabel("Find a loan");
  await expect(box).toHaveValue("PN-0001001");
  expect(await db.loan.count()).toBe(0);

  // Not listed, but still works when typed: refused by the Data Check, nothing saved.
  await box.fill("PN-0001008");
  await page.getByRole("main").getByRole("button", { name: /^Find/ }).click();
  await expect(page.getByText("This loan is not released yet.")).toBeVisible();
  expect(await db.loan.count()).toBe(0);
});

test("Admin: Show data-check test PNs, then Reset test data", async ({ page }) => {
  // Something to reset
  await signIn(page, "la");
  await page.goto("/search?q=PN-0001001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/PN-0001001/);
  await page.context().clearCookies();

  await signIn(page, "admin");
  await page.goto("/admin/settings?open=test-data");
  const toggle = page.locator("form", { hasText: "Show data-check test PNs" });
  if ((await toggle.getByRole("button").textContent())?.includes("Turn on")) {
    await toggle.getByRole("button", { name: "Turn on" }).click();
    await expect(toggle.getByRole("button", { name: "Turn off" })).toBeVisible();
  }
  // The Loan Associate now sees them on My loans (where the search and samples live).
  await page.context().clearCookies();
  await signIn(page, "la");
  await page.goto("/loans");
  const extra = page.getByRole("region", { name: "Data-check samples" });
  await expect(extra.getByText("PN-9999999")).toBeVisible();
  await expect(extra.getByText(/Not released yet/)).toBeVisible();

  // Turn it back off
  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=test-data");
  await page.locator("form", { hasText: "Show data-check test PNs" }).getByRole("button", { name: "Turn off" }).click();

  // Reset
  const auditBefore = await db.auditLog.count({ where: { action: "test_data_reset" } });
  await page.getByRole("button", { name: "Reset test data" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Reset test data?" });
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog.getByRole("button", { name: "Yes, reset" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Test data reset." });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Loan files: 1 removed");
  expect(await db.loan.count()).toBe(0);
  expect(await db.user.count({ where: { email: "test.la@gdfi.ph" } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "test_data_reset" } })).toBe(auditBefore + 1);
});
