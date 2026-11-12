import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { watchConsole } from "./helpers";

/**
 * MyLoans sync check through the real screens (scenarios 2, 4, 5 and 8): the review pop-up for an amount
 * change and for a branch change, the blocked Send message, the "Waiting for Admin to review" view, the
 * access change after Apply, Close as cancelled and Keep current (each with a note).
 * Screenshots at 1440, 820 and 390: docs/screenshots/sync-check/.
 */
const DIR = "docs/screenshots/sync-check";
const PN = "GD1652026901003"; // Angono: Mortgage, 4 transactions
const ANTIPOLO_PN = "GD1012026901001"; // Antipolo, no questions
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin" } as const;

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
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
  await page.goto(`/loans?fill=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  if (questions) {
    await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  }
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
async function refresh(page: Page, pn: string) {
  await page.goto(`/loans/${pn}?tab=todo`);
  await page.locator("[data-source-strip]").getByRole("button", { name: "Refresh from MyLoans" }).click();
  await expect(page.getByText("Changes found: review.")).toBeVisible();
}
const reviewSheet = (page: Page) => page.getByRole("dialog", { name: /^MyLoans changed this loan/ });

test.beforeEach(async () => {
  await resetLoans();
  await setting("myloans.mockOverrides", {});
  await setting("myloans.paused", false);
});
test.afterAll(async () => {
  await resetLoans();
  await setting("myloans.mockOverrides", {});
});

test("2. Amount change: Send held where it reaches, LA read-only (no amounts), Admin's pop-up shows the rules' answer; Keep current needs a note", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "la");
  await openPn(page, PN);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await refresh(page, PN);
  // The blocked Send message (Mortgage would be removed).
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator('[id^="send-why-"]').filter({ visible: true }).first()).toHaveText("MyLoans changed this loan. Admin is reviewing.");
  await noSideways(page);
  await shot(page, "send-blocked");
  // Notary is not reached: no hold message there.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator('[id^="send-why-"]').filter({ hasText: "MyLoans changed" })).toHaveCount(0);
  // The LA: the same pop-up, read-only, amounts hidden.
  await page.goto(`/loans/${PN}?tab=todo&review=1`);
  const ro = reviewSheet(page);
  await expect(ro.locator("[data-amount-hidden]")).toHaveText("Amount changed");
  await expect(ro.locator("[data-source-waiting]")).toHaveText("Waiting for Admin to review.");
  await expect(ro.getByRole("button", { name: "Apply changes" })).toHaveCount(0);
  await noSideways(page);
  await shot(page, "waiting-for-admin");
  // Admin: old and new amount, what the rules would do; the loan file still shows the old amount.
  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo&review=1`);
  const review = reviewSheet(page);
  await expect(review.getByRole("row", { name: /Amount/ })).toContainText("₱1,000,000");
  await expect(review.getByRole("row", { name: /Amount/ })).toContainText("₱1,020,000");
  await expect(review.locator("[data-source-means]")).toContainText("Mortgage is not needed: this is a Renewal loan above ₱1,000,000.");
  await noSideways(page);
  await shot(page, "review-amount");
  expect(Number((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).totalReleasedAmount)).toBe(1_000_000);
  await review.getByRole("button", { name: "Keep current" }).click();
  await expect(review.locator("[data-source-error]")).toContainText("short note");
  await review.getByLabel("Note (required)").fill("Branch confirmed the first amount");
  await review.getByRole("button", { name: "Keep current" }).click();
  await expect.poll(async () => (await db.sourceChange.findFirstOrThrow({ where: { loan: { pn: PN } } })).state).toBe("KEPT");
  clean();
});

