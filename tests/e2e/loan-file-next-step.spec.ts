import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanSettingsTestRows, db, resetLoans } from "./db";

/**
 * Check documents: "Do this now" (one next step, each fact once). Test database only (gdfi_dms_test).
 * Screenshots: docs/screenshots/loan-file-next-step/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/loan-file-next-step";
mkdirSync(DIR, { recursive: true });
const PN = "GD1652026901003";
const FINDINGS = "The ID copy is unreadable";

test.beforeEach(async () => {
  await resetLoans();
  await cleanSettingsTestRows();
});
test.afterAll(async () => {
  await cleanSettingsTestRows();
});

const BUTTONS = { la: "Continue as Loan Associate", dp: "Continue as Test Document Processor" } as const;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
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
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: { include: { rule: true } } } });
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
  await page.evaluate(() => sessionStorage.clear());
}

/** The card, its step that is now, and a step by kind. */
const card = (page: Page) => page.locator("[data-do-now]");
const step = (page: Page, kind: string) => card(page).locator(`[data-step="${kind}"]`);
/** The status word of a transaction in the list at this width (side list at 1100+, strip below). */
const statusWord = (page: Page, code: string) => page.locator(`[data-txn=${code}] [data-status-chip]`).filter({ visible: true });
const openItems = (page: Page) => page.locator("[data-open-items]").filter({ visible: true });

