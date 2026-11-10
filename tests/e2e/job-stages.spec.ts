import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { approveWithConfirm } from "./approve";
import { completeAndForwardUi, finishCurrentStage, workStagesUi } from "./helpers";

/**
 * DP job stages, Check and verify, manual Forward to branch, the receiving LA, and the vault gate.
 * Screenshots go to SHOTS_DIR when it is set.
 */
test.beforeEach(async () => {
  await resetLoans();
});

const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string, fullPage = true) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function openPn(page: Page, pn: string) {
  await page.goto(`/loans?fill=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  const und = main.getByRole("radio", { name: "Undertaking", exact: true });
  if (await und.count()) {
    await und.check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  }
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
const txnOf = (pn: string, code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn }, type: { code } } });
const jobOf = async (pn: string, code: string) => db.dpAssignment.findFirstOrThrow({ where: { transactionId: (await txnOf(pn, code)).id }, orderBy: { createdAt: "desc" } });

/** LA: ticks every paper of one transaction and sends it to the test DP with the funds answer. */
async function send(page: Page, pn: string, code: string, funds: "YES" | "NO", kinds: string[] = []) {
  const id = (await txnOf(pn, code)).id;
  await page.goto(`/loans/${pn}?tab=todo&work=${id}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect(page.locator('[id^="send-why-"]')).toHaveText(/funds question/);
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  const lto = page.getByLabel(/LTO office/);
  if (await lto.count()) await lto.selectOption({ index: 1 }).catch(() => {});
  const beyond = page.getByLabel(/Why is this late/);
  if (await beyond.count()) await beyond.fill("Test run");
  await page.getByText(funds === "YES" ? "Needs funds" : "No funds needed", { exact: true }).click();
  for (const k of kinds) await page.locator("label", { hasText: k }).click();
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id } })).status).toBe("ASSIGNED");
}
async function accept(page: Page, jobId: string) {
  await page.goto(`/jobs/${jobId}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator("[data-stages]")).toBeVisible();
}
async function receiveComplete(page: Page, pn: string, code: string) {
  await page.goto(`/loans/${pn}?tab=todo&work=${(await txnOf(pn, code)).id}`);
  await page.locator("[data-receive-form]").getByRole("button", { name: "Received complete" }).click();
  await expect.poll(async () => (await txnOf(pn, code)).status).toBe("COMPLETED");
}

test("Full path, GD1012026901001: stages with evidence, a problem at the LTO, Check and verify, manual forward, liquidation, receive, vault gate", async ({ page }) => {
  test.setTimeout(900_000);
  const PN = "GD1012026901001";
  await signInAs(page, "la");
  await openPn(page, PN);
  const branch = (await db.loan.findUniqueOrThrow({ where: { pn: PN }, include: { branch: true } })).branch.name;
  await send(page, PN, "NOTARY", "YES", ["LTO fee"]);
  await send(page, PN, "MORTGAGE", "NO");
  await send(page, PN, "PPSR", "NO");
  // EDST: the LA does it.
  await page.goto(`/loans/${PN}?tab=todo&work=${(await txnOf(PN, "EDST")).id}`);
  const edstPapers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await edstPapers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await page.getByLabel("EDST reference").fill("EDST-2026-001");
  await page.getByRole("button", { name: "Mark EDST done" }).click();
  await expect.poll(async () => (await txnOf(PN, "EDST")).status).toBe("COMPLETED");

  // DP accepts Notary: every paper received into the DP's custody.
  await signInAs(page, "dp");
  const notary = await jobOf(PN, "NOTARY");
  await page.goto(`/jobs/${notary.id}`);
  await expect(page.locator("[data-received-papers]")).toBeVisible();
  await accept(page, notary.id);
  const papers = await db.documentItem.count({ where: { transactionId: notary.transactionId, documentId: { not: null } } });
  expect(await db.documentMovement.count({ where: { documentItem: { transactionId: notary.transactionId }, action: "ACKNOWLEDGED_BY_DP" } })).toBe(papers);

  // Funds: the DP asks, Finance approves and releases.
  await page.goto("/my-funds");
  await page.getByRole("textbox", { name: /LTO fee amount/ }).fill("1500.00");
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();
  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  await approveWithConfirm(page);
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("APPROVED");
  await page.goto("/funds?tab=release");
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/Reference/).fill("VOUCHER-0001");
  await page.getByRole("dialog").getByRole("button", { name: "Release cash", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("RELEASED");

  // Notarization with its evidence.
  await signInAs(page, "dp");
  await page.goto(`/jobs/${notary.id}`);
  const stepper = page.locator("[data-stage-stepper]");
  await expect(stepper.locator("li")).toHaveText([/Notarization/, /LTO drop off/, /LTO pickup/, /Check and verify/]);
  await expect(stepper.locator('[data-step="now"]')).toContainText("Notarization");
  await shot(page, "job-stage-stepper");
  await noSideways(page);
  await page.locator("[data-current-stage]").getByRole("button", { name: "Start Notarization" }).click();
  await page.locator("[data-current-stage]").getByRole("button", { name: "Finish Notarization" }).click();
  const evidence = page.getByRole("dialog", { name: "Finish: Notarization" });
  await evidence.getByRole("button", { name: "Save and finish" }).click();
  // Required on screen: the pop-up stays open and the empty required field is invalid (the server checks again).
  await expect(evidence).toBeVisible();
  expect(await evidence.getByLabel("Notary name").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await evidence.getByLabel("Notary name").fill("Atty. Ramon Uy");
  await evidence.getByLabel("Document").fill("12");
  await evidence.getByLabel("Page number").fill("3");
  await evidence.getByLabel("Book number").fill("IV");
  await shot(page, "stage-evidence-popup", false);
  await noSideways(page);
  await evidence.getByRole("button", { name: "Save and finish" }).click();
  await expect(evidence).toBeHidden();
  await expect(stepper.locator('[data-step="done"]')).toHaveText([/Notarization/]);

  // LTO drop off: Not processed opens a red Problem on this stage; the clock keeps counting; carry over.
  await page.locator("[data-current-stage]").getByRole("button", { name: "Start LTO drop off" }).click();
  await expect(page.locator("[data-current-stage]").getByRole("button", { name: "Finish LTO drop off" })).toBeVisible();
  await page.getByRole("button", { name: /Log today/ }).click();
  const attempt = page.getByRole("dialog", { name: "Log today's attempt" });
  await attempt.getByRole("radio", { name: "Not processed" }).check();
  await attempt.getByLabel("Why not?").selectOption({ index: 1 });
  await attempt.getByRole("textbox", { name: /spend|LTO fee/ }).first().fill("500");
  await attempt.getByRole("radio", { name: "Carry over" }).check();
  await attempt.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toBeVisible();
  await expect(page.locator('[data-tat="problem"]').filter({ visible: true }).first()).toBeVisible();
  expect((await db.transactionAttempt.findFirstOrThrow({ where: { transactionId: notary.transactionId } })).jobStageId).toBeTruthy();
  await page.getByRole("region", { name: "Problem" }).getByRole("button", { name: "Resume" }).click();
  const resolve = page.getByRole("dialog", { name: /Resume/ });
  await resolve.getByLabel("How was it resolved?").fill("LTO back online");
  await resolve.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toHaveCount(0);
  // Next day: LTO drop off and pickup finished (the office comes from the Send step).
  await finishCurrentStage(page, { orNumber: "OR-777001" });
  await page.locator("[data-current-stage]").getByRole("button", { name: "Start LTO pickup" }).click();
  await expect(page.locator("[data-current-stage]").getByRole("button", { name: "Finish LTO pickup" })).toBeVisible();
  await finishCurrentStage(page);

  // Check and verify: one paper is reported missing (a Problem blocks it), then found and verified.
  const cur = page.locator("[data-current-stage]");
  await cur.getByRole("button", { name: "Start Check and verify" }).click();
  const open = cur.locator('[data-verify-paper="open"]');
  await expect(open).toHaveCount(papers);
  while ((await open.count()) > 1) {
    const n = await open.count();
    await open.first().getByRole("button", { name: /received back and complete/ }).click();
    await expect(open).toHaveCount(n - 1);
  }
  await cur.getByRole("button", { name: "Something is missing" }).click();
  const missing = page.getByRole("dialog", { name: "Something is missing" });
  await missing.getByRole("checkbox").first().check();
  await missing.getByRole("button", { name: "Open the problem" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toContainText("Missing paper");
  await expect(cur.locator("[data-verify-blocked]")).toBeVisible();
  await expect(cur.getByRole("button", { name: "Finish Check and verify" })).toBeDisabled();
  await page.getByRole("region", { name: "Problem" }).getByRole("button", { name: "Resume" }).click();
  await page.getByRole("dialog", { name: /Resume/ }).getByLabel("How was it resolved?").fill("Found in the folder");
  await page.getByRole("dialog", { name: /Resume/ }).getByRole("button", { name: "Resume" }).click();
  await open.first().getByRole("button", { name: /received back and complete/ }).click();
  await expect(open).toHaveCount(0);
  await cur.getByRole("button", { name: "Finish Check and verify" }).click();
  await expect(stepper.locator('[data-step="done"]')).toHaveCount(4);

  // Complete job (never forwards by itself), then the DP chooses the branch and the named LA.
  await page.locator("[data-complete-job]").getByRole("button", { name: "Complete job" }).click();
  const fwd = page.locator("[data-forward]");
  await expect(fwd.getByLabel("1. Branch")).toHaveValue("");
  await expect(fwd.getByLabel("2. Loan Associate")).toBeDisabled();
  await expect(fwd.getByRole("button", { name: "Forward to branch" })).toBeDisabled();
  expect((await txnOf(PN, "NOTARY")).status).toBe("IN_PROCESS");
  await fwd.getByLabel("1. Branch").selectOption({ label: branch });
  await fwd.getByLabel("2. Loan Associate").selectOption({ label: "Test Loan Associate" });
  await fwd.getByRole("button", { name: "Forward to branch" }).click();
  await expect(page.getByRole("alertdialog", { name: "Forward the package?" })).toContainText(`Forward ${papers} papers to Test Loan Associate at ${branch}?`);
  await page.getByRole("alertdialog", { name: "Forward the package?" }).getByRole("button", { name: `Forward ${papers} papers` }).click();
  await expect(page.getByText(/Waiting for the Loan Associate to check the papers/)).toBeVisible();

  // Liquidation runs beside forwarding: receipts, then Finance closes.
  await page.goto("/my-funds?tab=liquidation");
  await page.getByLabel("Amount (PHP)").fill("1500.00");
  await page.getByLabel("Receipt / OR no.").fill("OR-LTO-1");
  await page.getByRole("button", { name: "Add receipt" }).click();
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("LIQUIDATED");
  await signInAs(page, "fin");
  await page.goto("/funds?tab=outstanding");
  await page.getByRole("button", { name: "Close advance" }).click();
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("CLOSED");

  // The LA's to-do on Home, then received Complete.
  await signInAs(page, "la");
  const todo = page.locator("[data-packages-to-receive]");
  await expect(todo).toContainText("Package forwarded to you: receive it");
  await expect(todo).toContainText(PN);
  await shot(page, "receiving-la-todo");
  await noSideways(page);
  await todo.getByRole("link").first().click();
  await expect(page.locator("[data-receive-form]")).toBeVisible();
  await page.locator("[data-receive-form]").getByRole("button", { name: "Received complete" }).click();
  await expect.poll(async () => (await txnOf(PN, "NOTARY")).status).toBe("COMPLETED");

  // Mortgage and Entry of PPSR through their stages too; then the vault gate opens.
  for (const code of ["MORTGAGE", "PPSR"]) {
    await signInAs(page, "dp");
    const j = await jobOf(PN, code);
    await accept(page, j.id);
    await workStagesUi(page, { orNumber: "OR-777002", registrationNo: "PPSR-0001" });
    await completeAndForwardUi(page, branch);
    await signInAs(page, "la");
    await receiveComplete(page, PN, code);
  }
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("For Vault Transmittal");
});

test("Incomplete: the LA records it, the DP sees Package incomplete, corrects and forwards again", async ({ page }) => {
  test.setTimeout(400_000);
  const PN = "GD1652026901003";
  await signInAs(page, "la");
  await openPn(page, PN);
  await send(page, PN, "NOTARY", "NO");
  await signInAs(page, "dp");
  const job = await jobOf(PN, "NOTARY");
  await accept(page, job.id);
  await workStagesUi(page, { name: "Atty. Uy", docNo: "1", pageNo: "2", bookNo: "3" });
  await completeAndForwardUi(page, "Angono");
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&work=${job.transactionId}`);
  const form = page.locator("[data-receive-form]");
  await expect(form.getByRole("radio")).toHaveCount(3); // Complete, Incomplete, Other
  await form.getByRole("radio", { name: "Incomplete" }).check();
  await form.getByLabel("What is missing or wrong?").fill("Chattel Mortgage page 2 missing");
  await form.getByRole("button", { name: "Record as incomplete" }).click();
  await expect.poll(async () => (await txnOf(PN, "NOTARY")).status).toBe("IN_PROCESS");
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await expect(page.locator("[data-package-incomplete]")).toContainText("Package incomplete: Chattel Mortgage page 2 missing");
  await shot(page, "dp-package-incomplete");
  await noSideways(page);
  const fwd = page.locator("[data-forward]");
  await fwd.getByLabel("1. Branch").selectOption({ label: "Angono" });
  await fwd.getByLabel("2. Loan Associate").selectOption({ label: "Test Loan Associate" });
  await fwd.getByRole("button", { name: "Forward to branch" }).click();
  await page.getByRole("alertdialog", { name: "Forward the package?" }).getByRole("button", { name: /^Forward \d+ papers?$/ }).click();
  await expect(page.getByText(/Waiting for the Loan Associate to check the papers/)).toBeVisible();
  await signInAs(page, "la");
  await receiveComplete(page, PN, "NOTARY");
});

