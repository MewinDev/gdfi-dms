import { expect, test, type Page } from "@playwright/test";
import { signInWith } from "./helpers";
import { db, resetLoans } from "./db";

/**
 * Piece 12 (D-055): the end-to-end paths the earlier specs did not walk.
 * - Branch pool → loan file: a released loan waiting in the LA pool is accepted and opened; its pool item is done.
 * - Open Items, per status outcome: Reject keeps the DMS value; NotReleased holds the loan until myloans shows it
 *   released again; a redo (Superseded) moves the same loan file to the new PN. (Cancelled → closed is in
 *   myloans-sync.spec.ts; the rules behind each outcome are in tests/integration/open-items.test.ts.)
 */
const LA = "Continue as Loan Associate";
const ADMIN = "Continue as Admin";
const PN = "GD1652026901003";

const setting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
async function change(pn: string, over: Record<string, unknown>) {
  const row = await db.setting.findUnique({ where: { key: "myloans.mockOverrides" } });
  const all = { ...((row?.value as Record<string, Record<string, unknown>>) ?? {}) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setting("myloans.mockOverrides", all);
}
async function findAndOpen(page: Page, pn: string) {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
async function openPn(page: Page, pn = PN) {
  await page.goto(`/loans?fill=${pn}`);
  await findAndOpen(page, pn);
}
async function refresh(page: Page, pn = PN) {
  await page.goto(`/loans/${pn}?tab=todo`);
  await page.locator("[data-source-strip]").getByRole("button", { name: "Refresh from MyLoans" }).click();
  await page.waitForLoadState("networkidle");
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetLoans();
  await setting("myloans.refreshOnOpenMinutes", 15);
});
test.afterAll(async () => {
  await resetLoans();
  await setting("simulator.enabled", false);
});

test("Branch pool → loan file: the LA accepts a released loan from the pool, opens it, and the pool item is done", async ({ page }) => {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await db.sourceLoanCandidate.create({ data: { externalLoanId: 990_003, cin: "CIN-FAKE-990003", pn: PN, borrowerName: "Pool Borrower", branchCode: "165", branchName: "Angono", amount: "1000000.00", releaseDate: new Date(Date.now() - 3 * 86_400_000) } });
  await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: PN, role: "LA", branchId: branch.id, pn: PN, label: `${PN}: Pool Borrower`, state: "POOL", measure: "WAITING" } });
  await signInWith(page, LA);
  await page.goto("/inbox?tab=pool");
  const row = page.locator(`[data-inbox-row="${PN}: Pool Borrower"]`);
  await expect(row).toBeVisible();
  await row.locator("[data-accept]").click();
  await expect.poll(async () => (await db.workItem.findFirstOrThrow({ where: { kind: "LOAN_CANDIDATE", subjectId: PN } })).state).toBe("HELD");
  await page.goto("/inbox");
  await page.locator(`[data-inbox-row="${PN}: Pool Borrower"]`).getByRole("link", { name: `${PN}: Pool Borrower` }).click();
  await expect(page).toHaveURL(new RegExp(`/loans\\?fill=${PN}`));
  await findAndOpen(page, PN);
  await expect.poll(async () => (await db.workItem.findFirstOrThrow({ where: { kind: "LOAN_CANDIDATE", subjectId: PN } })).state).toBe("DONE");
  await noSideways(page);
});

test("Reject an Open Item: the loan keeps the DMS value; the item says Rejected", async ({ page }) => {
  await signInWith(page, LA);
  await openPn(page);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await refresh(page);
  await signInWith(page, ADMIN);
  await page.goto(`/open-items?pn=${PN}`);
  const card = page.locator(`[data-oi-card="rules"][data-pn="${PN}"]`);
  await card.getByLabel("Remarks (required)").fill("MyLoans entry is wrong; asked them to fix it");
  await card.getByRole("button", { name: /^Reject/ }).first().click();
  await expect.poll(async () => (await db.openItem.findFirstOrThrow({ where: { loan: { pn: PN } } })).status).toBe("REJECTED");
  expect(Number((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).totalReleasedAmount)).toBe(1_000_000);
  await page.goto(`/loans/${PN}?tab=todo`);
  await expect(page.locator("[data-open-items-banner]")).toHaveCount(0);
});

test("Not released in myloans: Approve holds the loan (Send, Forward and cash wait); released again, the hold ends by itself", async ({ page }) => {
  await signInWith(page, LA);
  await openPn(page);
  await change(PN, { status: "NOT_RELEASED" });
  await refresh(page);
  await signInWith(page, ADMIN);
  await page.goto(`/open-items?pn=${PN}`);
  const card = page.locator(`[data-oi-card="status"][data-pn="${PN}"]`);
  await expect(card).toContainText("The loan stays on hold until released again.");
  await noSideways(page);
  await card.getByLabel("Remarks (required)").fill("Release reversed in myloans");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).sourceHold).toBe("NotReleased");
  await page.goto(`/loans/${PN}?tab=todo`);
  await expect(page.getByText(/On hold: not released/i).first()).toBeVisible();
  // Released again in myloans: the next refresh ends the hold, with no new Open Item to decide.
  await change(PN, { status: "RELEASED" });
  await refresh(page);
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).sourceHold).toBeNull();
  expect(await db.openItem.count({ where: { loan: { pn: PN }, status: "PENDING" } })).toBe(0);
});

test("Redone in myloans (Superseded): Approve moves the same loan file to the new PN", async ({ page }) => {
  await setting("simulator.enabled", true);
  await signInWith(page, LA);
  await openPn(page);
  const loanId = (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).id;
  await signInWith(page, ADMIN);
  await page.goto(`/loans/${PN}?tab=journey`);
  const sim = page.locator("[data-simulate-source]");
  await sim.getByLabel("Simulate a MyLoans change").selectOption("replace");
  await sim.getByRole("button", { name: "Simulate" }).click();
  await expect(sim.getByText(/Simulated: MyLoans now has GD\d{13} replacing/)).toBeVisible();
  const newPn = ((await db.setting.findUniqueOrThrow({ where: { key: "myloans.mockExtra" } })).value as { pn: string }[])[0].pn;
  await page.goto(`/open-items?pn=${PN}`);
  const card = page.locator(`[data-oi-card="status"][data-pn="${PN}"]`);
  await expect(card).toContainText(`This will move the loan file to PN ${newPn}.`);
  await card.getByLabel("Remarks (required)").fill("Redone as a new PN in myloans");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { id: loanId } })).pn).toBe(newPn);
  await page.goto(`/loans/${newPn}`);
  await expect(page.getByText(newPn).filter({ visible: true }).first()).toBeVisible();
  expect(await db.loan.findUnique({ where: { pn: PN } })).toBeNull();
});
