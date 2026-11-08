import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice } from "./helpers";

/**
 * Softer borders and keyboard-only focus rings; the LA changes a sent job before the processor accepts;
 * the processor returns an accepted job to the LA for papers (with the cash question); the LA's view
 * after a return. Screenshots go to SHOTS_DIR when it is set. No sideways page scroll.
 */
test.beforeEach(async () => {
  await resetLoans();
});

const BUTTONS = { la: "Continue as Loan Associate", dp: "Continue as Test Document Processor" } as const;
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
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
const toast = (page: Page) => page.locator("[data-live-toast]");
async function openPn3(page: Page) {
  await page.goto("/loans?fill=PN-0001003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/PN-0001003/);
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "PN-0001003" }, type: { code } }, include: { checks: { include: { rule: true } } } });
const outline = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });

test("Softer borders; the focus ring shows for the keyboard only", async ({ page }) => {
  await signInAs(page, "la");
  await openPn3(page);
  await page.goto("/loans/PN-0001003?tab=todo&tx=NOTARY");
  const card = page.getByRole("region", { name: "Notary", exact: true });
  if (page.viewportSize()!.width >= 600) {
    const b = await card.evaluate((e) => { const s = getComputedStyle(e); return `${s.borderTopWidth} ${s.borderTopColor}`; });
    expect(b).toBe("1px rgb(219, 226, 234)");
  }
  const list = wide(page) ? page.getByRole("region", { name: /^Transactions \(\d+\)$/ }) : page.getByRole("region", { name: "Transactions", exact: true });
  const open = list.locator("[data-txn=NOTARY]");
  const style = await open.evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, shadow: s.boxShadow, border: s.borderTopColor }; });
  expect(style.bg).toBe("rgb(238, 242, 248)");
  expect(style.shadow).toContain("rgb(245, 166, 35)"); // the gold bar on the left edge
  expect(style.shadow).not.toContain("rgb(12, 35, 64)"); // no navy box outline
  await shot(page, "soft-borders");
  await noSideways(page);

  // Mouse: selecting another transaction moves focus to its title without a ring.
  await list.locator("[data-txn=EDST]").click();
  await expect(page).toHaveURL(/tx=EDST/);
  await expect(page.locator("h2:focus")).toHaveText("EDST");
  expect(await outline(page, "h2:focus")).toMatch(/^none /);
  // Keyboard: a clear 2px navy ring with offset on rows, buttons, fields and tabs.
  await page.locator("body").press("Tab");
  for (let i = 0; i < 40; i++) {
    const tag = await page.evaluate(() => document.activeElement?.closest("[data-txn], nav[aria-label='Loan file sections'] a, input, button") ? "ok" : "");
    if (tag) break;
    await page.keyboard.press("Tab");
  }
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`; });
  expect(ring).toMatch(/^solid 2px rgb\((12, 35, 64|255, 255, 255)\) 2px$/);
});

test("Before accept the LA can change it; after a return the LA sees the papers needed", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "la");
  await openPn3(page);
  // Send Notary (required papers only) to the test processor.
  await page.goto("/loans/PN-0001003?tab=todo&tx=NOTARY");
  const papers = page.getByRole("group", { name: "Notary papers" });
  const notary = await txnOf("NOTARY");
  for (const c of notary.checks.filter((x) => x.required)) await papers.getByLabel(c.rule!.label).check();
  await expect(page.locator('[id^="send-why-"]')).toHaveText(/funds question/);
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  await page.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await txnOf("NOTARY")).status).toBe("ASSIGNED");

  // A. The Sent card: not accepted yet, the change actions.
  await page.goto("/loans/PN-0001003?tab=todo&tx=NOTARY");
  const before = page.locator("[data-before-accept]");
  await expect(before).toContainText("Not accepted yet. You can still change this.");
  for (const b of ["Update papers", "Change funds", "Change processor", "Add a note for the processor", "Pull back"]) await expect(before.getByRole("button", { name: b })).toBeVisible();
  await before.getByRole("button", { name: "Change processor" }).click();
  await expect(page.getByRole("dialog", { name: "Change processor" }).locator("[data-purpose]")).toContainText("The first processor is told");
  await page.getByRole("dialog", { name: "Change processor" }).getByRole("button", { name: "Cancel" }).click();
  await before.getByRole("button", { name: "Pull back" }).click();
  await expect(page.getByRole("dialog", { name: "Pull back" }).locator("[data-purpose]")).toContainText("It comes back to you as Ready to send.");
  await page.getByRole("dialog", { name: "Pull back" }).getByRole("button", { name: "Cancel" }).click();
  // Update papers (an optional paper) and add a note.
  const optional = notary.checks.find((c) => !c.required)!;
  await papers.getByLabel(optional.rule!.label).check();
  await expect(page.getByText(/All changes saved|Saved just now/).first()).toBeVisible();
  await expect.poll(async () => (await db.checklistCheck.findUniqueOrThrow({ where: { id: optional.id } })).checked, { timeout: 15_000 }).toBe(true);
  await before.getByRole("button", { name: "Add a note for the processor" }).click();
  await page.getByRole("dialog", { name: "Note for the processor" }).getByLabel("Note").fill("The ID copy is in the brown envelope");
  await page.getByRole("dialog", { name: "Note for the processor" }).getByRole("button", { name: "Send note" }).click();
  await expect(toast(page)).toHaveText(/Note sent to the processor/);
  await expect(page.getByRole("dialog", { name: "Note for the processor" })).toBeHidden();
  await before.scrollIntoViewIfNeeded();
  await shot(page, "sent-card-before-accept");
  await noSideways(page);

  // The processor sees "Updated by" and the list, then accepts.
  await signInAs(page, "dp");
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id } });
  await page.goto(`/jobs/${job.id}`);
  const upd = page.locator("[data-updated-by]");
  await expect(upd).toContainText(/Updated by Test Loan Associate · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/);
  await expect(upd).toContainText(`Added ${optional.rule!.label}`);
  await expect(upd).toContainText("Note: The ID copy is in the brown envelope");
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible();

  // Cash held for the job (test setup: released for this job).
  await db.cashAdvance.create({
    data: {
      number: "CA-2026-9101", requestedById: job.dpUserId, branchId: job.dpBranchId, status: "RELEASED", requestedCents: 50000, approvedCents: 50000, releasedCents: 50000, approvedAt: new Date(), releasedAt: new Date(), releaseRef: "E2E",
      lines: { create: { transactionId: notary.id, kind: "NOTARY_FEE", requestedCents: 50000, approvedCents: 50000, releasedCents: 50000 } },
    },
  });
  await page.reload();
  // B. Return to LA: papers needed (with the cash question).
  await page.getByRole("button", { name: "Return to LA: papers needed" }).click();
  const ret = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await expect(ret.locator("[data-purpose]")).toContainText("Not a problem; the turnaround time keeps counting.");
  const submit = ret.getByRole("button", { name: "Return to LA" });
  await ret.getByLabel("Reason").selectOption({ label: "Missing paper" });
  const required = notary.checks.find((c) => c.required)!;
  await ret.getByRole("group", { name: "Which papers" }).getByRole("checkbox", { name: required.rule!.label }).check();
  await ret.getByLabel(/^Findings/).fill("Bring the original ID");
  // No "keep" choices any more: the cash must be liquidated, and every paper is handed over.
  await expect(ret.getByText(/I am keeping the papers|Keep the cash for the re-send/)).toHaveCount(0);
  await expect(ret.locator("[data-liquidation-notice]")).toContainText("You hold ₱500.00 for this job");
  await expect(submit).toBeDisabled(); // the papers are not ticked as handed over yet
  for (const box of await ret.locator("[data-handover] input[type=checkbox]").all()) await box.check();

  await expect(ret.locator("[data-now-line]")).toHaveText(/^Returns now: .+ PHT$/);
  await expect(submit).toBeEnabled();
  await shot(page, "dp-return-to-la-popup", false);
  await submit.click();
  // The job is no longer the DP's: the page says so (the toast may be replaced by that page).
  await expect(page.getByRole("heading", { name: "This job is no longer with you." })).toBeVisible();
  await expect.poll(async () => (await db.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id }, orderBy: { createdAt: "desc" } })).status).toBe("WITHDRAWN");
  await shot(page, "dp-job-returned");
  await noSideways(page);

  // The LA who sent it: the findings at the top, the Requested tag, the Open items rows; the processor is chosen again (nothing pre-selected).
  await signInAs(page, "la");
  await page.goto("/loans/PN-0001003?tab=todo&tx=NOTARY");
  await expect(page.locator("[data-sent-back=returned] [data-findings]")).toContainText("Missing paper");
  await expect(page.locator("[data-sent-back=returned] [data-findings]")).toContainText("Bring the original ID");
  const tag = page.getByRole("group", { name: "Notary papers" }).locator("[data-requested]");
  await expect(tag).toHaveCount(1);
  await expect(tag).toHaveAttribute("title", /^Asked by Test Document Processor \(DP\)/);
  const list = wide(page) ? page.locator('[data-open-items="card"]') : page.locator('[data-open-items="collapsible"]');
  if (!wide(page)) await list.locator("summary").click();
  await expect(list.locator('[data-open-row="missing"]')).toContainText("Test Document Processor (DP)");
  // One pill per row: the open missing-paper request wins; the line says it was returned.
  await expect(page.locator("[data-status-line]", { hasText: "Returned: Missing paper" }).filter({ visible: true }).first()).toBeVisible();
  await shot(page, "la-after-return");
  await noSideways(page);
  await page.getByRole("group", { name: "Notary papers" }).getByLabel(required.rule!.label).check();
  await expect(page.getByRole("group", { name: "Notary papers" }).locator("[data-requested]")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("label", { hasText: "Test Document Processor" }).locator("input")).not.toBeChecked();
  // No "Pending" or "Rejected" for these states.
  expect(await page.locator("main").innerText()).not.toMatch(/pending|rejected/i);
});
