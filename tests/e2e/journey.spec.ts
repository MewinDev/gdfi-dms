import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * Journey v2: "Where it is now" (one line per place), then Story (default) · By document · Full log.
 * GD1652026901003: the LA opens it (four transactions with the LA: one grouped line), sends Notary;
 * the DP accepts, puts it on hold, resumes and returns it to the LA with findings and the papers;
 * the LA confirms the papers. The reason is said once in the Story; By document shows one column per
 * transaction (stacked cards on a phone); the Full log is collapsed and hides automatic and not
 * applicable rows until their switches are on. The choice is kept in the address. Test database only.
 * Screenshots: docs/screenshots/journey-v2/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/journey-v2";
mkdirSync(DIR, { recursive: true });
const PN = "GD1652026901003";
const FINDINGS = "The ID copy is unreadable";

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
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(250);
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
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: { include: { rule: true } } } });

/** Ticks every paper and sends the transaction to the test DP. */
async function sendToTestDp(page: Page, code: string, funds: "YES" | "NO", kinds: string[] = []) {
  await page.goto(`/loans/${PN}?tab=todo&tx=${code}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf(code)).status).toBe("READY");
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  const lto = page.getByLabel("LTO office", { exact: true }).filter({ visible: true });
  if ((await lto.count()) && !(await lto.first().inputValue())) await lto.first().selectOption({ index: 1 });
  const beyond = page.getByLabel(/Why is this late/);
  if (await beyond.count()) await beyond.fill("Test run");
  await page.getByRole("radio", { name: funds === "YES" ? "Needs funds" : "No funds needed", exact: true }).check({ force: true });
  for (const k of kinds) await page.locator("label", { hasText: k }).click();
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await txnOf(code)).status).toBe("ASSIGNED");
  await page.evaluate(() => sessionStorage.clear());
}

const journey = (page: Page) => page.locator("[data-journey]");
const visible = (page: Page, sel: string) => page.locator(sel).filter({ visible: true });
const md = (page: Page) => page.viewportSize()!.width >= 768;

test("Journey v2: the strip groups, Story is the default and says the reason once, By document, Full log, the choice in the address", async ({ page }) => {
  test.setTimeout(420_000);
  await signInAs(page, "la");
  await openPn3(page);

  // Just opened: the four transactions are with the LA, on one line; Story is the default view.
  await page.goto(`/loans/${PN}?tab=journey`);
  await expect(journey(page)).toHaveAttribute("data-journey-view", "story");
  await expect(page.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
  const where = page.locator("[data-where-line]");
  await expect(where).toHaveCount(1);
  await expect(where).toContainText(/^Now\s*All 4 transactions: with LA Test Loan Associate since [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) \((under 1 min|\d+ min)\)/);
  await expect(where).not.toContainText(/LA LA/);
  await expect(where.locator("[data-where-pill]")).toHaveCount(1);
  await expect(page.locator("[data-story-line]").first()).toBeVisible();
  // Automatic steps: one grey line with the count (they are listed in the Full log).
  const sys = page.locator("[data-story-line][data-system]");
  await expect(sys).toHaveCount(1);
  await expect(sys).toContainText("Loan opened and checked automatically");
  await expect(sys).toContainText(/· \d+ steps?$/);
  await expect(sys.getByRole("link")).toHaveCount(0);
  await expect(page.locator("[data-story]")).toContainText("4 transactions created: Notary, EDST, Entry of PPSR and Mortgage");
  // No step numbers, no Target words in the Story.
  await expect(page.locator("[data-story]")).not.toContainText(/Target|\b\d\.\d\b/);
  await noSideways(page);
  await shot(page, "where-it-is-now-grouped", false);

  // Notary: sent; the DP accepts, holds, resumes, and returns it with findings and the papers.
  await sendToTestDp(page, "NOTARY", "NO");
  const notary = await txnOf("NOTARY");
  const paper = notary.checks.find((c) => c.required)!;
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id }, orderBy: { createdAt: "desc" } });
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator("[data-stages]")).toBeVisible();
  await page.getByRole("button", { name: "Put on hold" }).click();
  let sheet = page.getByRole("dialog", { name: "Put on hold" });
  await sheet.getByLabel("Reason").selectOption({ label: "Waiting for the client's papers" });
  await sheet.getByLabel("Remarks (required)").fill("Borrower to bring the signed page");
  await sheet.getByRole("button", { name: "Put on hold" }).click();
  await expect(page.getByRole("status", { name: "On hold" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  sheet = page.getByRole("dialog", { name: "Resume the work" });
  await sheet.getByLabel("Resume remarks").fill("Borrower signed the page");
  await sheet.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("status", { name: "On hold" })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to LA: papers needed" }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await ret.getByLabel("Reason").selectOption({ label: "Missing paper" });
  await ret.getByRole("group", { name: "Which papers" }).getByRole("checkbox", { name: paper.rule!.label }).check();
  await ret.getByLabel(/^Findings/).fill(FINDINGS);
  for (const box of await ret.locator("[data-handover] input[type=checkbox]").all()) await box.check();
  await ret.getByRole("button", { name: "Return to LA" }).click();
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();

  // The LA confirms the papers came back.
  await signInAs(page, "la");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await page.locator('[data-do-now] [data-step="confirm"] [data-step-action]').click();
  await expect(page.locator('[data-do-now] [data-step="confirm"]')).toHaveAttribute("data-step-state", "done");

  // Test data: labels printed yesterday. Each day is a date row ("Yesterday · Mon, Nov 9, 2026"); its events show their time.
  const loanRow = await db.loan.findUniqueOrThrow({ where: { pn: PN } });
  await db.auditLog.create({ data: { at: new Date(Date.now() - 86_400_000), actorLabel: "Test Loan Associate", mode: "MANUAL", action: "labels_printed", entityType: "Loan", entityId: loanRow.id, loanId: loanRow.id, pn: PN, journeyStep: "3.2", summary: "Printed 3 labels", after: { documentIds: ["a", "b", "c"] } } });

  // Story: newest first, the return flagged with its word, the reason once.
  await page.goto(`/loans/${PN}?tab=journey`);
  const DATE = /[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4}$/;
  await expect(page.locator("[data-story-heading]").first()).toHaveText(new RegExp(`^Today · ${DATE.source}`));
  const yesterday = page.locator("[data-story-day]").filter({ has: page.getByRole("heading", { name: /^Yesterday · / }) });
  await expect(yesterday.locator("[data-story-heading]")).toHaveText(new RegExp(`^Yesterday · ${DATE.source}`));
  await expect(yesterday.locator("[data-story-line]")).toContainText(["Test Loan Associate printed 3 labels"]);
  for (const t of await page.locator("[data-story-time]").allInnerTexts()) expect(t).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  const story = page.locator("[data-story]");
  const ret1 = story.locator('[data-story-line][data-flag="return"]');
  await expect(ret1).toHaveCount(1);
  await expect(ret1).toContainText(`Returned`);
  await expect(ret1).toContainText(`Test Document Processor returned Notary:`);
  await expect(ret1).toContainText("(Round 1)");
  expect((await story.innerText()).split(FINDINGS).length - 1, "the reason is said once in the Story").toBe(1);
  await expect(story.locator('[data-story-line][data-flag="hold"]')).toContainText("Test Document Processor put Notary on hold: Waiting for the client's papers (Borrower to bring the signed page)");
  await expect(story).toContainText("Test Document Processor resumed Notary: Borrower signed the page");
  await expect(story).toContainText("Test Loan Associate received the Notary papers back from Test Document Processor");
  await expect(story.locator("[data-story-day]").first().locator("h3")).toHaveText(/^Today · /);
  // The counts are soft badges in the colour of their lines (grey at 0).
  await expect(page.locator('[data-story-count="return"]')).toHaveText("1 return");
  await expect(page.locator('[data-story-count="return"]')).toHaveClass(/c-act/);
  await expect(page.locator('[data-story-count="problem"]')).toHaveText("0 problems");
  await expect(page.locator('[data-story-count="problem"]')).toHaveClass(/c-mute/);
  await expect(page.locator('[data-story-count="hold"]')).toHaveText("1 hold");
  await expect(page.locator('[data-story-count="hold"]')).toHaveClass(/c-hold/);
  // The strip: Notary returned on its own line; the other three still together.
  await expect(where).toHaveCount(2);
  await expect(page.locator('[data-where-line][data-strip="NOTARY"] [data-where-pill]')).toHaveText("Returned");
  await expect(page.locator('[data-where-line][data-strip="EDST PPSR MORTGAGE"]')).toContainText("EDST, Entry of PPSR and Mortgage: with LA Test Loan Associate");
  await noSideways(page);
  await shot(page, "story");

  // Needs attention: only the flagged lines; the count filters too.
  await story.getByRole("link", { name: "Needs attention" }).click();
  await expect(page).toHaveURL(/journey=story&show=attention/);
  await expect(page.locator("[data-story-line]")).toHaveCount(2);
  await expect(page.locator("[data-story-line]:not([data-flag])")).toHaveCount(0);
  await noSideways(page);
  await shot(page, "story-needs-attention");
  await page.locator('[data-story-count="return"]').click();
  await expect(page).toHaveURL(/flag=return/);
  await expect(page.locator("[data-story-line]")).toHaveCount(1);
  // A transaction pill and Mine.
  await page.goto(`/loans/${PN}?tab=journey&journey=story&txn=EDST`);
  await expect(page.locator("[data-story-line] [data-txn-pill]").filter({ hasNotText: "EDST" })).toHaveCount(0);
  await page.goto(`/loans/${PN}?tab=journey&journey=story&show=mine`);
  await expect(page.locator("[data-story-line]").first()).toContainText("Test Loan Associate");
  await expect(page.locator("[data-story-line]").filter({ hasText: /^.{0,12}Test Document Processor/ })).toHaveCount(0);

  // The switch: arrow keys move between the views; the choice is in the address and survives a reload.
  await page.goto(`/loans/${PN}?tab=journey`);
  await page.getByRole("tab", { name: "Story" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/journey=docs/);
  await expect(journey(page)).toHaveAttribute("data-journey-view", "docs");
  await page.reload();
  await expect(journey(page)).toHaveAttribute("data-journey-view", "docs");
  await expect(page.getByRole("tab", { name: "By document" })).toHaveAttribute("aria-selected", "true");

  // By document: one column per transaction (tablet and desktop) or stacked cards (phone).
  if (md(page)) {
    await expect(visible(page, "[data-doc-column]")).toHaveCount(4);
    await expect(visible(page, "[data-doc-card]")).toHaveCount(0);
  } else {
    await expect(visible(page, "[data-doc-card]")).toHaveCount(4);
    await expect(visible(page, "[data-doc-column]")).toHaveCount(0);
    // The one that needs attention is open; the others are closed with their status word showing.
    await expect(page.locator('[data-doc-card="NOTARY"]')).toHaveAttribute("open", "");
    await expect(page.locator('[data-doc-card="EDST"]')).not.toHaveAttribute("open", "");
    await expect(page.locator('[data-doc-card="EDST"] [data-column-status]')).toBeVisible();
  }
  const col = visible(page, md(page) ? '[data-doc-column="NOTARY"]' : '[data-doc-card="NOTARY"]');
  await expect(col.locator("[data-column-status]")).toHaveText("Returned");
  const milestones = col.locator("[data-milestone]");
  expect(await milestones.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-milestone")}:${e.getAttribute("data-milestone-state")}`)))
    .toEqual(["opened:done", "checked:done", "processor:now", "process:later", "back:later", "done:later"]);
  const proc = col.locator('[data-milestone="processor"]');
  await expect(proc.locator('[data-marker="return"]')).toContainText(`${FINDINGS}`);
  await expect(proc.locator('[data-marker="return"]')).toContainText("(Round 1)");
  await expect(proc.locator('[data-marker="hold"]')).toContainText("Waiting for the client's papers");
  await expect(col.locator('[data-milestone="checked"] [data-milestone-when]')).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) · Test Loan Associate/);
  await noSideways(page);
  await shot(page, "by-document");
  // A milestone opens its details in a panel; closing gives the focus back to it.
  const btn = proc.locator("[data-milestone-button]");
  await btn.click();
  const panel = page.getByRole("dialog", { name: "Notary: With the processor (Test Document Processor)" });
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-milestone-details] li").first()).toBeVisible();
  await noSideways(page);
  await shot(page, "by-document-milestone-open", false);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(btn).toBeFocused();
  // Needs attention first: Notary first.
  await page.getByRole("link", { name: "Needs attention first" }).click();
  await expect(page).toHaveURL(/order=attention/);
  await expect(visible(page, md(page) ? "[data-doc-column]" : "[data-doc-card]").first()).toHaveAttribute(md(page) ? "data-doc-column" : "data-doc-card", "NOTARY");

  // Full log: collapsed; inside, automatic and not applicable rows are hidden until their switch is on.
  await page.getByRole("tab", { name: "Full log" }).click();
  await expect(page).toHaveURL(/journey=log/);
  const log = page.locator("[data-full-log]");
  await expect(log).not.toHaveAttribute("open", "");
  await expect(log.locator(":scope > summary")).toContainText("Full audit log");
  await expect(log.locator(":scope > summary")).toContainText("Every step, including automatic ones. For checking.");
  await noSideways(page);
  await shot(page, "full-log-collapsed", false);
  await log.locator(":scope > summary").click();
  await expect(visible(page, "[data-log-row][data-log-sys]")).toHaveCount(0);
  await expect(visible(page, "[data-log-row][data-log-na]")).toHaveCount(0);
  expect(await page.locator("[data-log-row][data-log-sys]").count()).toBeGreaterThan(0);
  expect(await page.locator("[data-log-row][data-log-na]").count()).toBeGreaterThan(0);
  // One phrase per row; no "Target: Same day / Seconds / Instant"; step numbers here only.
  await expect(log.locator("[data-log-time]").filter({ hasText: /Target|Took|Started/ })).toHaveCount(0);
  await expect(log.locator('[data-step="3.1:NOTARY"] [data-log-time]')).toHaveText(/^Done in .+ · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
  await expect(log.locator('[data-step="3.1:NOTARY"] .mono')).toHaveText("3.1");
  await log.locator('[data-log-switch="sys"]').click();
  await expect(log.locator('[data-log-switch="sys"]')).toHaveAttribute("aria-checked", "true");
  expect(await visible(page, "[data-log-row][data-log-sys]").count()).toBeGreaterThan(0);
  await log.locator('[data-log-switch="na"]').click();
  expect(await visible(page, "[data-log-row][data-log-na]").count()).toBeGreaterThan(0);
  // Search and Who filter the rows already on the page.
  await log.locator("[data-log-search]").fill("notary");
  await expect(visible(page, "li[data-log-row]").first()).toBeVisible();
  for (const t of await visible(page, "li[data-log-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-log-text") ?? ""))) expect(t).toContain("notary");
  await log.locator("[data-log-search]").fill("");
  await log.locator("[data-log-who-filter]").selectOption("DP");
  for (const who of await visible(page, "li[data-log-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-log-who") ?? ""))) expect(who.split(" ")).toContain("DP");
  await log.locator("[data-log-who-filter]").selectOption("");
  // The holds nested under their step keep their wording.
  await expect(visible(page, '[data-sub="hold"] [data-hold-started]').first()).toHaveText(/^Put on hold · Waiting for the client's papers · Borrower to bring the signed page · by Test Document Processor · .+ PHT$/);
  await noSideways(page);
  await shot(page, "full-log-open");
  await page.reload();
  await expect(journey(page)).toHaveAttribute("data-journey-view", "log");

  // Every view: no sideways page scroll.
  for (const v of ["story", "docs", "log"]) {
    await page.goto(`/loans/${PN}?tab=journey&journey=${v}`);
    await noSideways(page);
  }
});

