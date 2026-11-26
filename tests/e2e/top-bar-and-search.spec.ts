import { expect, test, type Page } from "@playwright/test";
import { resetLoans } from "./db";
import { signIn, topBar, visibleSearchBox } from "./helpers";

const SYSTEM_NAME = /Loan Documents\s*Management System/;

async function expectCleanTopBar(page: Page, pageName: string) {
  const bar = topBar(page);
  await expect(bar).toHaveCount(1);
  await expect(bar).toContainText(SYSTEM_NAME);
  await expect(bar.getByRole("searchbox")).toHaveCount(0);
  await expect(bar.getByRole("textbox")).toHaveCount(0);
  await expect(bar.getByRole("search")).toHaveCount(0);
  await expect(bar).not.toContainText(pageName);
  // The page name is shown once, as the heading in the content.
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: pageName })).toBeVisible();
}

test.beforeEach(async () => {
  await resetLoans();
});

test("LA: no search in the top bar on Home and Loan File; the system name is on every page", async ({ page }) => {
  await signIn(page, "la");
  await expectCleanTopBar(page, "Home");
  await expect(visibleSearchBox(page)).toHaveCount(0);

  await page.goto("/notifications");
  await expectCleanTopBar(page, "Updates");

  // Open a loan file
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await expectCleanTopBar(page, "Loan File");
  await expect(visibleSearchBox(page)).toHaveCount(0);
});

test("LA: the Loans page has the search, and / focuses it", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Loans" })).toBeVisible();
  const box = visibleSearchBox(page);
  await expect(box).toBeVisible();
  // Live MyLoans suggestions: PN or borrower name (the mock supports search).
  await expect(box).toHaveAttribute("placeholder", "Search PN, name or CIN");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(box).not.toBeFocused();
  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("");

  // The search still works the same way.
  await box.fill("GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("main").locator("[data-find-source]")).toBeVisible();
});

test("LA: Find loan opens Loans with the search focused", async ({ page }) => {
  await signIn(page, "la");
  const vw = page.viewportSize()!.width;
  test.skip(vw < 768, "Phones have no Find loan button in the top bar; Loans is in the menu (D-058).");
  await topBar(page).getByRole("link", { name: "Find loan" }).click();
  await expect(page).toHaveURL(/\/loans/);
  await expect(visibleSearchBox(page)).toBeFocused();
  // One search per page (D-059): the Loans page has its own box and Search button, so the header has no Find loan there.
  await expect(topBar(page).getByRole("link", { name: "Find loan" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "Search", exact: true })).toHaveCount(1);
  for (const p of ["/inbox", "/notifications"]) {
    await page.goto(p);
    await expect(topBar(page).getByRole("link", { name: "Find loan" })).toBeVisible();
  }
});

test("Admin: no Find loan button; Settings and Loans have a clean top bar; Loans search filters the list", async ({ page }) => {
  await signIn(page, "admin");
  await expect(topBar(page).getByRole("link", { name: "Find loan" })).toHaveCount(0);
  await expect(topBar(page).getByRole("button", { name: "Find loan" })).toHaveCount(0);

  await page.goto("/admin/settings");
  await expectCleanTopBar(page, "Settings");

  for (const [url, name] of [["/admin/users", "Users"], ["/admin/audit", "Audit Log"]] as const) {
    await page.goto(url);
    await expectCleanTopBar(page, name);
  }

  await page.goto("/loans");
  await expectCleanTopBar(page, "Loans");
  const box = visibleSearchBox(page);
  await expect(box).toBeVisible();
  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await box.fill("PN-NOTHING");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=PN-NOTHING/);
  await expect(page.getByText("No loan files here yet.")).toHaveCount(0);
  await expect(page.getByText(/No loans match/)).toBeVisible();
  // A search alone: no Clear filters (there are none to clear; the search box clears the search).
  await expect(page.getByRole("main").getByRole("link", { name: "Clear filters" })).toHaveCount(0);
});
