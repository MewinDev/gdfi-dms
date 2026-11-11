import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice, signIn, watchConsole } from "./helpers";

/**
 * "Send to a Document Processor" on Check documents: the ready check, the reason beside the locked
 * Send button (papers to tick, then remarks for a paper marked Missing, then funds, the processor and
 * the LTO office), funds (nothing pre-selected, kinds only for Needs funds, suggested kinds), processor
 * cards (recommended pre-selected, Show all, keyboard, another branch), the late reason, no labels to
 * print, and the Processor job card only after sending (the transaction list shows one status word,
 * "Sent to DP"; who it went to is in the job card). Screenshots go to SHOTS_DIR when it is set.
 * The browser console must stay clean.
 */
const EXTRA_DP = "zz.dp.extra@gdfi.ph";

// Antipolo's usual LTO office (seeded) is pre-selected on Notary. These tests start with none, so the
// "No LTO office chosen" check shows; it is put back after each test (lto.spec.ts covers the pre-selection).
let usualLto: string | null = null;
test.beforeEach(async () => {
  await resetLoans();
  await db.user.deleteMany({ where: { email: EXTRA_DP } });
  usualLto = (await db.branch.findUniqueOrThrow({ where: { code: "101" } })).usualLtoOfficeId;
  await db.branch.update({ where: { code: "101" }, data: { usualLtoOfficeId: null } });
});
test.afterEach(async () => {
  await db.user.deleteMany({ where: { email: EXTRA_DP } });
  await db.branch.update({ where: { code: "101" }, data: { usualLtoOfficeId: usualLto } });
});

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

/** Opens GD1012026901001 and goes to Check documents for Notary. */
async function openNotary(page: Page) {
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  await expect(notary.getByRole("heading", { name: "Send to a Document Processor" })).toBeVisible();
  return notary;
}

const REQUIRED = ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Valid IDs of borrower (2)", "Deed of Sale"];
/** The main test marks this one Missing (with a reason and remarks) and ticks the last one. */
const MISSING = REQUIRED[3];
const LAST = REQUIRED[4];

