import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signIn, signInWith, watchConsole } from "./helpers";

/**
 * D-060: released loans not yet in the DMS have no Accept anywhere (Loans, Inbox › Branch pool): one action, View
 * details, opens their preview (/loans/preview/<PN>), which shows what myloans says now, the "myloans · Not yet in DMS"
 * badge and how long it waited, with Open loan file and Refresh from myloans. Opening gives the loan file to that person
 * with their TAT started and takes the item out of the pool; two at once make one loan file and the second is told who
 * opened it. No longer released in myloans: the reason card, no Open. Another branch's: not found.
 * Screenshots: docs/screenshots/ui-refresh/loan-preview-<width>.png.
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const width = (page: Page) => page.viewportSize()!.width;
const main = (page: Page) => page.getByRole("main");
const RELEASED = "GD1012026901001"; // Maria Santos, Antipolo (mock myloans): Refinancing, no questions
const CANCELLED = "GD1012026901013"; // Andres Lim: cancelled in myloans
const OTHER = "GD3902026909911"; // an Alaminos pool item (outside the LA's branches)
const PNS = [RELEASED, CANCELLED, OTHER];

async function pool(pn: string, code: string, name: string, n: number) {
  const branch = await db.branch.findUniqueOrThrow({ where: { code } });
  await db.sourceLoanCandidate.create({ data: { externalLoanId: 990_100 + n, pn, cin: `CIN-${n}`, borrowerName: name, branchCode: code, branchName: branch.name, productName: "Auto Refinancing", amount: "350000", releaseDate: new Date(Date.now() - 2 * 86_400_000) } });
  await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: branch.id, pn, label: `${pn}: ${name}`, state: "POOL", measure: "WAITING", arrivedAt: new Date(Date.now() - 2 * 86_400_000) } });
}
async function clean() {
  await db.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE", subjectId: { in: PNS } } });
  await db.sourceLoanCandidate.deleteMany({ where: { pn: { in: PNS } } });
  await db.pnSearchLog.deleteMany({});
}
test.beforeEach(async () => {
  await resetLoans();
  await clean();
  await pool(RELEASED, "101", "Maria Santos", 1);
  await pool(CANCELLED, "101", "Andres Lim", 2);
  await pool(OTHER, "390", "Other Branch", 3);
});
test.afterAll(async () => {
  await clean();
  await resetLoans();
});

test("no Accept for pool loans anywhere: one View details; the badge only on not-yet-in-DMS rows", async ({ page }) => {
  const ok = watchConsole(page);
  await signIn(page, "la");
  // Loans: the pool rows show with the filter; each has View details to its preview and the badge.
  await page.goto("/loans?status=new");
  const rows = main(page).locator("[data-loan-row]:visible");
  await expect(rows).toHaveCount(2); // Alaminos is outside the LA's branches
  for (const pn of [RELEASED, CANCELLED]) {
    const row = rows.filter({ has: page.locator("[data-pn]", { hasText: pn }) });
    await expect(row.getByRole("link", { name: /^View details of/ })).toHaveAttribute("href", `/loans/preview/${pn}`);
    await expect(row.locator("[data-not-in-dms]")).toHaveText("myloans · Not yet in DMS");
  }
  await expect(main(page).getByRole("button", { name: /Accept/ })).toHaveCount(0);
  // A loan file has no badge.
  await page.goto(`/loans/preview/${RELEASED}`);
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${RELEASED}`));
  await page.goto(`/loans?q=${RELEASED}`);
  await expect(main(page).locator("[data-loan-row]:visible")).toHaveCount(1);
  await expect(main(page).locator("[data-not-in-dms]")).toHaveCount(0);
  // Inbox › Branch pool: View details, the badge, no Accept.
  await page.goto("/inbox?tab=pool");
  const item = main(page).locator(`[data-inbox-row^="${CANCELLED}"]`);
  await expect(item.getByRole("link", { name: "View details" })).toHaveAttribute("href", `/loans/preview/${CANCELLED}`);
  await expect(item.locator("[data-not-in-dms]")).toBeVisible();
  await expect(item.getByRole("button", { name: "Accept" })).toHaveCount(0);
  ok();
});

test("preview page: the myloans data, the waiting time, Refresh from myloans; another branch's is not found", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/loans/preview/${RELEASED}`);
  const card = main(page).locator("[data-find-preview]");
  await expect(card.getByRole("heading", { name: "Maria Santos" })).toBeVisible();
  await expect(card.locator("[data-find-pn]")).toHaveText(RELEASED);
  await expect(card.getByRole("button", { name: `Copy PN ${RELEASED}` })).toBeVisible();
  await expect(card.locator("[data-not-in-dms]")).toBeVisible();
  await expect(main(page).locator("[data-preview-waiting]")).toContainText(/Waiting 2 working days in the branch pool|Waiting \d working day/);
  for (const k of ["CIN", "Branch", "Product", "Loan type", "Classification", "Amount released", "Released on", "Status in myloans"]) {
    await expect(card.locator("dt", { hasText: new RegExp(`^${k}$`) })).toHaveCount(1);
  }
  await expect(card.locator("dt", { hasText: /^Classification$/ }).locator("xpath=following-sibling::dd")).toHaveText(/^(Financing|Refinancing)/);
  await expect(card.getByRole("button", { name: "Open loan file" })).toBeEnabled();
  await expect.poll(() => db.pnSearchLog.count({ where: { pn: RELEASED } })).toBe(1);
  await card.getByRole("button", { name: "Refresh from myloans" }).click();
  await expect(main(page).locator("[data-preview-refreshed]")).toBeVisible();
  await expect.poll(() => db.pnSearchLog.count({ where: { pn: RELEASED } })).toBe(2);
  await docShot(page, { path: `${DIR}/loan-preview-${width(page)}.png`, fullPage: true });
  // Outside the person's branches: not found.
  const res = await page.goto(`/loans/preview/${OTHER}`);
  expect(res?.status()).toBe(404);
});

test("Open loan file: the loan file is the opener's, their TAT starts, the item leaves the pool", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/loans/preview/${RELEASED}`);
  const at = Date.now();
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${RELEASED}`));
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: RELEASED } });
  expect(loan.openedById).toBe(la.id);
  // Its work: in the opener's items, accepted at once (arrive and accept at the same moment): the TAT runs.
  const items = await db.workItem.findMany({ where: { loanId: loan.id, kind: "TRANSACTION" } });
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.holderUserId).toBe(la.id);
    expect(it.state).toBe("HELD");
    expect(it.acceptedAt!.getTime()).toBe(it.arrivedAt.getTime());
    expect(it.acceptedAt!.getTime()).toBeGreaterThan(at - 60_000);
  }
  // Out of the pool: the item is done; the pool and the Not yet in DMS list no longer have it.
  expect((await db.workItem.findFirstOrThrow({ where: { kind: "LOAN_CANDIDATE", subjectId: RELEASED } })).state).toBe("DONE");
  await page.goto("/inbox?tab=pool");
  await expect(main(page).locator(`[data-inbox-row^="${RELEASED}"]`)).toHaveCount(0);
  await page.goto("/loans?status=new");
  await expect(main(page).locator("[data-pn]", { hasText: RELEASED })).toHaveCount(0);
  // View details of a loan in the DMS opens its loan file (the preview address too).
  await page.goto(`/loans/preview/${RELEASED}`);
  await expect(page).toHaveURL(new RegExp(`/loans/${RELEASED}$`));
});

test("two people open at once: one loan file; the second is told who opened it and when", async ({ page, browser }) => {
  await signIn(page, "la");
  const other = await browser.newContext({ viewport: page.viewportSize()! });
  const page2 = await other.newPage();
  await signInWith(page2, { other: "Test LA Supervisor (LA Supervisor/Head)" });
  await page.goto(`/loans/preview/${RELEASED}`);
  await page2.goto(`/loans/preview/${RELEASED}`);
  await expect(page2.getByRole("main").getByRole("button", { name: "Open loan file" })).toBeVisible();
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${RELEASED}`));
  await page2.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page2).toHaveURL(new RegExp(`/loans/preview/${RELEASED}\\?taken=1`));
  const taken = page2.getByRole("main").locator("[data-preview-taken]");
  await expect(taken).toContainText("Already opened by Test Loan Associate at");
  await expect(taken.getByRole("link", { name: "View it" })).toHaveAttribute("href", `/loans/${RELEASED}`);
  expect(await db.loan.count({ where: { pn: RELEASED } })).toBe(1);
  await other.close();
});

test("no longer released in myloans: the reason card, no Open loan file", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/loans/preview/${CANCELLED}`);
  await expect(main(page).locator('[data-feed-state="Cancelled"]')).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Open loan file" })).toHaveCount(0);
  await expect(main(page).locator("[data-preview-waiting]")).toBeVisible();
});

test("a full PN found only in myloans: the same preview in the Loans search, with the badge and Open loan file", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans?q=GD1652026901003");
  const card = main(page).locator("[data-find-preview]");
  await expect(main(page).locator("[data-myloans-heading]")).toHaveText("Found in myloans");
  await expect(card.locator("[data-not-in-dms]")).toBeVisible();
  await expect(card.locator("dt", { hasText: /^CIN$/ })).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Open loan file" })).toBeVisible();
});
