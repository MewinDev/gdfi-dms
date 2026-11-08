import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanSettingsTestRows, db, resetLoans } from "./db";

/**
 * Transfer hold, the inactive sending LA, papers and cash on a Return to LA, and Finance on a held
 * transaction. Screenshots: docs/screenshots/hold-and-return/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/hold-and-return";
mkdirSync(DIR, { recursive: true });
const PN = "PN-0001003";

test.beforeEach(async () => {
  await resetLoans();
  await cleanSettingsTestRows();
  await db.holdReason.updateMany({ where: { code: { in: ["BORROWER", "OTHER-TEAM", "LTO-SCHEDULE"] } }, data: { active: false } });
});
test.afterAll(async () => {
  await cleanSettingsTestRows();
});

const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(300); // let colour transitions finish
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function openPn3(page: Page) {
  await page.goto(`/loans?fill=${PN}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  const open = main.getByRole("button", { name: "Open loan file" });
  await expect(async () => {
    await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
    await expect(open).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } } });
const jobOf = async (code: string) => db.dpAssignment.findFirstOrThrow({ where: { transactionId: (await txnOf(code)).id }, orderBy: { createdAt: "desc" } });
const userOf = (email: string) => db.user.findUniqueOrThrow({ where: { email } });

async function tickAll(page: Page, code: string) {
  await page.goto(`/loans/${PN}?tab=todo&tx=${code}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf(code)).status).toBe("READY");
}
async function send(page: Page, code: string) {
  await page.goto(`/loans/${PN}?tab=todo&tx=${code}`);
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  const lto = page.getByLabel("LTO office", { exact: true }).filter({ visible: true });
  if ((await lto.count()) && !(await lto.first().inputValue())) await lto.first().selectOption({ index: 1 });
  const beyond = page.getByLabel(/Why is this late/);
  if (await beyond.count()) await beyond.fill("Test run");
  await page.getByRole("radio", { name: "No funds needed", exact: true }).check({ force: true });
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await txnOf(code)).status).toBe("ASSIGNED");
  // The "sent" toast waits in session storage for the next page; clear it so later screenshots are clean.
  await page.evaluate(() => sessionStorage.clear());
}
async function accept(page: Page, jobId: string) {
  await page.goto(`/jobs/${jobId}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator("[data-stages]")).toBeVisible();
}
/** A released cash advance for the job (as Finance would leave it), held by the test DP. */
async function releasedAdvance(transactionId: string, cents = 150000) {
  const dp = await userOf("test.dp@gdfi.ph");
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: PN } });
  const n = await db.cashAdvance.count();
  return db.cashAdvance.create({
    data: {
      number: `CA-E2E-${String(n + 1).padStart(4, "0")}`, requestedById: dp.id, branchId: loan.branchId, status: "RELEASED",
      requestedCents: cents, approvedCents: cents, releasedCents: cents, releasedAt: new Date(), liquidationDueAt: new Date(Date.now() + 5 * 86_400_000), releaseRef: "V-E2E",
      lines: { create: [{ transactionId, kind: "LTO_FEE", requestedCents: cents, approvedCents: cents, releasedCents: cents }] },
    },
  });
}