test("Not ready → ready: ready check, the reason beside Send in order, funds, processors, keyboard; no job card until sent", async ({ page }) => {
  // A fourth processor in the loan's branch, so "Show all" has something to show.
  const loanBranch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  const dpRole = await db.role.findUniqueOrThrow({ where: { key: "DP" } });
  await db.user.create({ data: { email: EXTRA_DP, name: "Zed Extra", roleId: dpRole.id, branches: { create: { branchId: loanBranch.id } } } });

  const clean = watchConsole(page);
  const notary = await openNotary(page);
  const why = notary.locator('[id^="send-why-"]');
  const send = notary.getByRole("button", { name: /^Send to / });
  const ready = notary.getByRole("list", { name: "Ready to send?" });

  // Nothing ticked: four checks (Notary needs LTO processing), the first missing thing beside the locked button.
  await expect(ready.getByRole("button", { name: /Papers 0 of 5/ })).toBeVisible();
  await expect(ready.getByRole("button", { name: "Funds not answered" })).toBeVisible();
  await expect(ready.getByRole("button", { name: "No LTO office chosen" })).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(why).toHaveText("Tick 5 more required papers");
  expect(await send.getAttribute("aria-describedby")).toBe(await why.getAttribute("id"));
  // No Processor job card, TAT chip or Raise a problem before sending.
  await expect(page.getByRole("region", { name: "Notary: job" })).toHaveCount(0);
  await expect(notary.getByRole("button", { name: "Raise a problem" })).toHaveCount(0);
  // Labels are gone: nothing to print, before or after the papers are ticked.
  await expect(notary.getByRole("link", { name: /Print labels/ })).toHaveCount(0);
  await expect(notary.getByText(/Labels not printed/)).toHaveCount(0);

  // Funds: nothing pre-selected; kinds only for Needs funds.
  await expect(notary.getByRole("radio", { name: "Needs funds" })).not.toBeChecked();
  await expect(notary.getByRole("radio", { name: "No funds needed" })).not.toBeChecked();
  await expect(notary.getByRole("checkbox", { name: /Notary fee/ })).toHaveCount(0);

  // The recommended processor is pre-selected; top 3, then Show all (4).
  const cards = notary.getByRole("radiogroup", { name: /Processors in/ }).getByRole("radio");
  await expect(cards).toHaveCount(3);
  await expect(notary.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(cards.first()).toBeChecked();
  await notary.getByRole("button", { name: "Show all (4)" }).click();
  await expect(cards).toHaveCount(4);
  await expect(notary.getByText("Zed Extra")).toBeVisible();
  // Radio keyboard: arrow keys move the choice.
  await cards.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(cards.nth(1)).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(cards.first()).toBeChecked();

  // Ready-check link: scrolls to and highlights the first missing paper.
  await ready.getByRole("button", { name: /Papers 0 of 5/ }).click();
  await expect(notary.locator('[data-highlight="true"]').first()).toBeVisible();
  await shot(page, "send-not-ready");
  await noSideways(page);

  for (const item of REQUIRED.slice(0, 3)) await notary.getByLabel(item).check();
  await expect(why).toHaveText("Tick 2 more required papers");

  // A paper marked Missing still locks Send until its reason and remarks are saved; a paper not yet
  // answered comes first.
  const row = notary.locator("[data-paper-row]", { has: page.getByText(MISSING, { exact: true }) });
  await row.getByRole("button", { name: "Missing", exact: true }).click();
  await expect(row).toHaveAttribute("data-state", "missing-no-remarks");
  await expect(why).toHaveText("Tick 1 more required paper");
  await notary.getByLabel(LAST).check();
  await expect(ready.getByRole("button", { name: /Papers 4 of 5/ })).toBeVisible();
  await expect(why).toHaveText(`Add remarks for: ${MISSING}`);
  await expect(send).toBeDisabled();
  const form = row.locator("[data-remarks-form]");
  await form.locator("[data-reason-chips] label", { hasText: "Borrower to submit later" }).click();
  await form.getByLabel("Remarks", { exact: true }).fill("The borrower brings the second ID on Monday.");
  await form.getByRole("button", { name: "Save remarks" }).click();
  await expect(row).toHaveAttribute("data-state", "missing", { timeout: 15_000 });
  await expect(ready.getByText("Papers 5 of 5")).toBeVisible();
  await expect(why).toHaveText("Answer the funds question");

  // Ready-check link for funds highlights its part.
  await ready.getByRole("button", { name: "Funds not answered" }).click();
  await expect(notary.locator('[id^="funds-"]')).toHaveClass(/border-gold/);

  // Needs funds: kinds appear; the kind from Settings (Notary fee) is pre-highlighted, not ticked.
  await notary.getByText("Needs funds", { exact: true }).click();
  await expect(notary.getByRole("checkbox", { name: /Notary fee/ })).not.toBeChecked();
  await expect(notary.locator('[data-suggested="true"]')).toContainText("Notary fee");
  await expect(why).toHaveText("Pick what the funds are for");
  await notary.locator("label", { hasText: "Notary fee" }).click();
  await expect(notary.getByRole("checkbox", { name: /Notary fee/ })).toBeChecked();

  // Another branch with no processor: "Pick a processor".
  await notary.getByRole("button", { name: "Choose from another branch" }).click();
  const mkt = await db.branch.findUniqueOrThrow({ where: { code: "168" } });
  const mktDps = await db.user.count({ where: { active: true, role: { key: "DP" }, branches: { some: { branchId: mkt.id } } } });
  await notary.getByLabel("Branch", { exact: true }).selectOption({ label: "A. Mabini" });
  await expect(notary.getByText("This goes to a processor outside the loan’s branch.")).toBeVisible();
  if (mktDps === 0) {
    await expect(notary.getByText("No processor is available in A. Mabini.")).toBeVisible();
    await expect(why).toHaveText("Pick a processor");
  }
  await notary.getByRole("button", { name: /^Back to / }).click();

  // The LTO office: required for Notary; its ready check focuses the list; the reason comes after the processor.
  await expect(why).toHaveText("Pick the LTO office");
  await expect(send).toBeDisabled();
  await ready.getByRole("button", { name: "No LTO office chosen" }).click();
  await expect(notary.getByLabel("LTO office", { exact: true })).toBeFocused();
  await pickLtoOffice(page);
  const office = (await notary.getByLabel("LTO office", { exact: true }).locator("option:checked").textContent())!.trim();
  await expect(ready.getByText(office, { exact: true })).toBeVisible();

  // Everything met: Send is enabled and names the person; the summary says where it goes.
  await expect(send).toBeEnabled();
  await expect(why).toHaveText("");
  await expect(notary.getByText(/Notary goes to .+ \(Antipolo\), processed at .+\. Funds: Needs funds \(Notary fee\)\./)).toBeVisible();
  await shot(page, "send-ready");
  await noSideways(page);

  // Send → the next transaction that needs the LA opens, with a toast; Notary says who it went to.
  const name = (await send.textContent())!.replace(/^Send to /, "").trim();
  await send.click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Notary sent. Next: EDST" })).toBeVisible();
  await expect(page).toHaveURL(/tx=EDST/);
  const notaryEntry = page.locator("[data-txn=NOTARY]").filter({ visible: true }).first();
  // The list row has one status word; who it was sent to is in the detail (the job card below).
  await expect(notaryEntry).toContainText("Sent to DP");
  await notaryEntry.click();
  await expect(page).toHaveURL(/tx=NOTARY/);
  // The panel is replaced by the Processor job card.
  const job = page.getByRole("region", { name: "Notary: job" });
  await expect(job).toBeVisible();
  await expect(job.getByRole("heading", { name: `Sent to ${name}` })).toBeVisible();
  await expect(job.getByText(/Waiting for them to accept\./)).toBeVisible();
  await expect(notary.getByRole("heading", { name: "Send to a Document Processor" })).toHaveCount(0);
  await shot(page, "send-after");
  await noSideways(page);
  // The paper sent as Missing is listed on the loan file with its reason.
  await page.goto("/loans/GD1012026901001");
  await expect(page.locator("[data-missing-papers]")).toContainText(MISSING);
  await expect(page.locator("[data-missing-papers]")).toContainText("Borrower to submit later");
  clean();
});

test("Late: the late reason appears only when past the send date and is needed to send", async ({ page }) => {
  const notary = await openNotary(page);
  const why = notary.locator('[id^="send-why-"]');
  await expect(notary.getByLabel("Why is this late?")).toHaveCount(0);
  // Move the release date back so the send date has passed.
  await db.loan.update({ where: { pn: "GD1012026901001" }, data: { releasedAt: new Date(Date.now() - 20 * 86_400_000) } });
  await page.reload();
  for (const item of REQUIRED) await notary.getByLabel(item).check();
  await notary.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  await expect(notary.getByText(/This is past the send date/)).toBeVisible();
  await expect(why).toHaveText("Tell us why it is late");
  await expect(notary.getByRole("button", { name: /^Send to / })).toBeDisabled();
  await shot(page, "send-late");
  await notary.getByLabel("Why is this late?").fill("Borrower brought the papers late");
  await expect(notary.getByRole("button", { name: /^Send to / })).toBeEnabled();
  await noSideways(page);
});