test("Screens: Settings Processing stages, DP Home with On hold (a returned job leaves the DP), the phone bottom bar", async ({ page }) => {
  test.setTimeout(400_000);
  // Settings > Processing stages (Admin).
  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=processing-stages");
  const d = page.locator("dialog#settings-modal");
  await expect(d.getByRole("link", { name: /Notary · Notarization/ })).toBeVisible();
  await expect(d).toContainText("Mortgage · Check and verify");
  await shot(page, "settings-processing-stages", false);
  await noSideways(page);
  await d.getByRole("link", { name: /Notary · Notarization/ }).click();
  await expect(d.locator("[data-evidence-editor]")).toBeVisible();
  await expect(d.locator("[data-evidence-row]")).toHaveCount(5);
  await shot(page, "settings-stage-edit", false);
  await noSideways(page);

  // Two jobs: one put on hold, one returned to the LA.
  const PN = "GD1652026901003";
  await signInAs(page, "la");
  await openPn(page, PN);
  await send(page, PN, "NOTARY", "NO");
  await send(page, PN, "PPSR", "NO");
  await signInAs(page, "dp");
  const n = await jobOf(PN, "NOTARY");
  await accept(page, n.id);
  // Phone: the main next action pinned above the bottom navigation, 48px high.
  const bar = page.locator("[data-pinned-action]");
  if ((page.viewportSize()?.width ?? 0) < 640) {
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveText("Start Notarization");
    const box = (await bar.getByRole("button").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    const nav = (await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).last().boundingBox())!;
    expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThanOrEqual(nav.y + 1);
    await shot(page, "job-phone-bottom-bar", false);
  } else {
    await expect(bar).toBeHidden();
  }
  // On hold: the job is locked, so the pinned action goes away until it is resumed.
  await page.getByRole("button", { name: "Put on hold" }).first().click();
  const hold = page.getByRole("dialog", { name: /on hold/i });
  await hold.getByLabel("Reason").selectOption({ index: 1 });
  await hold.getByLabel("Remarks (required)").fill("Waiting for the borrower to sign");
  await hold.getByRole("button", { name: /Put on hold/ }).click();
  await expect(page.getByRole("status", { name: "On hold" })).toBeVisible();
  await expect(bar).toBeHidden();
  await noSideways(page);
  const p = await jobOf(PN, "PPSR");
  await accept(page, p.id);
  await page.getByRole("button", { name: /Return to LA: papers needed/ }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await ret.getByLabel("Reason").selectOption({ label: "Other" });
  await ret.getByLabel(/^Findings/).fill("Wrong branch on the papers");
  for (const box of await ret.locator("[data-handover] input[type=checkbox]").all()) await box.check();

  await ret.getByRole("button", { name: "Return to LA" }).click();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("WITHDRAWN");

  // DP Home and Jobs: On hold with its chip and filter. The returned job went back to the LA who sent it:
  // no Returned tile or tab, and the old link says it is no longer with this processor.
  await page.goto("/dashboard");
  const counts = page.getByRole("region", { name: "Counts" });
  await expect(counts.getByRole("link", { name: /1\s*On hold/ })).toBeVisible();
  await expect(counts.getByRole("link", { name: /Returned/ })).toHaveCount(0);
  await shot(page, "dp-home-hold-returned");
  await noSideways(page);
  await page.goto("/jobs?tab=process&hold=1");
  await expect(page.locator("[data-hold-chip]")).toHaveCount(1);
  await page.goto(`/jobs/${p.id}`);
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();
  await noSideways(page);
});
