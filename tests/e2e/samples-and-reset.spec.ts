import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox } from "./helpers";

// The dev server runs with TEST_MODE=true (.env). "Hidden when TEST_MODE is off" is a unit test.
test.beforeEach(async () => {
  await resetLoans();
});

/** A samples group: one closed row ("Sample loans · TEST MODE"); the title is its heading. */
const group = (page: Page, title: string) => page.getByRole("main").locator("details", { has: page.getByRole("heading", { name: title, exact: true }) });
/** Opens the group and returns its sample buttons (one line each: PN, name, then the chip). */
async function openGroup(page: Page, title: string) {
  const g = group(page, title);
  await expect(g).toHaveCount(1);
  await expect(g).not.toHaveAttribute("open", ""); // closed by default
  await g.locator("summary").click();
  await expect(g).toHaveAttribute("open", "");
  return { g, cards: g.locator("ul").getByRole("button") };
}

test("fresh start: Home shows the empty state and the three sample loans", async ({ page }) => {
  await signIn(page, "la");
  await expect(page.getByRole("main").getByText("You're all caught up.")).toBeVisible();
  await expect(group(page, "Sample loans").locator("summary")).toContainText("TEST MODE");
  const { cards } = await openGroup(page, "Sample loans");
  await expect(cards).toHaveCount(3);

  // Home has no search box: a card opens My loans with the PN in its box. Nothing is searched or saved.
  await cards.filter({ hasText: "Ana Villanueva" }).click();
  await expect(page).toHaveURL(/\/loans\?fill=GD1652026901003/);
  await expect(visibleSearchBox(page)).toHaveValue("GD1652026901003");
  await expect(visibleSearchBox(page)).toBeFocused();
  expect(await db.loan.count()).toBe(0);
});

test("Find a loan: only the 3 samples are listed; a card fills the box; other mock PNs still work if typed", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const { g: samples, cards } = await openGroup(page, "Sample loans");
  await expect(cards).toHaveCount(3);
  for (const s of ["GD1012026901001", "GD1652026901003", "GD1652026901004"]) await expect(samples.getByText(s, { exact: true })).toBeVisible();
  for (const c of await cards.all()) await expect(c).toContainText("Try it");
  await expect(page.getByText("GD1652026901008")).toHaveCount(0);
  await expect(group(page, "Data-check samples")).toHaveCount(0);

  await cards.filter({ hasText: "Maria Santos" }).click();
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

  await signIn(page, "admin");
  await page.goto("/admin/settings?open=test-data");
  const toggle = page.locator("form", { hasText: "Show data-check test PNs" });
  if ((await toggle.getByRole("button").textContent())?.includes("Turn on")) {
    await toggle.getByRole("button", { name: "Turn on" }).click();
    await expect(toggle.getByRole("button", { name: "Turn off" })).toBeVisible();
  }
  // The Loan Associate now sees them on My loans (where the search and samples live).
  await signIn(page, "la");
  await page.goto("/loans");
  // A second closed row under the sample loans; what each one tests is in its tooltip.
  const { g: extra } = await openGroup(page, "Data-check samples");
  await expect(extra.getByText("GD1012026999999", { exact: true })).toBeVisible();
  await expect(extra.locator("ul").getByRole("button").filter({ hasText: "GD1652026901008" })).toHaveAttribute("title", /Check Prepared: the not-released card/);

  // Turn it back off
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
