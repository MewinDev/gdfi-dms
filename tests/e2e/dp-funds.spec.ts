import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { completeAndForwardUi, workStagesUi } from "./helpers";

/**
 * Full path with GD1652026901003: LA sends Mortgage flagged for an LTO fee → DP accepts (labels) →
 * "At the LTO" blocked → DP requests funds → Finance approves and releases → DP logs Not processed
 * (problem, red) → Resume → Done → Complete → Forward → LA receives (Phase 5).
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

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${dir}/${name}-${w}.png`, fullPage: true });
}

async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function openPn3(page: Page) {
  await page.goto("/loans?fill=GD1652026901003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
}

async function txnId(code: string) {
  const t = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code } } });
  return t.id;
}

/** Ticks every paper of one transaction and sends it to the test DP with the given funds answer. */
async function sendTxn(page: Page, code: string, funds: "YES" | "NO", kinds: string[] = []) {
  const id = await txnId(code);
  await page.goto(`/loans/GD1652026901003?tab=todo&work=${id}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  // Ticking the last paper makes it Ready and redraws the send card: wait for that first.
  await expect(page.locator('[id^="send-why-"]')).toHaveText(/funds question/);
  // Pick the test processor's card (show all first when it is not in the top 3).
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  const lto = page.getByLabel(/LTO office/);
  if (await lto.count()) await lto.selectOption({ index: 1 }).catch(() => {});
  const beyond = page.getByLabel(/Why is this late/);
  if (await beyond.count()) await beyond.fill("Test run");
  await page.getByText(funds === "YES" ? "Needs funds" : "No funds needed", { exact: true }).click();
  for (const k of kinds) await page.locator("label", { hasText: k }).click();
  return id;
}

test("Full path with GD1652026901003: flag, accept, LTO block, request, approve, release, problem, resume, complete, forward, receive", async ({ page }) => {
  await signInAs(page, "la");
  await openPn3(page);
  const mortgage = await sendTxn(page, "MORTGAGE", "YES", ["LTO fee"]);
  await expect(page.getByText("The processor will ask Finance for the amount.")).toBeVisible();
  await shot(page, "la-send-funds-flag");
  await noSideways(page);
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  // Sending moves on to the next transaction that needs the LA; come back to Mortgage.
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: mortgage } })).status).toBe("ASSIGNED");
  await page.goto("/loans/GD1652026901003?tab=todo&tx=MORTGAGE");
  await expect(page.getByText(/Waiting for them to accept\./)).toBeVisible();
  await expect(page.getByRole("region", { name: "Mortgage: job" }).locator('[data-funds="NEEDED"]')).toBeVisible();

  // DP: Home, review and accept (labels).
  await signInAs(page, "dp");
  await expect(page.getByRole("heading", { name: "Do these next" })).toBeVisible();
  await shot(page, "dp-home");
  await noSideways(page);
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: mortgage } });
  await page.goto(`/jobs/${job.id}`);
  const accept = page.getByRole("button", { name: "Accept" });
  await expect(accept).toBeDisabled();
  await page.getByLabel("Labels are on all papers").check();
  await accept.click();
  await expect(page.getByText("This job needs funds. Request a cash advance first.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Log today/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start LTO drop off" })).toBeDisabled();

  // DP: My funds → Request.
  await page.goto("/my-funds");
  await page.getByRole("textbox", { name: /LTO fee amount/ }).fill("1500.00");
  await shot(page, "my-funds-request");
  await noSideways(page);
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();

  // Finance: approve, release.
  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  await expect(page.locator("[data-advance] [data-amount]")).toHaveText("₱1,500.00");
  await shot(page, "finance-to-approve");
  await noSideways(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  // The card leaves the tab once it is decided, so check the saved status.
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("APPROVED");
  await page.goto("/funds?tab=release");
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/Reference/).fill("VOUCHER-0001");
  await page.getByRole("dialog").getByRole("button", { name: "Release cash", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("RELEASED");
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator("[data-advance] [data-amount]")).toHaveText("₱1,500.00");
  await shot(page, "finance-outstanding");
  await noSideways(page);

  // DP: Not processed → problem (red) → Resume → Done → Complete → Forward.
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByText("Funded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Log today/ }).click();
  let sheet = page.getByRole("dialog", { name: "Log today's attempt" });
  await sheet.getByRole("radio", { name: "Not processed" }).check();
  await sheet.getByLabel("Why not?").selectOption({ index: 1 });
  await sheet.getByRole("textbox", { name: /spend|LTO fee/ }).first().fill("500");
  await sheet.getByRole("radio", { name: "Carry over" }).check();
  await sheet.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toBeVisible();
  await expect(page.locator('[data-tat="problem"]').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Attempt 1 ·/)).toBeVisible();
  await shot(page, "job-problem-timeline");
  await noSideways(page);
  await page.getByRole("button", { name: "Resume" }).click();
  sheet = page.getByRole("dialog", { name: /Resume/ });
  await sheet.getByLabel("How was it resolved?").fill("LTO back online");
  await sheet.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toHaveCount(0);
  await page.getByRole("button", { name: /Log today/ }).click();
  sheet = page.getByRole("dialog", { name: "Log today's attempt" });
  await sheet.getByRole("radio", { name: "Done" }).check();
  await sheet.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByText(/Attempt 2 ·/)).toBeVisible();
  await workStagesUi(page, { orNumber: "OR-12345" });
  await completeAndForwardUi(page, "Angono");

  // LA: the real Phase 5 receive.
  await signInAs(page, "la");
  await page.goto(`/loans/GD1652026901003?tab=todo&work=${mortgage}`);
  await page.getByRole("button", { name: "Received complete" }).click();
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: mortgage } })).status).toBe("COMPLETED");
  await expect(page.getByRole("button", { name: "Received complete" })).toHaveCount(0);
});

test("TAT chips: Waiting, Processing, Due today, Overdue, Problem and Done on the TAT and problems report", async ({ page }) => {
  await signInAs(page, "la");
  await openPn3(page);
  for (const code of ["NOTARY", "PPSR", "MORTGAGE"]) {
    await sendTxn(page, code, "NO");
    await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
    await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(async () => (await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code } } })).status).toBe("ASSIGNED");
  }
  // Shape the clocks directly (test setup): accept two jobs and move their start back.
  const jobs = await db.dpAssignment.findMany({ where: { loan: { pn: "GD1652026901003" } }, include: { transaction: { include: { type: true } } } });
  const now = Date.now();
  const day = 86_400_000;
  for (const j of jobs) {
    const code = j.transaction.type.code;
    if (code === "PPSR") {
      await db.dpAssignment.update({ where: { id: j.id }, data: { status: "ACCEPTED", decidedAt: new Date(now - 14 * day) } });
      await db.loanTransaction.update({ where: { id: j.transactionId }, data: { status: "IN_PROCESS", statusSince: new Date(now - 14 * day) } });
    }
    if (code === "MORTGAGE") {
      await db.dpAssignment.update({ where: { id: j.id }, data: { status: "ACCEPTED", decidedAt: new Date(now - day) } });
      await db.loanTransaction.update({ where: { id: j.transactionId }, data: { status: "IN_PROCESS", statusSince: new Date(now - day) } });
      const reason = await db.problemReason.findFirstOrThrow({ where: { active: true } });
      await db.problem.create({ data: { loanId: j.loanId, transactionId: j.transactionId, reasonId: reason.id, raisedByLabel: "E2E", raisedAt: new Date(now - day) } });
    }
  }
  await signInAs(page, "admin");
  await expect(page.getByRole("heading", { name: "TAT and problems" })).toBeVisible();
  await page.goto("/reports/tat?show=all");
  await expect(page.locator('[data-tat="problem"]').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('[data-tat="overdue"]').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('[data-tat="due"], [data-tat="processing"]').filter({ visible: true }).first()).toBeVisible();
  await shot(page, "tat-chips");
  await noSideways(page);
});

test("Sign-in page lists the test users in test mode", async ({ page }) => {
  await page.goto("/login");
  for (const name of Object.values(BUTTONS)) await expect(page.getByRole("button", { name })).toBeVisible();
  await noSideways(page);
});