test("Transfer hold: the form for Finance (supervisor role), the summary for a plain user; the new owner resumes", async ({ page }) => {
  test.setTimeout(240_000);
  // A second LA of the loan's branch to receive the hold.
  const role = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  const loanBranch = await db.branch.findFirstOrThrow({ where: { name: "Cebu" } });
  await db.user.create({ data: { email: "zz.la2@gdfi.ph", name: "Second Loan Associate", roleId: role.id, isTestUser: true, branches: { create: [{ branchId: loanBranch.id }] } } });

  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "MORTGAGE");
  await page.getByRole("button", { name: "Put on hold" }).click();
  const form = page.getByRole("dialog", { name: "Put on hold" });
  await form.getByLabel(/^Reason category/).selectOption({ label: "Waiting for the client's papers" });
  await form.getByLabel(/^Remarks \(required\)/).fill("The client signs the chattel mortgage on Monday");
  await form.getByRole("button", { name: "Put on hold" }).click();
  await expect(form).toBeHidden();

  // A plain user (the DP can view the loan file): no transfer, and who must resume it.
  await signInAs(page, "dp");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  const summary = page.locator("[data-hold-summary]");
  await expect(summary.locator("[data-needs-resume]")).toHaveText("Needs to be resumed by Test Loan Associate. Ask your supervisor if Test Loan Associate is away.");
  await expect(summary.locator("[data-transfer-hold]")).toHaveCount(0);
  await expect(summary.locator("[data-resume-disabled]")).toBeDisabled();
  await shot(page, "hold-summary-plain-user");

  // Finance (the role that approves cash advances, holds:transfer): Transfer hold, never Resume.
  await signInAs(page, "fin");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(summary.locator("[data-only-holder]")).toHaveText("Only Test Loan Associate can resume this.");
  await expect(summary.locator("[data-resume]")).toHaveCount(0);
  await shot(page, "hold-summary-supervisor");
  await summary.locator("[data-transfer-hold]").click();
  const t = page.getByRole("dialog", { name: "Transfer hold" });
  await expect(t.locator("[data-transfer-current]")).toContainText("On hold: Waiting for the client's papers");
  await expect(t.locator("[data-transfer-current]")).toContainText("The client signs the chattel mortgage on Monday");
  await expect(t.locator("[data-current-owner]")).toHaveText("Test Loan Associate");
  const go = t.getByRole("button", { name: "Transfer hold" });
  await t.getByLabel(/^New owner/).selectOption({ label: "Second Loan Associate" });
  await expect(go).toBeDisabled(); // remarks are required
  await t.getByLabel(/^Remarks \(required\)/).fill("Ana is on leave until Friday");
  await expect(t.locator("[data-count]")).toHaveText("28 / 500");
  await expect(go).toBeEnabled();
  await shot(page, "transfer-hold-form", false);
  await go.click();
  await expect(t).toBeHidden();
  await expect.poll(async () => (await db.hold.findFirstOrThrow({ where: { resumedAt: null } })).ownerLabel).toBe("Second Loan Associate");
  await page.reload();
  await expect(summary.locator("[data-hold-owner]")).toHaveText("Hold owner now: Second Loan Associate");
  await noSideways(page);

  // The old holder lost Resume.
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(summary.locator("[data-resume]")).toHaveCount(0);
  await expect(summary.locator("[data-resume-disabled]")).toBeDisabled();
  // The Journey records the transfer.
  await page.goto(`/loans/${PN}?tab=journey`);
  await expect(page.locator("[data-hold-transferred]").filter({ visible: true }).first()).toHaveText(/^Hold transferred from Test Loan Associate to Second Loan Associate by Test Finance · Ana is on leave until Friday · .+ PHT$/);
});

test("Inactive sender: the branch LAs see it in Open items and on Home, with the note", async ({ page }) => {
  test.setTimeout(240_000);
  const role = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  const loanBranch = await db.branch.findFirstOrThrow({ where: { name: "Cebu" } });
  const gone = await db.user.create({ data: { email: "zz.lagone@gdfi.ph", name: "Leaving Loan Associate", roleId: role.id, isTestUser: true, active: false, branches: { create: [{ branchId: loanBranch.id }] } } });
  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "NOTARY");
  await send(page, "NOTARY");
  // Sent by an LA who has since left.
  const job = await jobOf("NOTARY");
  await db.dpAssignment.update({ where: { id: job.id }, data: { assignedById: gone.id } });
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Decline the job" });
  await d.getByRole("radio", { name: "Wrong job for me" }).check();
  await d.getByLabel(/^Remarks/).fill("This is a Cebu job, I am in Quezon City");
  await d.getByRole("button", { name: "Decline", exact: true }).click();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DECLINED");

  await signInAs(page, "la");
  await expect(page.locator("[data-sent-back-home] [data-inactive-sender]")).toHaveText("Sender Leaving Loan Associate is inactive");
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  if (!wide(page)) await page.locator('[data-open-items="collapsible"] summary').click();
  await expect(page.locator('[data-open-row="returned"]').filter({ visible: true })).toContainText("Sender Leaving Loan Associate is inactive");
  await expect(page.locator("[data-sent-back] [data-inactive-sender]")).toContainText("Sender Leaving Loan Associate is inactive.");
  await shot(page, "open-items-sender-inactive");
  await noSideways(page);
});

