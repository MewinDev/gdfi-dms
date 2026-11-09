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
  await expect(page).toHaveURL(/\/loans\?fill=GD1652026901003/);
  await expect(visibleSearchBox(page)).toHaveValue("GD1652026901003");
  await expect(visibleSearchBox(page)).toBeFocused();
  expect(await db.loan.count()).toBe(0);
});

test("Find a loan: only the 3 samples are listed; a card fills the box; other mock PNs still work if typed", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const samples = page.getByRole("region", { name: "Sample loans" });
  const cards = samples.getByRole("button");
  await expect(cards).toHaveCount(3);
  for (const s of ["GD1012026901001", "GD1652026901003", "GD1652026901004"]) await expect(samples.getByText(new RegExp(s))).toBeVisible();
  for (const c of await cards.all()) await expect(c).toContainText("Try it");
  await expect(page.getByText("GD1652026901008")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Data-check samples" })).toHaveCount(0);

  await samples.getByRole("button", { name: /Maria Santos/ }).click();
  const box = page.getByRole("main").getByLabel("Find a loan");
  await expect(box).toHaveValue("GD1012026901001");
  expect(await db.loan.count()).toBe(0);

  // Not listed, but still works when typed: refused by the Data Check, nothing saved.
  await box.fill("GD1652026901008");
  await page.getByRole("main").getByRole("button", { name: /^Find/ }).click();
  await expect(page.getByText("This loan is not released yet.")).toBeVisible();
  expect(await db.loan.count()).toBe(0);
});

test("Admin: Show data-check test PNs; starting over is the Test kit, which is not offered on the test database", async ({ page }) => {
  // Something to reset
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
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
  await expect(extra.getByText("GD1012026999999")).toBeVisible();
  await expect(extra.getByText(/Not released yet/)).toBeVisible();

  // Turn it back off
  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=test-data");
  await page.locator("form", { hasText: "Show data-check test PNs" }).getByRole("button", { name: "Turn off" }).click();

  // Reset test data is replaced by Settings > Test kit (lib/kit). The kit only works on gdfi_dms, so on
  // this server (the test database) its card is not listed and its addresses are "not found".
  await expect(page.getByRole("button", { name: "Reset test data" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("npm run kit:reset");
  await page.goto("/admin/settings");
  await expect(page.locator("#card-test-data")).toBeVisible();
  await expect(page.locator("#card-test-kit")).toHaveCount(0);
  for (const url of ["/admin/settings?open=test-kit", "/admin/test-kit", "/admin/test-kit/sheet"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
  }
  expect(await db.loan.count()).toBe(1); // nothing was reset
});