test("Do this now: returned, confirm in one click, the reason once, hold, problem, ready to send, Open items for other transactions", async ({ page }) => {
  test.setTimeout(420_000);
  await signInAs(page, "la");
  await openPn3(page);

  // Normal work: the card is short (tick, then send).
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(card(page)).toHaveAttribute("data-tone", "normal");
  await expect(step(page, "tick")).toHaveAttribute("data-step-state", "now");
  await expect(step(page, "send")).toHaveAttribute("data-step-state", "next");
  await expect(step(page, "send")).toContainText("After step 1");
  await expect(openItems(page)).toHaveCount(0);

  // NOTARY sent, accepted, and returned by the DP for one named paper (all papers handed over).
  await tickAll(page, "NOTARY");
  await send(page, "NOTARY");
  const notary = await txnOf("NOTARY");
  const paper = notary.checks.find((c) => c.required)!;
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id }, orderBy: { createdAt: "desc" } });
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator("[data-stages]")).toBeVisible();
  await page.getByRole("button", { name: "Return to LA: papers needed" }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await ret.getByLabel("Reason").selectOption({ label: "Missing paper" });
  await ret.getByRole("group", { name: "Which papers" }).getByRole("checkbox", { name: paper.rule!.label }).check();
  await ret.getByLabel(/^Findings/).fill(FINDINGS);
  for (const box of await ret.locator("[data-handover] input[type=checkbox]").all()) await box.check();
  await ret.getByRole("button", { name: "Return to LA" }).click();
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();
  const handed = await db.documentItem.count({ where: { transactionId: notary.id, stage: "IN_TRANSIT" } });
  expect(handed).toBeGreaterThan(0);

  // The LA: one card, step 1 (confirm the papers) is now; the reason is on the page exactly once.
  await signInAs(page, "la");
  await page.evaluate(() => sessionStorage.clear()); // no leftover "sent" toast from before the return
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toHaveAttribute("data-tone", "returned");
  await expect(card(page).locator("[data-do-now-context]")).toHaveText("Returned by Test Document Processor (DP) · Round 1 · The TAT clock keeps running");
  await expect(step(page, "confirm")).toHaveAttribute("data-step-state", "now");
  await expect(step(page, "confirm")).toHaveAttribute("aria-current", "step");
  await expect(step(page, "fix")).toHaveAttribute("data-step-state", "next");
  await expect(page.getByText(FINDINGS).filter({ visible: true })).toHaveCount(1);
  // The old blocks are gone: the returned card, "Sent back to you", "Waiting for papers", the papers-back list of checkboxes.
  await expect(page.locator("[data-sent-back]")).toHaveCount(0);
  await expect(page.getByText("Sent back to you").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("Waiting for papers").filter({ visible: true })).toHaveCount(0);
  await expect(page.locator("[data-paper-back]")).toHaveCount(0);
  // The status word for the transaction is "Returned"; the Open items card is hidden (it would only repeat this transaction).
  await expect(statusWord(page, "NOTARY")).toHaveText("Returned");
  await expect(page.locator("[data-txn=NOTARY] [data-status-line]")).toHaveCount(0);
  await expect(openItems(page)).toHaveCount(0);
  // The returned paper carries one small marker in the checklist.
  await expect(page.locator(`#line-${paper.id} [data-returned-marker]`).filter({ visible: true })).toHaveText("Returned: missing paper");
  await expect(page.locator("[data-requested]")).toHaveCount(0);
  await noSideways(page);
  await shot(page, "returned-now-confirm");

  // "Check each paper": every paper defaults to Received; "Not received" is only a choice.
  await step(page, "confirm").getByRole("button", { name: "Check each paper" }).click();
  const rows = page.locator("[data-paper-back]");
  await expect(rows).toHaveCount(handed);
  await expect(rows.getByRole("radio", { name: "Received", exact: true }).and(page.locator(":checked"))).toHaveCount(handed);
  await expect(rows.getByRole("radio", { name: "Not received" }).and(page.locator(":checked"))).toHaveCount(0);
  await expect(page.locator('[data-paper-back] input[type="checkbox"]')).toHaveCount(0);
  await expect(step(page, "confirm").getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await noSideways(page);
  await shot(page, "something-missing-list");
  await step(page, "confirm").getByRole("button", { name: "Cancel" }).click();

  // "All N received": confirms every paper as before; step 2 (fix) becomes now and gets the focus.
  await step(page, "confirm").getByRole("button", { name: handed === 1 ? "Received" : `All ${handed} received` }).click();
  await expect(step(page, "fix")).toHaveAttribute("data-step-state", "now");
  await expect(step(page, "confirm")).toHaveAttribute("data-step-state", "done");
  expect(await db.documentItem.count({ where: { transactionId: notary.id, stage: "IN_TRANSIT" } })).toBe(0);
  expect(await db.problem.count({ where: { transactionId: notary.id } })).toBe(0);
  await expect(page.getByText(FINDINGS).filter({ visible: true })).toHaveCount(1);
  await expect(step(page, "fix").getByRole("button", { name: "Go to this paper" })).toBeFocused();
  await expect(step(page, "fix").locator("strong")).toHaveText(paper.rule!.label);
  await noSideways(page);
  await shot(page, "returned-fix-step");

  // Open items: shown when another transaction has something (a hold on MORTGAGE), hidden otherwise.
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: PN } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const mortgage = await txnOf("MORTGAGE");
  const holdReason = await db.holdReason.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  await db.hold.create({ data: { loanId: loan.id, transactionId: mortgage.id, reasonId: holdReason.id, reasonName: holdReason.name, note: "The client signs the chattel mortgage on Monday", raisedById: la.id, raisedByLabel: la.name, ownerId: la.id, ownerLabel: la.name } });
  await page.reload();
  await expect(openItems(page)).toHaveCount(1);
  if (!wide(page)) await openItems(page).locator("summary").click();
  await expect(page.locator('[data-open-row="hold"][data-txn-code="MORTGAGE"]').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('[data-open-row][data-txn-code="NOTARY"]').filter({ visible: true })).toHaveCount(0);
  await expect(statusWord(page, "MORTGAGE")).toHaveText("On hold");
  await noSideways(page);
  await shot(page, "open-items-other-transaction");

  // On hold: the hold is the step; Resume for the owner; the checklist stays locked.
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(card(page)).toHaveAttribute("data-tone", "hold");
  await expect(step(page, "hold")).toHaveAttribute("data-step-state", "now");
  await expect(step(page, "hold").locator("[data-hold-summary] [data-resume]")).toBeVisible();
  await expect(step(page, "tick")).toHaveAttribute("data-step-state", "next");
  await expect(page.locator("[data-locked] input[type=checkbox]").first()).toBeDisabled();
  await expect(page.getByText("The client signs the chattel mortgage on Monday").filter({ visible: true })).toHaveCount(1);
  await noSideways(page);
  await shot(page, "on-hold");

  // Ready to send: the papers are ticked, Send is the step.
  await tickAll(page, "PPSR");
  await page.reload();
  await expect(card(page)).toHaveAttribute("data-tone", "normal");
  await expect(step(page, "tick")).toHaveAttribute("data-step-state", "done");
  await expect(step(page, "send")).toHaveAttribute("data-step-state", "now");
  await expect(statusWord(page, "PPSR")).toHaveText("Ready to send");
  await noSideways(page);
  await shot(page, "normal-ready-to-send");

  // Problem: first (after a hold), with its reason, who raised it and its action.
  const problemReason = await db.problemReason.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  await db.problem.create({ data: { loanId: loan.id, transactionId: (await txnOf("PPSR")).id, reasonId: problemReason.id, note: "LTO system is down this morning", raisedById: la.id, raisedByLabel: la.name } });
  await page.reload();
  await expect(card(page)).toHaveAttribute("data-tone", "problem");
  await expect(step(page, "problem")).toHaveAttribute("data-step-state", "now");
  await expect(step(page, "problem")).toContainText(problemReason.name);
  await expect(step(page, "problem")).toContainText("Raised by Test Loan Associate");
  await expect(statusWord(page, "PPSR")).toHaveText("Problem");
  await expect(page.getByText("LTO system is down this morning", { exact: false }).filter({ visible: true })).toHaveCount(1);
  await noSideways(page);
  await shot(page, "problem");
});
