import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { watchConsole, signInWith, docShot } from "./helpers";

/**
 * MyLoans sync check through the real screens (scenarios 2, 4, 5 and 8): the review pop-up for an amount
 * change and for a branch change, the blocked Send message, the "Waiting for an approver to review" view, the
 * access change after Approve, closing a cancelled loan and Reject (each with remarks), on Open Items (piece 8).
 * Screenshots at 1440, 820 and 390: docs/screenshots/sync-check/.
 */
const DIR = "docs/screenshots/sync-check";
const PN = "GD1652026901003"; // Angono: Mortgage, 4 transactions
const ANTIPOLO_PN = "GD1012026901001"; // Antipolo, no questions
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin" } as const;

const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const setting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
async function change(pn: string, over: Record<string, unknown>) {
  const row = await db.setting.findUnique({ where: { key: "myloans.mockOverrides" } });
  const all = { ...((row?.value as Record<string, Record<string, unknown>>) ?? {}) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setting("myloans.mockOverrides", all);
}
async function openPn(page: Page, pn: string, questions = true) {
  await page.goto(`/loans?q=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  if (questions) {
    await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  }
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
async function refresh(page: Page, pn: string) {
  await page.goto(`/loans/${pn}?tab=todo`);
  await page.locator("[data-source-strip]").getByRole("button", { name: "Refresh from myloans" }).click();
  await expect(page.getByText("Changes found: an Open Item waits for an approver.")).toBeVisible();
}
/** The Open Items page for one PN, and the card of one field (or the rule group). */
async function openItemsCard(page: Page, pn: string, card: string) {
  await page.goto(`/open-items?pn=${pn}`);
  return page.locator(`[data-oi-card="${card}"][data-pn="${pn}"]`);
}

test.beforeEach(async () => {
  await resetLoans();
  await db.user.updateMany({ where: { email: "test.lahead@gdfi.ph" }, data: { active: true } });
  await setting("myloans.mockOverrides", {});
  await setting("myloans.paused", false);
});
test.afterAll(async () => {
  await resetLoans();
  await db.user.updateMany({ where: { email: "test.lahead@gdfi.ph" }, data: { active: true } });
  await setting("myloans.mockOverrides", {});
});

test("2. Amount change: Send held where it reaches; the LA sees the banner, not Open Items; the approver sees the rules' answer; Reject needs remarks", async ({ page }) => {
  const clean = watchConsole(page);
  await signInWith(page, BUTTONS.la);
  await openPn(page, PN);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await refresh(page, PN);
  // The blocked Send message (Mortgage would be removed).
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator('[id^="send-why-"]').filter({ visible: true }).first()).toHaveText("myloans changed this loan. An approver decides the Open Item first.");
  await noSideways(page);
  await shot(page, "send-blocked");
  // Notary is not reached: no hold message there.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator('[id^="send-why-"]').filter({ hasText: "myloans changed" })).toHaveCount(0);
  // The LA: the banner on the loan file; the Open Items page is for approvers only.
  await page.goto(`/loans/${PN}`);
  await expect(page.locator("[data-open-items-banner]")).toContainText("1 Open Item from myloans: Amount.");
  const res = await page.goto(`/open-items?pn=${PN}`);
  expect(res?.status()).toBe(404);
  // The approver: old and new amount, what the rules would do; the loan file still shows the old amount.
  await signInWith(page, BUTTONS.admin);
  const card = await openItemsCard(page, PN, "rules");
  await expect(card.locator('[data-oi-item="amount"]')).toContainText("₱1,020,000.00");
  await expect(card.locator("[data-oi-effect]")).toContainText("Mortgage is not needed: this is a Renewal loan above ₱1,000,000.");
  await noSideways(page);
  await shot(page, "open-item-amount");
  expect(Number((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).totalReleasedAmount)).toBe(1_000_000);
  await card.getByLabel("Remarks (required)").fill("abc");
  await card.getByRole("button", { name: /^Reject/ }).click();
  await expect(card.getByText("Write remarks (at least 5 characters).")).toBeVisible();
  await card.getByLabel("Remarks (required)").fill("Branch confirmed the first amount");
  await card.getByRole("button", { name: /^Reject/ }).click();
  await expect.poll(async () => (await db.openItem.findFirstOrThrow({ where: { loan: { pn: PN } } })).status).toBe("REJECTED");
  clean();
});

test("4. Branch change: access follows the old branch until an approver approves, then the new one", async ({ page }) => {
  const clean = watchConsole(page);
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" }, include: { branches: true } });
  const [antipolo, angono] = await Promise.all(["101", "165"].map((code) => db.branch.findUniqueOrThrow({ where: { code } })));
  const only = async (branchId: string) => {
    await db.userBranch.deleteMany({ where: { userId: la.id } });
    await db.userBranch.create({ data: { userId: la.id, branchId } });
  };
  try {
    await signInWith(page, BUTTONS.la);
    await openPn(page, ANTIPOLO_PN, false);
    await change(ANTIPOLO_PN, { branchCode: "165", branchName: "Angono" });
    await refresh(page, ANTIPOLO_PN);
    // An Antipolo-only person still sees it while Admin has not decided; an Angono-only person does not yet.
    await only(antipolo.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.locator("[data-loan-header]")).toBeVisible();
    await only(angono.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.locator("[data-loan-header]")).toHaveCount(0);
    // The approver: the Branch Open Item (old and new), then Approve with remarks.
    await signInWith(page, BUTTONS.admin);
    const card = await openItemsCard(page, ANTIPOLO_PN, "branchCode");
    await expect(card.locator('[data-oi-item="branchCode"]')).toContainText("Antipolo (101)");
    await expect(card.locator('[data-oi-item="branchCode"]')).toContainText("Angono (165)");
    await noSideways(page);
    await shot(page, "open-item-branch");
    await card.getByLabel("Remarks (required)").fill("MyLoans moved the account to Angono");
    await card.getByRole("button", { name: /^Approve/ }).click();
    await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: ANTIPOLO_PN } })).branchId).toBe(angono.id);
    // Approved: the Angono-only person sees it, the Antipolo-only person no longer does.
    await signInWith(page, BUTTONS.la);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.locator("[data-loan-header]")).toBeVisible();
    await only(antipolo.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.locator("[data-loan-header]")).toHaveCount(0);
  } finally {
    await db.userBranch.deleteMany({ where: { userId: la.id } });
    for (const b of la.branches) await db.userBranch.create({ data: { userId: la.id, branchId: b.branchId } });
  }
  clean();
});

test("5 and 8. Cancelled in MyLoans: Send blocked for the whole loan with the reason; the approver closes it with remarks", async ({ page }) => {
  const clean = watchConsole(page);
  await signInWith(page, BUTTONS.la);
  await openPn(page, PN);
  await change(PN, { status: "CANCELLED" });
  await refresh(page, PN);
  const why = "myloans says this loan is no longer released (cancelled in myloans). Send, Forward and new cash wait until an approver decides the Open Item.";
  for (const tx of ["NOTARY", "MORTGAGE"]) {
    await page.goto(`/loans/${PN}?tab=todo&tx=${tx}`);
    await expect(page.locator('[id^="send-why-"]').filter({ visible: true }).first()).toHaveText(why);
  }
  await expect(page.locator("[data-loan-ended]")).toHaveText(why);
  await noSideways(page);
  await signInWith(page, BUTTONS.admin);
  const card = await openItemsCard(page, PN, "status");
  await card.getByLabel("Remarks (required)").fill("MyLoans cancelled the loan");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("Cancelled in MyLoans");
  await page.goto(`/loans/${PN}`);
  await expect(page.getByText(/Closed: Cancelled in MyLoans/)).toBeVisible();
  await noSideways(page);
  clean();
});

test("3. Borrower details: chip and banner for the LA; nothing blocked; with no approver of the branch's own, Admin (All branches) approves with remarks", async ({ page }) => {
  const clean = watchConsole(page);
  // No supervisor in the branch: the seeded LA Supervisor/Head (Angono) is parked for this test.
  await db.user.updateMany({ where: { email: "test.lahead@gdfi.ph" }, data: { active: false } });
  await signInWith(page, BUTTONS.la);
  await openPn(page, PN);
  // D-051: no address or contact number; name and CIF are borrower fields.
  await change(PN, { borrowerName: "Ana Villanueva-Reyes", cif: "CIF-NEW-1003" });
  await refresh(page, PN);
  await page.reload();
  await expect(page.locator("[data-borrower-chip]")).toContainText("myloans changed borrower details: an Open Item waits");
  await expect(page.locator("[data-open-items-banner]")).toContainText("2 Open Items from myloans: Borrower name, CIF.");
  await noSideways(page);
  await shot(page, "borrower-banner");
  // Nothing blocked: Send still offered on Notary.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator('[id^="send-why-"]').filter({ hasText: "myloans" })).toHaveCount(0);
  await signInWith(page, BUTTONS.admin);
  const card = await openItemsCard(page, PN, "borrowerName");
  await expect(card.locator('[data-oi-item="borrowerName"]')).toContainText("Ana Villanueva-Reyes");
  await card.getByLabel("Remarks (required)").fill("Checked the valid ID");
  await noSideways(page);
  await shot(page, "borrower-open-item");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).borrowerName).toBe("Ana Villanueva-Reyes");
  clean();
});
