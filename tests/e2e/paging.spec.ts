import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signInWith, watchConsole } from "./helpers";

/**
 * Paging on long lists: Loans (50 a page), My loans (50), Settings > Users (100). The page is in the
 * address; counts stay the total; a filter or the search goes back to page 1. Screenshots at every width:
 * docs/screenshots/paging/.
 */
const DIR = "docs/screenshots/paging";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const rows = (page: Page) => main(page).locator("[data-loan-row]:visible");
const pager = (page: Page) => main(page).locator("[data-pager]");
const USERS = 105;
const userEmail = (i: number) => `zz.pager.${String(i).padStart(3, "0")}@gdfi.ph`;

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/** One line; Previous and Next at least 44 by 44 px. */
async function pagerFits(page: Page) {
  const box = (await pager(page).boundingBox())!;
  expect(box.height).toBeLessThan(50);
  for (const sel of ["[data-pager-prev]", "[data-pager-next]"]) {
    const b = (await pager(page).locator(sel).boundingBox())!;
    expect(b.height, sel).toBeGreaterThanOrEqual(44);
    expect(b.width, sel).toBeGreaterThanOrEqual(44);
    expect(Math.abs(b.y + b.height / 2 - (box.y + box.height / 2)), `${sel} on the same line`).toBeLessThan(4);
  }
}

/** 120 loan files (60 "Alpha", 60 "Beta"), released one minute apart, so the list order is known. */
async function seed120() {
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const branches = await db.branch.findMany({ where: { code: { in: ["101", "165"] } } });
  const t0 = new Date("2026-11-02T01:00:00Z").getTime();
  await db.loan.createMany({
    data: Array.from({ length: 120 }, (_, i) => {
      const b = branches[i % 2];
      return {
        pn: `GD${b.code}2026907${String(i + 1).padStart(3, "0")}`, borrowerName: `${i % 2 ? "Beta" : "Alpha"} Pager ${String(i + 1).padStart(3, "0")}`, branchId: b.id, loanType: "New",
        productName: "Auto Refinancing", totalReleasedAmount: 1_000_000, releasedAt: new Date(t0 + i * 60_000), sourceStatus: "RELEASED" as const, retrievedAt: new Date(),
        openedById: la.id, classification: "REFINANCING" as const, mortgageResult: "MORTGAGE" as const, ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage: "For checklist",
      };
    }),
  });
  // Released order, then PN: the list's own order.
  return (await db.loan.findMany({ orderBy: [{ releasedAt: "asc" }, { pn: "asc" }], select: { pn: true } })).map((l) => l.pn);
}
async function cleanUsers() {
  await db.user.deleteMany({ where: { email: { startsWith: "zz.pager." } } });
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanUsers();
});
test.afterAll(async () => {
  await resetLoans();
  await cleanUsers();
});

