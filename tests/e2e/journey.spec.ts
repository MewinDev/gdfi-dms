import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { completeAndForwardUi, workStagesUi } from "./helpers";

/**
 * The one Journey (replaces History): PN-0001003 Notary goes Send → DP accepts → On hold (Waiting on
 * borrower) → Resume → Problem → Resolve → finish; then the Journey tab: order, nested sub-rows,
 * durations and PHT times, scope and filters, bars and their table, the Documents custody trail.
 * Cash amounts: Finance sees them, the LA and the DP see the status only, until the LA role gets the
 * switch in Roles and access. Screenshots go to SHOTS_DIR when it is set. No sideways page scroll.
 */
test.beforeEach(async () => {
  await resetLoans();
});

const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
const PHT = /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/;

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
async function openPn3(page: Page) {
  await page.goto("/loans?fill=PN-0001003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/PN-0001003/);
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "PN-0001003" }, type: { code } } });

/** Ticks every paper and sends the transaction to the test DP. */
async function sendToTestDp(page: Page, code: string, funds: "YES" | "NO", kinds: string[] = []) {
  const t = await txnOf(code);
  await page.goto(`/loans/PN-0001003?tab=todo&work=${t.id}`);
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
  await expect.poll(async () => (await txnOf(code)).status).toBe("ASSIGNED");
  return t.id;
}