test("4. Branch change: access follows the old branch until Admin applies, then the new one", async ({ page }) => {
  const clean = watchConsole(page);
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" }, include: { branches: true } });
  const [antipolo, angono] = await Promise.all(["101", "165"].map((code) => db.branch.findUniqueOrThrow({ where: { code } })));
  const only = async (branchId: string) => {
    await db.userBranch.deleteMany({ where: { userId: la.id } });
    await db.userBranch.create({ data: { userId: la.id, branchId } });
  };
  try {
    await signInAs(page, "la");
    await openPn(page, ANTIPOLO_PN, false);
    await change(ANTIPOLO_PN, { branchCode: "165", branchName: "Angono" });
    await refresh(page, ANTIPOLO_PN);
    // An Antipolo-only person still sees it while Admin has not decided; an Angono-only person does not yet.
    await only(antipolo.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.getByRole("heading", { name: "Loan File" })).toBeVisible();
    await only(angono.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.getByRole("heading", { name: "Loan File" })).toHaveCount(0);
    // Admin: the branch pop-up (old and new, who gains and loses access), then Apply with a note.
    await signInAs(page, "admin");
    await page.goto(`/loans/${ANTIPOLO_PN}?tab=todo&review=1`);
    const review = reviewSheet(page);
    await expect(review.locator("[data-branch-move]")).toContainText("Branch: Antipolo → Angono");
    await noSideways(page);
    await shot(page, "review-branch");
    await review.getByLabel("Note (required)").fill("MyLoans moved the account to Angono");
    await review.getByRole("button", { name: "Apply changes" }).click();
    await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: ANTIPOLO_PN } })).branchId).toBe(angono.id);
    // After Apply: the Angono-only person sees it, the Antipolo-only person no longer does.
    await signInAs(page, "la");
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.getByRole("heading", { name: "Loan File" })).toBeVisible();
    await only(antipolo.id);
    await page.goto(`/loans/${ANTIPOLO_PN}`);
    await expect(page.getByRole("heading", { name: "Loan File" })).toHaveCount(0);
  } finally {
    await db.userBranch.deleteMany({ where: { userId: la.id } });
    for (const b of la.branches) await db.userBranch.create({ data: { userId: la.id, branchId: b.branchId } });
  }
  clean();
});

test("5 and 8. Cancelled in MyLoans: Send blocked for the whole loan; Admin closes it as cancelled with a note", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "la");
  await openPn(page, PN);
  await change(PN, { status: "CANCELLED" });
  await refresh(page, PN);
  for (const tx of ["NOTARY", "MORTGAGE"]) {
    await page.goto(`/loans/${PN}?tab=todo&tx=${tx}`);
    await expect(page.locator('[id^="send-why-"]').filter({ visible: true }).first()).toHaveText("MyLoans says this loan is cancelled. Admin is reviewing.");
  }
  await noSideways(page);
  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo&review=1`);
  const review = reviewSheet(page);
  await review.getByRole("button", { name: "Close as cancelled" }).click();
  await expect(review.locator("[data-source-error]")).toContainText("short note");
  await review.getByLabel("Note (required)").fill("MyLoans cancelled the loan");
  await review.getByRole("button", { name: "Close as cancelled" }).click();
  await expect(page.getByText(/Closed: Cancelled in MyLoans/)).toBeVisible();
  expect((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("Cancelled in MyLoans");
  await noSideways(page);
  clean();
});

test("3. Borrower details: chip, old and new side by side, read-only for the LA; Admin (no supervisor in the branch) accepts with a note", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "la");
  await openPn(page, PN);
  await change(PN, { borrowerName: "Ana Villanueva-Reyes", address: "12 Rizal Ave, Angono", contactNo: "09171234567" });
  await refresh(page, PN);
  await page.reload();
  await expect(page.locator("[data-borrower-chip]")).toContainText("MyLoans changed borrower details, waiting for review");
  const entry = page.locator("[data-borrower-entry]");
  await expect(entry).toContainText("Changed: Name, Address, Contact number.");
  await entry.getByRole("button", { name: "See the change" }).click();
  const sheet = page.getByRole("dialog", { name: /^MyLoans corrected the borrower's details/ });
  await expect(sheet.locator("[data-borrower-waiting]")).toHaveText("No supervisor or approver in this branch. Admin reviews it.");
  await expect(sheet.getByRole("button", { name: "Accept the correction" })).toHaveCount(0);
  await expect(sheet.locator('[data-diff="now"]').filter({ visible: true }).first()).toBeVisible();
  await noSideways(page);
  await shot(page, "borrower-readonly");
  // Nothing blocked: Send still offered on Notary.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator('[id^="send-why-"]').filter({ hasText: "MyLoans" })).toHaveCount(0);
  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo&correction=1`);
  const review = page.getByRole("dialog", { name: /^MyLoans corrected the borrower's details/ });
  await review.getByRole("button", { name: "Accept the correction" }).click();
  await expect(review.locator("[data-borrower-error]")).toContainText("at least 5");
  await review.getByLabel("Note (required)").fill("Checked the valid ID");
  await noSideways(page);
  await shot(page, "borrower-review");
  await review.getByRole("button", { name: "Accept the correction" }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).borrowerName).toBe("Ana Villanueva-Reyes");
  clean();
});
