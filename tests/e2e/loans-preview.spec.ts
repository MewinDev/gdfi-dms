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
const FINANCING = "GD1012026901002"; // Antipolo (mock myloans): Financing, New, so the two questions
const PNS = [RELEASED, CANCELLED, OTHER, FINANCING];

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
  await pool(FINANCING, "101", "Pool Financing", 4);
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
  await expect(rows).toHaveCount(3); // Alaminos is outside the LA's branches
  // D-060: the pool wording (from the arrival in the pool), as the Assigned to tooltip or the card's line.
  const since = rows.first().locator("[data-pool-since]");
  const SINCE = /^In the branch pool since [A-Z][a-z]{2} \d{1,2} · (\d+ working days?|less than a day)$/;
  if (width(page) >= 1024) await expect(since).toHaveAttribute("title", SINCE); // the table: Assigned to "Branch pool", the tooltip
  else await expect(since).toHaveText(SINCE); // the card: the line itself
  for (const pn of [RELEASED, CANCELLED, FINANCING]) {
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
  // Inbox › Branch pool: the badge, no Accept; the row opens its preview in the panel (D-063), with Refresh, no link to the page.
  await page.goto("/inbox?tab=pool");
  const item = main(page).locator(`[data-inbox-row="${CANCELLED}"]`);
  await expect(item.locator("[data-not-in-dms]")).toBeVisible();
  await expect(item.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(item.locator("[data-pool-since]")).toHaveText(/^In the branch pool since [A-Z][a-z]{2} \d{1,2} · (\d+ working days?|less than a day)$/);
  await item.click();
  await expect(page.getByRole("dialog").locator("[data-refresh-preview]")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: /full preview/i })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Accept" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  ok();
});

test("preview page: the myloans data, the waiting time, Refresh from myloans; another branch's is not found", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/loans/preview/${RELEASED}`);
  const card = main(page).locator("[data-find-preview]");
  await expect(card.getByRole("heading", { name: "Maria Santos" })).toBeVisible();
  await expect(card.locator("[data-find-pn]")).toHaveText(RELEASED);
  await expect(card.getByRole("button", { name: `Copy PN ${RELEASED}` })).toBeVisible();
  // D-060 (review): the subtitle has no badge; the card's top right has the "Loan Released" chip and the badge, once each.
  await expect(main(page).getByText("Released in myloans, not yet a loan file in the DMS", { exact: true })).toBeVisible();
  await expect(main(page).locator("[data-not-in-dms]")).toHaveCount(1);
  await expect(card.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText(["Loan Released", "myloans · Not yet in DMS"]);
  // In the pool since its arrival, never before its release (both 2 days ago here).
  await expect(main(page).locator("[data-preview-waiting]")).toHaveText(/^In the branch pool since [A-Z][a-z]{2} \d{1,2} · (\d+ working days?|less than a day)$/);
  // Never in the pool before its release: the "since" day is on or after the Released on day shown (here myloans says
  // a later release than the pool item's copy, as after a correction in myloans: the release day is the start).
  const releasedOn = await card.locator("dt", { hasText: /^Released on$/ }).locator("xpath=following-sibling::dd").textContent();
  const sinceDay = ((await main(page).locator("[data-preview-waiting]").textContent()) ?? "").match(/since ([A-Z][a-z]{2} \d{1,2})/)![1];
  const year = releasedOn!.slice(-4);
  expect(new Date(`${sinceDay}, ${year}`).getTime()).toBeGreaterThanOrEqual(new Date(releasedOn!).getTime());
  for (const k of ["CIN", "Branch", "Product", "Loan type", "Classification", "Amount released", "Released on"]) {
    await expect(card.locator("dt", { hasText: new RegExp(`^${k}$`) })).toHaveCount(1);
  }
  await expect(card.locator("dt", { hasText: /^Status in myloans$/ })).toHaveCount(0);
  // Refresh from myloans: a compact icon button (tooltip) in the card header, at the top right (beside the name on a wide screen).
  const refresh = card.getByRole("button", { name: "Refresh from myloans" });
  await expect(refresh).toHaveText(""); // the icon only
  // Its name in a popover on hover and on keyboard focus.
  const pop = card.locator("[data-refresh-popover]");
  await expect(pop).toBeHidden();
  await refresh.hover();
  await expect(pop).toBeVisible();
  await expect(pop).toHaveText("Refresh from myloans");
  await page.mouse.move(0, 0);
  await expect(pop).toBeHidden();
  await refresh.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(refresh).toBeFocused();
  await expect(pop).toBeVisible();
  expect(Math.round((await refresh.boundingBox())!.height)).toBe(28);
  const [rb, nb, cb] = [(await refresh.boundingBox())!, (await card.getByRole("heading", { name: "Maria Santos" }).boundingBox())!, (await card.boundingBox())!];
  expect(rb.y).toBeLessThan(nb.y + 60);
  if (width(page) >= 1024) expect(cb.x + cb.width - (rb.x + rb.width)).toBeLessThanOrEqual(32);
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
  await expect(main(page).locator(`[data-inbox-pane=pool] [data-inbox-row^="${RELEASED}"]`)).toHaveCount(0); // (now in My items)
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

test("the two questions: no warning until Open loan file is pressed; the hint right beside the disabled button", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/loans/preview/${FINANCING}`);
  const card = main(page).locator("[data-find-preview]");
  const open = card.getByRole("button", { name: "Open loan file" });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await expect(card.getByText("Please pick one to continue.")).toHaveCount(0);
  await expect(card.locator('[data-question] [role="alert"]')).toHaveCount(0);
  for (const q of await card.locator("[data-question] label").all()) expect(await q.evaluate((e) => e.className)).not.toContain("border-act-line");
  const hint = card.locator("[data-open-hint]");
  await expect(hint).toHaveText("Answer both questions to open the loan file");
  const [hb, ob] = [(await hint.boundingBox())!, (await open.boundingBox())!];
  if (width(page) >= 640) {
    expect(hb.x - (ob.x + ob.width)).toBeLessThanOrEqual(16); // beside the button, not at the far right
    expect(Math.abs(hb.y + hb.height / 2 - (ob.y + ob.height / 2))).toBeLessThanOrEqual(2);
  } else {
    expect(hb.y).toBeGreaterThanOrEqual(ob.y + ob.height - 1); // under it on a phone
  }
  // Pressing it without answers (it reads disabled, so Enter on it): now the message and the warning colour.
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText("Please pick one to continue.")).toHaveCount(2);
  await card.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await expect(hint).toHaveText("Answer the OR/CR question to open the loan file");
  await card.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await expect(hint).toHaveCount(0);
  await expect(open).toHaveAttribute("aria-disabled", "false");
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