test("Return to LA with cash released and papers: liquidation notice, Cash to settle, the LA confirms the papers before sending again", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "PPSR");
  await send(page, "PPSR");
  const job = await jobOf("PPSR");
  await signInAs(page, "dp");
  await accept(page, job.id);
  const adv = await releasedAdvance(job.transactionId);
  await page.reload();
  await page.getByRole("button", { name: /Return to LA: papers needed/ }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await expect(ret.locator("[data-liquidation-notice]")).toContainText("The cash advance must be liquidated.");
  await expect(ret.locator("[data-liquidation-notice]")).toContainText("₱1,500.00");
  await expect(ret.getByText(/keep the cash|keeping the papers/i)).toHaveCount(0);
  await ret.getByLabel("Reason").selectOption({ label: "Other" });
  await ret.getByLabel(/^Findings/).fill("The PPSR needs the Notary first.");
  const handover = ret.locator("[data-handover] input[type=checkbox]");
  const n = await handover.count();
  expect(n).toBeGreaterThan(0);
  const submit = ret.getByRole("button", { name: "Return to LA" });
  await expect(submit).toBeDisabled(); // every paper must be ticked as handed over
  for (let i = 0; i < n; i++) await handover.nth(i).check();
  await expect(submit).toBeEnabled();
  await shot(page, "return-form-liquidation", false);
  await submit.click();
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();

  // The DP still settles the cash: My funds, Liquidation, "Cash to settle".
  await page.goto("/my-funds?tab=liquidation");
  const card = page.locator(`[data-advance="${adv.number}"]`);
  await expect(card).toHaveAttribute("data-cash-to-settle", "true");
  await expect(card).toContainText("Cash to settle");
  await shot(page, "dp-cash-to-settle");
  await noSideways(page);

  // The LA: Send is blocked until the papers are confirmed; one paper "Not received" raises a Problem.
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&tx=PPSR`);
  const papers = page.locator("[data-papers-back]");
  await expect(papers.locator("[data-paper-back]")).toHaveCount(n);
  await expect(page.locator('[id^="send-why-"]').filter({ visible: true }).first()).toHaveText("Confirm you received the papers the processor handed over first.");
  await expect(page.getByText("Papers back not confirmed").filter({ visible: true }).first()).toBeVisible();
  await page.locator('[id^="send-why-"]').filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await shot(page, "send-blocked-until-confirmed");
  await papers.scrollIntoViewIfNeeded();
  await papers.locator("[data-paper-back]").first().getByLabel("Not received").check();
  await expect(papers.getByRole("button", { name: "Confirm (1 not received)" })).toBeVisible();
  await shot(page, "la-confirm-papers", false);
  await papers.getByRole("button", { name: "Confirm (1 not received)" }).click();
  await expect(page.locator("[data-papers-back]")).toHaveCount(0);
  expect(await db.problem.count({ where: { transactionId: job.transactionId, resolvedAt: null, note: { startsWith: "Not received from Test Document Processor:" } } })).toBe(1);
  await expect(page.getByText("Papers back not confirmed")).toHaveCount(0);
  await noSideways(page);
});

test("Finance on a held transaction: approving is refused with the lock message", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "MORTGAGE");
  await send(page, "MORTGAGE");
  const job = await jobOf("MORTGAGE");
  const dp = await userOf("test.dp@gdfi.ph");
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: PN } });
  await db.dpAssignment.update({ where: { id: job.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
  await db.loanTransaction.update({ where: { id: job.transactionId }, data: { status: "IN_PROCESS" } });
  const adv = await db.cashAdvance.create({ data: { number: "CA-E2E-9001", requestedById: dp.id, branchId: loan.branchId, requestedCents: 80000, lines: { create: [{ transactionId: job.transactionId, kind: "LTO_FEE", requestedCents: 80000 }] } } });
  const reason = await db.holdReason.findUniqueOrThrow({ where: { code: "FUNDS" } });
  const raisedAt = new Date();
  await db.hold.create({ data: { loanId: loan.id, transactionId: job.transactionId, reasonId: reason.id, reasonName: reason.name, note: "Waiting for the LTO fee schedule", raisedById: dp.id, raisedByLabel: dp.name, ownerId: dp.id, ownerLabel: dp.name, raisedAt } });

  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  const card = page.locator("article", { hasText: adv.number }).first();
  await card.getByRole("button", { name: /^Approve/ }).first().click();
  const confirm = page.getByRole("dialog").filter({ hasText: /approve/i });
  if (await confirm.count()) await confirm.getByRole("button", { name: /^Approve/ }).last().click();
  await expect(page.getByText(/^Locked: on hold by Test Document Processor since .+ PHT\.$/).filter({ visible: true }).first()).toBeVisible();
  expect((await db.cashAdvance.findUniqueOrThrow({ where: { id: adv.id } })).status).toBe("REQUESTED");
  await shot(page, "finance-refusal-locked", false);
  await noSideways(page);
});