test("Cash amounts: Finance sees them, the LA and the DP see the status only, until the LA role gets the switch", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "la");
  await openPn3(page);
  await sendToTestDp(page, "MORTGAGE", "YES", ["LTO fee"]);
  const mortgage = (await txnOf("MORTGAGE")).id;
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
  await db.auditLog.create({ data: { actorLabel: "Test Finance", mode: "MANUAL", action: "advance_released", entityType: "CashAdvance", entityId: adv.id, loanId: job.loanId, pn: PN, journeyStep: "3.5", summary: "CA-2026-9001 released: ₱1,500.00; jobs Funded" } });

  // By document (the funds marker) and the Story (the release), for each viewer.
  const text = async () => {
    let out = "";
    for (const v of ["docs", "story"]) {
      await page.goto(`/loans/${PN}?tab=journey&journey=${v}`);
      // All the text, including closed cards on a phone (and so stricter for "no amounts").
      out += await journey(page).evaluate((el) => el.textContent ?? "");
    }
    return out;
  };
  await signInAs(page, "fin");
  expect(await text()).toContain("₱1,500.00");
  for (const who of ["la", "dp"] as const) {
    await signInAs(page, who);
    const t = await text();
    expect(t).toContain("CA-2026-9001: Funded");
    expect(t).not.toMatch(/₱|PHP \d/);
    for (const v of ["docs", "story", "log"]) {
      const html = await (await page.request.get(`/loans/${PN}?tab=journey&journey=${v}`)).text();
      expect(html).not.toContain("1,500.00");
    }
  }
  // Admin turns the switch on for the Loan Associate role: the LA sees amounts on the next request.
  await signInAs(page, "admin");
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  try {
    await page.goto(`/admin/settings?open=roles&edit=${la.id}`);
    const dialog = page.locator("dialog#settings-modal");
    await dialog.locator('[data-perm="journey:view_amounts"]').getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Saved", { exact: true }).first()).toBeVisible();
    await signInAs(page, "la");
    expect(await text()).toContain("₱1,500.00");
  } finally {
    await db.role.update({ where: { key: "LA" }, data: { permissions: la.permissions } });
  }
});
