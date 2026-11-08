import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * The hold lock and owner, the remark counters, the Hold reasons settings, and Decline / Return to LA
 * going back to the specific Loan Associate who sent it (rounds). Screenshots: docs/screenshots/hold-and-return/.
 */
const DIR = "docs/screenshots/hold-and-return";
mkdirSync(DIR, { recursive: true });
const PN = "PN-0001003";

test.beforeEach(async () => {
  await resetLoans();
  // The proposed reasons are the active list (other runs may have switched the testing ones on).
  await db.holdReason.updateMany({ where: { code: { in: ["BORROWER", "OTHER-TEAM", "LTO-SCHEDULE"] } }, data: { active: false } });
});

const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor" } as const;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(300); // let button colour transitions finish
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

async function tickAll(page: Page, code: string) {
  await page.goto(`/loans/${PN}?tab=todo&tx=${code}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf(code)).status).toBe("READY");
}
/** LA: sends a ready transaction to the test DP (nothing is pre-selected on a re-send, so it is picked). */
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
}

test("Hold owner and lock: the held transaction is locked; only the holder resumes; the remark counter", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "MORTGAGE");

  // The counter: "12 / 500", amber from 450, Save disabled below 5 and above 500.
  await page.getByRole("button", { name: "Put on hold" }).click();
  const form = page.getByRole("dialog", { name: "Put on hold" });
  const save = form.getByRole("button", { name: "Put on hold" });
  await form.getByLabel(/^Reason category/).selectOption({ label: "No available DP" });
  const box = form.getByLabel(/^Remarks \(required\)/);
  await expect(form.locator("[data-remarks-help]")).toHaveText("At least 5 characters, up to 500.");
  await box.fill("abcd");
  await expect(form.locator("[data-count]")).toHaveText("4 / 500");
  await expect(save).toBeDisabled();
  await box.fill("x".repeat(460));
  await expect(form.locator("[data-count]")).toHaveText("460 / 500");
  await expect(form.locator("[data-count]")).toHaveAttribute("data-warn", "true");
  await expect(save).toBeEnabled();
  await shot(page, "remark-counters", false);
  await box.fill("x".repeat(501));
  await expect(save).toBeDisabled();
  await box.fill("No processor is free in Cebu until Monday");
  await expect(form.locator("[data-count]")).toHaveText("41 / 500");
  await save.click();
  await expect(form).toBeHidden();

  // Locked: readable, controls disabled with the lock note; Resume for the holder; Next step skips it.
  await page.reload();
  await expect(page.locator("[data-hold-summary] [data-to-continue]")).toBeVisible();
  const note = page.locator("[data-lock-note]").filter({ visible: true });
  await expect(note).toHaveText(/^Locked: on hold by Test Loan Associate since .+ PHT\. Only Test Loan Associate can resume\.$/);
  await expect(page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Send to/ }).filter({ visible: true }).first()).toBeDisabled();
  await expect(page.locator("[data-paused]")).toHaveCount(0); // the lock replaces "Paused"
  await expect(page.locator("[data-hold-summary] [data-resume]")).toBeEnabled();
  await shot(page, "locked-held-transaction");
  await noSideways(page);
  // Another transaction of the same loan is not locked.
  await page.goto(`/loans/${PN}?tab=todo&tx=EDST`);
  await expect(page.locator("[data-lock-note]")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first()).toBeEnabled();

  // Anyone else (Admin here): Resume is disabled with "Only {name} can resume this."
  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  const summary = page.locator("[data-hold-summary]");
  await expect(summary.locator("[data-resume-disabled]")).toBeDisabled();
  await expect(summary.locator("[data-only-holder]")).toHaveText("Only Test Loan Associate can resume this.");
  await expect(summary.locator("[data-resume]")).toHaveCount(0);
  await shot(page, "resume-disabled-other-user");
  await noSideways(page);

  // The holder resumes: the lock lifts.
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await page.locator("[data-hold-summary] [data-resume]").click();
  const resume = page.getByRole("dialog", { name: "Resume the work" });
  await resume.getByLabel(/^Resume remarks/).fill("Grace is free now");
  await resume.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.locator("[data-lock-note]")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first()).toBeEnabled();
});

test("Hold reasons settings: the proposed list, add, reorder, switch off", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=hold-reasons");
  const dlg = page.getByRole("dialog").filter({ hasText: "Hold reasons" }).first();
  for (const name of ["No available DP", "Waiting for the client's papers", "Waiting for a MyLoans update", "Other"]) await expect(dlg.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(dlg.getByText(/Proposed, to be confirmed with the team/).first()).toBeVisible();
  await shot(page, "hold-reasons-settings", false);
  await noSideways(page);
});

test("Decline and Return to LA go back to the LA who sent it; the DP no longer sees it; send again is round 2", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, "la");
  await openPn3(page);
  await tickAll(page, "NOTARY");
  await send(page, "NOTARY");
  await tickAll(page, "PPSR");
  await send(page, "PPSR");
  const notaryJob = await jobOf("NOTARY");
  const ppsrJob = await jobOf("PPSR");

  // DP: Decline Notary (reason from the short list and remarks, both required).
  await signInAs(page, "dp");
  await page.goto(`/jobs/${notaryJob.id}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const decline = page.getByRole("dialog", { name: "Decline the job" });
  const go = decline.getByRole("button", { name: "Decline", exact: true });
  await expect(decline.getByRole("radio")).toHaveCount(4);
  await expect(go).toBeDisabled();
  await decline.getByRole("radio", { name: "No capacity" }).check();
  await decline.getByLabel(/^Remarks/).fill("Full");
  await expect(go).toBeDisabled();
  await decline.getByLabel(/^Remarks/).fill("Full this week. Please send it to Grace.");
  await expect(go).toBeEnabled();
  await shot(page, "decline-form", false);
  await go.click();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: notaryJob.id } })).status).toBe("DECLINED");
  // No longer with the DP: not in the list; the old link says so.
  await page.goto(`/jobs/${notaryJob.id}`);
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();
  await page.goto("/jobs?tab=review");
  await expect(page.getByRole("main")).not.toContainText("Notary");

  // DP: accept PPSR, then Return to LA with findings (a paper and remarks).
  await page.goto(`/jobs/${ppsrJob.id}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator("[data-stages]")).toBeVisible();
  await page.getByRole("button", { name: /Return to LA: papers needed/ }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await ret.getByLabel("Reason").selectOption({ label: "Missing paper" });
  await ret.getByRole("group", { name: "Which papers" }).getByRole("checkbox").first().check();
  for (const box of await ret.locator("[data-handover] input[type=checkbox]").all()) await box.check();

  await ret.getByLabel(/^Findings/).fill("abcd");
  await expect(ret.getByRole("button", { name: "Return to LA" })).toBeDisabled();
  await ret.getByLabel(/^Findings/).fill("The PPSR form is not signed by the client.");
  await expect(ret.locator("[data-purpose]")).toContainText("you will not see this job any more");
  await shot(page, "return-form", false);
  await ret.getByRole("button", { name: "Return to LA" }).click();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: ppsrJob.id } })).status).toBe("WITHDRAWN");
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Counts" }).getByRole("link", { name: /Returned/ })).toHaveCount(0);
  expect(await db.notification.count({ where: { user: { email: "test.dp@gdfi.ph" }, link: { startsWith: `/jobs/${ppsrJob.id}` } } })).toBe(0);

  // The LA who sent them: Home, the findings at the top, Open items; nothing pre-selected on the re-send.
  await signInAs(page, "la");
  const home = page.locator("[data-sent-back-home]");
  await expect(home.locator("[data-sent-back-row]")).toHaveCount(2);
  await expect(home).toContainText("Declined by the DP");
  await expect(home).toContainText("Returned by the DP: fix and send again");
  await page.goto(`/loans/${PN}?tab=todo&tx=PPSR`);
  const card = page.locator("[data-sent-back=returned]");
  await expect(card.locator("[data-sent-back-title]")).toHaveText("Returned by the DP: fix and send again");
  await expect(card.locator("[data-findings]")).toContainText("The PPSR form is not signed by the client.");
  await expect(card.locator("[data-sent-back-by]")).toHaveText(/^By Test Document Processor \(DP\) · .+ PHT · Round 1$/);
  if (!wide(page)) await page.locator('[data-open-items="collapsible"] summary').click();
  await expect(page.locator('[data-open-row="returned"]').filter({ visible: true })).toHaveCount(2);
  await shot(page, "la-returned-findings");
  await noSideways(page);

  // Send Notary again: round 2 (the processor is chosen again).
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator("[data-sent-back=declined] [data-findings]")).toContainText("No capacity: Full this week. Please send it to Grace.");
  await expect(page.locator("label", { hasText: "Test Document Processor" }).locator("input")).not.toBeChecked();
  await send(page, "NOTARY");
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator("[data-round]").filter({ visible: true }).first()).toHaveText("Round 2");

  // The Journey: both rounds, in order, with the findings, the DP and how long.
  await page.goto(`/loans/${PN}?tab=journey`);
  const rounds = page.locator('[data-rounds-txn="NOTARY"] [data-round-entry]');
  await expect(rounds).toHaveCount(2);
  await expect(rounds.nth(0)).toContainText("Round 1Sent to Test Document Processor by Test Loan Associate");
  await expect(rounds.nth(0).locator("[data-round-outcome]")).toHaveText(/^Declined by DP · .+ PHT · took .+$/);
  await expect(rounds.nth(0).locator("[data-round-findings]")).toHaveText("No capacity: Full this week. Please send it to Grace.");
  await expect(rounds.nth(1)).toContainText("Round 2Sent again to Test Document Processor");
  await page.locator("[data-rounds]").scrollIntoViewIfNeeded();
  await shot(page, "journey-two-rounds");
  await noSideways(page);
});