test("Loans: 120 loan files are 3 pages of 50; counts stay the total; the page survives refresh and Back; the search goes to page 1", async ({ page }) => {
  const clean = watchConsole(page);
  const order = await seed120();
  await signInWith(page, "Continue as Admin");
  await page.goto("/loans?tab=all");
  await expect(rows(page)).toHaveCount(50);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("1–50 of 120");
  await expect(main(page).locator('[data-tab="all"] [data-tab-count]')).toHaveText("120");
  await expect(main(page).locator('[data-tab="queue"] [data-tab-count]')).toHaveText("120");
  await expect(pager(page).locator("[data-pager-prev]")).not.toHaveAttribute("href", /./); // nothing before page 1
  // The order is the list's own: page 1 is the first 50.
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-loan-row")))).toEqual(order.slice(0, 50));
  await pagerFits(page);
  await noSideways(page);
  await shot(page, "loans-page-1");

  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("51–100 of 120");
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-loan-row")))).toEqual(order.slice(50, 100));
  await expect(main(page).locator('[data-tab="all"] [data-tab-count]')).toHaveText("120"); // the total, not the page
  await noSideways(page);
  await shot(page, "loans-page-2");
  // Refresh keeps page 2.
  await page.reload();
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("51–100 of 120");
  // Page 3: the last 20; Next is greyed.
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("101–120 of 120");
  await expect(rows(page)).toHaveCount(20);
  await expect(pager(page).locator("[data-pager-next]")).toHaveAttribute("aria-disabled", "true");
  // Back: page 2 again.
  await page.goBack();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("51–100 of 120");

  // The search applies before paging and goes back to page 1; "Showing X of Y" is the total.
  const box = page.locator("#find-loan");
  await box.fill("Beta");
  await box.press("Enter");
  await expect(page).toHaveURL(/q=Beta/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("1–50 of 60");
  await expect(main(page).locator("[data-showing]")).toHaveText("Showing 60 of 120");
  // A tab is page 1 too.
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await main(page).locator('[data-tab="queue"]').click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("1–50 of 60");
  clean();
});

test("Loans grouped by area and branch: the whole result is grouped, then paged; headings keep the whole counts", async ({ page }) => {
  const clean = watchConsole(page);
  await seed120();
  await signInWith(page, "Continue as Admin");
  await page.goto("/loans?tab=all&by=area&page=2");
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("51–100 of 120");
  await expect(rows(page)).toHaveCount(50);
  if (width(page) >= 640) {
    // Every heading on page 2 shows its whole count; the one begun on page 1 says so.
    const heads = await main(page).locator("[data-loan-branch]").allInnerTexts();
    expect(heads.join(" | ")).toMatch(/\(continued\) · 60/);
    for (const h of heads) expect(h).toMatch(/ · 60$/);
  }
  // Page 1 and page 2 together: no loan twice, none missing so far.
  const two = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-loan-row")));
  await page.goto("/loans?tab=all&by=area");
  const one = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-loan-row")));
  expect(new Set([...one, ...two]).size).toBe(100);
  clean();
});

test("My loans (Loan Associate): 50 a page, the tab count is the total", async ({ page }) => {
  const clean = watchConsole(page);
  await seed120();
  await signInWith(page, "Continue as Loan Associate");
  await page.goto("/loans?tab=all");
  await expect(main(page).locator("[data-loan-list] li")).toHaveCount(50);
  await expect(main(page).locator('[data-tab="all"] [data-tab-count]')).toHaveText("120");
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("1–50 of 120");
  await pagerFits(page);
  await noSideways(page);
  await shot(page, "my-loans");
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(pager(page).locator("[data-pager-range]")).toHaveText("51–100 of 120");
  await page.reload();
  await expect(main(page).locator("[data-loan-list] li")).toHaveCount(50);
  clean();
});

test("Settings > Users: 100 a page; the count is the total; a filter goes back to page 1; no pager for one page", async ({ page }) => {
  const clean = watchConsole(page);
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  await db.user.createMany({ data: Array.from({ length: USERS }, (_, i) => ({ email: userEmail(i + 1), name: `Zz Pager ${String(i + 1).padStart(3, "0")}`, roleId: la.id, isTestUser: false, active: true })) });
  const total = await db.user.count();
  const active = await db.user.count({ where: { active: true } });
  await signInWith(page, "Continue as Admin");
  await page.goto("/admin/users");
  await expect(main(page).getByText(`${active} of ${total} users`, { exact: true })).toBeVisible();
  await expect(pager(page).locator("[data-pager-range]")).toHaveText(`1–100 of ${active}`);
  await pagerFits(page);
  await noSideways(page);
  await shot(page, "users");
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(pager(page).locator("[data-pager-range]")).toHaveText(`101–${active} of ${active}`);
  await page.reload();
  await expect(pager(page).locator("[data-pager-range]")).toHaveText(`101–${active} of ${active}`);
  // A search: page 1 again, and one page needs no pager.
  await page.getByLabel("Search").fill("Zz Pager 00");
  await page.getByLabel("Search").press("Enter");
  await expect(page).not.toHaveURL(/page=/);
  await expect(main(page).getByText(`9 of ${total} users`, { exact: true })).toBeVisible();
  await expect(pager(page)).toHaveCount(0);
  clean();
});