test("Journey: hold, resume, problem, resolve, finish; list, scope, filters, bars, documents", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "la");
  await openPn3(page);
  const notary = await sendToTestDp(page, "NOTARY", "NO");

  // The old History address opens the Journey tab; the History tab and the hidden Journey link are gone.
  await page.goto("/loans/PN-0001003?tab=history");
  await expect(page).toHaveURL(/tab=journey/);
  const tabs = page.getByRole("navigation", { name: "Loan file sections" });
  await expect(tabs.getByRole("link")).toHaveText(["To do", "Documents", "Journey"]);
  await page.goto("/loans/PN-0001003/journey");
  await expect(page).toHaveURL(/\/loans\/PN-0001003\?tab=journey/);
  await page.goto("/loans/PN-0001003?tab=todo");
  await expect(page.getByText("See every step (all 10 phases)")).toHaveCount(0);

  // DP accepts and puts it on hold (pop-up with the discard-confirm).
  await signInAs(page, "dp");
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: notary } });
  await page.goto(`/jobs/${job.id}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible();
  await page.getByRole("button", { name: "Put on hold" }).click();
  let sheet = page.getByRole("dialog", { name: "Put on hold" });
  await sheet.getByLabel("Reason").selectOption({ label: "Waiting for the client's papers" });
  await sheet.getByLabel("Remarks (required)").fill("Borrower to bring the signed page");
  // Esc with a change asks first; Keep editing keeps it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await shot(page, "dp-put-on-hold", false);
  await sheet.getByRole("button", { name: "Put on hold" }).click();
  await expect(page.getByRole("status", { name: "On hold" })).toContainText("On hold: Waiting for the client's papers");
  await expect(page.getByRole("status", { name: "On hold" })).toContainText("Borrower to bring the signed page");
  const chip = page.locator('[data-tat="hold"]').filter({ visible: true }).first();
  await expect(chip).toContainText(/On hold 1 day · Waiting for the client's papers · Day 1 of \d/);
  await shot(page, "dp-job-on-hold");
  await noSideways(page);

  // The strip and the TAT chip on the Journey say On hold.
  await page.goto("/loans/PN-0001003?tab=journey");
  const strip = page.locator('[data-strip="NOTARY"]');
  await expect(strip).toContainText("On hold");
  await expect(strip).toContainText(/With DP Test Document Processor · On hold: waiting for the client's papers since /);
  await expect(strip.locator('[data-tat="hold"]')).toBeVisible();
  await shot(page, "journey-strip-on-hold", false);
  await noSideways(page);
  expect(await db.notification.count({ where: { title: { contains: "put on hold" } } })).toBeGreaterThan(0);

  // Resume, raise a problem, resolve it.
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Resume" }).click();
  sheet = page.getByRole("dialog", { name: "Resume the work" });
  await sheet.getByLabel("Resume remarks").fill("Borrower signed the page");
  await sheet.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("status", { name: "On hold" })).toHaveCount(0);
  await page.getByRole("button", { name: "Raise a problem" }).click();
  sheet = page.getByRole("dialog", { name: "Raise a problem" });
  await sheet.getByLabel("Reason").selectOption({ index: 1 });
  await sheet.getByRole("button", { name: "Raise problem" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toBeVisible();
  await page.getByRole("region", { name: "Problem" }).getByRole("button", { name: "Resume" }).click();
  sheet = page.getByRole("dialog", { name: /Resume: resolve/ });
  await sheet.getByLabel("How was it resolved?").fill("Notary office reopened");
  await sheet.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("region", { name: "Problem" })).toHaveCount(0);

  // Finish: attempt, complete, forward; the LA receives it.
  await page.getByRole("button", { name: /Log today/ }).click();
  sheet = page.getByRole("dialog", { name: "Log today's attempt" });
  await sheet.getByRole("radio", { name: "Done" }).check();
  await sheet.getByRole("button", { name: "Save attempt" }).click();
  await expect(page.getByText(/Attempt 1 ·/)).toBeVisible();
  await workStagesUi(page, { name: "Atty. Ramon Uy", docNo: "12", pageNo: "3", bookNo: "IV" });
  await completeAndForwardUi(page, "Cebu");
  await signInAs(page, "la");
  await page.goto(`/loans/PN-0001003?tab=todo&work=${notary}`);
  await page.getByRole("button", { name: "Received complete" }).click();
  await expect.poll(async () => (await txnOf("NOTARY")).status).toBe("COMPLETED");

  // Journey, list view: the 10 phases in order, nested sub-rows, durations, PHT times.
  await page.goto("/loans/PN-0001003?tab=journey");
  await expect(page.locator("[data-phase]")).toHaveCount(10);
  expect(await page.locator("[data-phase]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-phase"))))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const order = await page.locator('[data-step$=":NOTARY"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-step")));
  expect(order).toEqual(["3.1:NOTARY", "3.6:NOTARY", "4.1:NOTARY", "4.2:NOTARY", "4.6:NOTARY", "5.1:NOTARY"]);
  const process = page.locator('[data-step="4.2:NOTARY"]');
  await expect(process.locator('[data-sub="hold"]')).toContainText("On hold: Waiting for the client's papers");
  await expect(process.locator('[data-sub="hold"] [data-hold-started]')).toHaveText(/^Put on hold · Waiting for the client's papers · Borrower to bring the signed page · by Test Document Processor · .+ PHT$/);
  await expect(process.locator('[data-sub="hold"] [data-hold-resumed]')).toHaveText(/^Resumed · Borrower signed the page · by Test Document Processor · .+ PHT · was on hold for .+$/);
  await expect(process.locator('[data-sub="problem"]')).toContainText("Problem:");
  await expect(process.locator('[data-sub="attempt"]')).toContainText("Done");
  await expect(process).toContainText(/Took (under 1 min|\d+[mhd])/);
  await expect(process).toContainText(PHT);
  await expect(process).toContainText(/Processing .*On hold .*Problem /);
  await process.locator("summary", { hasText: /Details \(\d+\)/ }).click();
  await expect(process).toContainText("Put on hold · Waiting for the client's papers · Borrower to bring the signed page · by Test Document Processor");
  await expect(page.locator('[data-step="6.1"]')).toContainText(/Later · Target:/);
  await shot(page, "journey-list");
  await noSideways(page);

  // Scope and filters (kept in the address).
  await page.getByRole("group", { name: "Show" }).getByRole("link", { name: "Notary" }).click();
  await expect(page).toHaveURL(/scope=NOTARY/);
  await expect(page.locator("[data-step]").first()).toHaveAttribute("data-step", /:NOTARY$/);
  await expect(page.locator('[data-strip]')).toHaveCount(1);
  await page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "Problems and holds" }).click();
  await expect(page).toHaveURL(/scope=NOTARY&filter=issues/);
  await expect(page.locator("[data-step]")).toHaveCount(1);
  await page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "My steps" }).click();
  // The LA's own steps: checking the papers (the LA opened the file), not the processor's.
  await expect(page.locator('[data-step="3.1:NOTARY"]')).toHaveCount(1);
  await expect(page.locator('[data-step="4.2:NOTARY"]')).toHaveCount(0);
  await page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "All" }).click();

  // Bars view and its table.
  await page.getByRole("group", { name: "View" }).getByRole("link", { name: "Bars" }).click();
  await expect(page).toHaveURL(/view=bars/);
  await expect(page.locator("[data-bars]")).toBeVisible();
  const table = page.locator("[data-bars-table]");
  await expect(table).toContainText("On hold");
  await expect(table).toContainText("Problem");
  await expect(table).toContainText("Done");
  await shot(page, "journey-bars");
  await noSideways(page);

  // Documents scope: search, custody trail with "Acknowledged by" and time held.
  await page.getByRole("group", { name: "Show" }).getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/scope=DOCS/);
  await page.getByPlaceholder("Find by name or Document ID").fill("Promissory");
  const doc = page.locator("[data-doc]").first();
  await doc.locator("summary").click();
  await expect(doc).toContainText("Received by the processor");
  await expect(doc).toContainText("Acknowledged by Test Document Processor");
  await expect(doc).toContainText("Received by the LA");
  await expect(doc).toContainText("Sent to the processor");
  await expect(doc.getByRole("table")).toContainText("Time held");
  await shot(page, "journey-documents");
  await noSideways(page);
});

test("Cash amounts: Finance sees them, the LA and the DP see the status only, until the LA role gets the switch", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "la");
  await openPn3(page);
  const mortgage = await sendToTestDp(page, "MORTGAGE", "YES", ["LTO fee"]);
  // Test setup: the DP accepted and Finance released ₱1,500.00 for the LTO fee.
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: mortgage }, include: { loan: true } });
  const now = new Date();
  await db.dpAssignment.update({ where: { id: job.id }, data: { status: "ACCEPTED", decidedAt: now } });
  await db.loanTransaction.update({ where: { id: mortgage }, data: { status: "IN_PROCESS", statusSince: now } });
  const adv = await db.cashAdvance.create({
    data: {
      number: "CA-2026-9001", requestedById: job.dpUserId, branchId: job.dpBranchId, status: "RELEASED", requestedCents: 150000, approvedCents: 150000, releasedCents: 150000, approvedAt: now, releasedAt: now, releaseRef: "E2E",
      lines: { create: { transactionId: mortgage, kind: "LTO_FEE", requestedCents: 150000, approvedCents: 150000, releasedCents: 150000 } },
    },
  });
  await db.auditLog.create({ data: { actorLabel: "Test Finance", mode: "MANUAL", action: "advance_released", entityType: "CashAdvance", entityId: adv.id, loanId: job.loanId, pn: "PN-0001003", journeyStep: "3.5", summary: "CA-2026-9001 released: ₱1,500.00; jobs Funded" } });

  const journey = async () => {
    await page.goto("/loans/PN-0001003?tab=journey");
    return (await page.locator("[data-journey]").innerText());
  };
  // Finance: amounts.
  await signInAs(page, "fin");
  expect(await journey()).toContain("₱1,500.00");
  await shot(page, "journey-finance-amounts", false);
  // LA and DP: status only, and the amount is not in the page they receive.
  for (const who of ["la", "dp"] as const) {
    await signInAs(page, who);
    const text = await journey();
    expect(text).toContain("CA-2026-9001: Funded");
    expect(text).not.toMatch(/₱|PHP \d/);
    const html = await (await page.request.get("/loans/PN-0001003?tab=journey")).text();
    expect(html).not.toContain("1,500.00");
  }
  // Admin turns the switch on for the Loan Associate role: the LA sees amounts on the next request.
  await signInAs(page, "admin");
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  try {
    await page.goto(`/admin/settings?open=roles&edit=${la.id}`);
    const dialog = page.locator("dialog#settings-modal");
    await dialog.getByRole("switch", { name: "See cash amounts in the Journey" }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Saved", { exact: true }).first()).toBeVisible();
    await signInAs(page, "la");
    expect(await journey()).toContain("₱1,500.00");
  } finally {
    await db.role.update({ where: { key: "LA" }, data: { permissions: la.permissions } });
  }
});
