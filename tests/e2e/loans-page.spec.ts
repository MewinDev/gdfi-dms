import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox } from "./helpers";

const filtersBtn = (page: Page) => page.getByRole("main").getByRole("button", { name: /^Filters/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Filters" });

test.beforeEach(async () => {
  await resetLoans();
});

/** No horizontal scroll at this width. */
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("Admin Loans: one toolbar, Filters with a count, chips, Clear all, Show results, refresh keeps filters", async ({ page }) => {
  // One loan file so filters have something to count.
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await page.context().clearCookies();
  await signIn(page, "admin");

  await page.goto("/loans?tab=all");
  await expect(filtersBtn(page)).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0); // no dropdowns on the page itself
  await expect(page.getByText("Showing 1 loan file")).toBeVisible();
  await noSideScroll(page);

  // Esc closes the panel without changing anything.
  await filtersBtn(page).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByLabel("Classification").selectOption("FINANCING");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/classification=/);

  // Show results applies; the count updates as filters change.
  await filtersBtn(page).click();
  await panel(page).getByLabel("Classification").selectOption("REFINANCING");
  await expect(panel(page).getByRole("button", { name: "Show results (1)" })).toBeVisible();
  const qc = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  await panel(page).getByLabel("Branch").selectOption(qc.id);
  await panel(page).getByRole("button", { name: /^Show results/ }).click();
  await expect(page).toHaveURL(/classification=REFINANCING/);
  await expect(filtersBtn(page)).toHaveAccessibleName("Filters, 2 on");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Remove filter Classification: Refinancing" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Remove filter Branch: Antipolo" })).toBeVisible();

  // Refresh keeps them.
  await page.reload();
  await expect(main.getByRole("link", { name: "Remove filter Branch: Antipolo" })).toBeVisible();

  // Removing a chip updates the list at once.
  await main.getByRole("link", { name: "Remove filter Branch: Antipolo" }).click();
  await expect(page).not.toHaveURL(/branch=/);
  await expect(filtersBtn(page)).toHaveAccessibleName("Filters, 1 on");
  await main.getByRole("link", { name: "Clear all" }).click();
  await expect(page).not.toHaveURL(/classification=/);
  await expect(filtersBtn(page)).toHaveAccessibleName("Filters");
  await expect(main.getByRole("link", { name: /^Remove filter/ })).toHaveCount(0);
});

test("Admin Loans: empty state with and without filters; tabs without arrows; PN search and /", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/loans?tab=all");
  const main = page.getByRole("main");
  await expect(main.getByText("No loan files here yet.")).toBeVisible();
  await expect(main.getByText("Try removing a filter.")).toHaveCount(0);
  await expect(main.getByText("Sample loans are opened from My loans by a Loan Associate.")).toBeVisible();
  await expect(main.getByRole("table")).toHaveCount(0);

  await page.goto("/loans?tab=all&classification=FINANCING");
  await expect(main.getByText("Try removing a filter.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Clear all" }).last()).toBeVisible();

  // Tabs: a segmented control with counts; no scrollbar or arrows.
  const tabs = page.getByRole("navigation", { name: "Loan lists" });
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.getByRole("link", { name: /^All loans/ })).toHaveAttribute("aria-current", "page");
  expect(await tabs.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
  await noSideScroll(page);

  // Search and "/"
  const box = visibleSearchBox(page);
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await box.fill("PN-0009");
  await box.press("Enter");
  await expect(page).toHaveURL(/q=PN-0009/);
});

test("No Export CSV for now, even with the export permission; the old address is gone", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/loans");
  await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  expect((await page.request.get("/api/loans/export")).status()).toBe(404);
});

test("Loan Associate My loans: compact search, samples in one row, the list below; Filters panel closes on outside click", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "My loans" })).toHaveCount(1);
  await expect(main.getByRole("search", { name: "Search" })).toHaveCount(1);
  await expect(main.getByRole("region", { name: "Sample loans" }).getByRole("button")).toHaveCount(3);
  await expect(main.getByText("Showing 0 loan files")).toBeVisible();
  await noSideScroll(page);

  await filtersBtn(page).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByLabel("Loan type").selectOption("New");
  // Outside click: on desktop a click elsewhere on the page; on tablet/phone the dimmed background.
  await page.mouse.click(5, page.viewportSize()!.width >= 1024 ? 300 : 5);
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/loanType=/);
});
