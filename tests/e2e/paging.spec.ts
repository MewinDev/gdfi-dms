import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signInWith, watchConsole, docShot } from "./helpers";

/**
 * Paging on long lists: Settings > Users (100 a page). The Loans page has its own pager (D-059, loans-d059.spec.ts). The page is in the
 * address; counts stay the total; a filter or the search goes back to page 1. Screenshots at every width:
 * docs/screenshots/paging/.
 */
const DIR = "docs/screenshots/paging";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const pager = (page: Page) => main(page).locator("[data-pager]");
const USERS = 105;
const userEmail = (i: number) => `zz.pager.${String(i).padStart(3, "0")}@gdfi.ph`;

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
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
