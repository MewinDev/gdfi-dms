import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice } from "./helpers";

/**
 * Missing papers with reasons, on the production build (npm run e2e:groups), one width at a time:
 * the LA marks a paper Missing, Send is blocked naming it, the LA writes the reason and remarks and
 * sends; the DP sees it in "Review the papers" (no card) and cannot return the file for it; a file through
 * the vault gate shows "Complete with exceptions"; Monitoring has "Has missing papers". Screenshots go
 * to docs/screenshots/missing-papers/. The console must stay clean (no React key warnings).
 */
const DIR = "docs/screenshots/missing-papers";
mkdirSync(DIR, { recursive: true });
const PN = "GD1012026901001";
const BUTTONS = { la: "Continue as Loan Associate", dp: "Continue as Test Document Processor", monitor: "Continue as Test Operations Monitor" } as const;
const REQUIRED = ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Deed of Sale"];
const MISSING = "Valid IDs of borrower (2)";

test.beforeEach(async () => {
  await resetLoans();
});

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
/** Console errors and React warnings (a missing key, for example) fail the test. */
function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || /Warning:|unique "key"/.test(t)) bad.push(t);
  });
  page.on("pageerror", (e) => bad.push(e.message));
  return () => expect(bad.filter((t) => !/favicon|Failed to load resource/.test(t))).toEqual([]);
}

async function openNotary(page: Page) {
  await signInAs(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  await expect(notary.getByRole("heading", { name: "Send to a Document Processor" })).toBeVisible();
  return notary;
}

test("LA marks a paper Missing: Send blocked naming it, remarks saved, sent; DP sees it in the list and cannot return for it", async ({ page }) => {
  const clean = watchConsole(page);
  const notary = await openNotary(page);
  for (const item of REQUIRED) await notary.getByLabel(item).check();

  // Missing: the small box opens right under the row, red until the remarks are saved.
  const row = notary.locator("[data-paper-row]", { has: page.getByText(MISSING, { exact: true }) });
  await row.getByRole("button", { name: "Missing", exact: true }).click();
  await expect(row).toHaveAttribute("data-state", "missing-no-remarks");
  await expect(row.locator("[data-missing-tag]")).toHaveText("Missing, remarks needed");
  const why = notary.locator('[id^="send-why-"]');
  await expect(why).toHaveText(`Add remarks for: ${MISSING}`);
  await expect(notary.getByRole("button", { name: /^Send to / })).toBeDisabled();
  // An optional paper not included stays quiet.
  await expect(notary.locator("[data-paper-row]", { has: page.getByText("Valid ID of co-maker", { exact: true }) })).toHaveAttribute("data-state", "left-out");
  await shot(page, "la-missing-remarks-needed");
  await noSideways(page);

  // Compact: the reasons are one-tap chips (focus goes to them), the remarks one line with Save beside it.
  // Save stays off until a reason and 5 characters; the hint says how many are left; then amber.
  const form = row.locator("[data-remarks-form]");
  await expect(form.getByRole("radio").first()).toBeFocused();
  await expect(form.getByRole("radio")).toHaveCount(5);
  await expect(form.getByRole("button", { name: "Save remarks" })).toBeDisabled();
  await form.locator("[data-reason-chips] label", { hasText: "Borrower to submit later" }).click();
  await expect(form.getByRole("radio", { name: "Borrower to submit later" })).toBeChecked();
  await form.getByLabel("Remarks", { exact: true }).fill("abcd");
  await expect(form.locator("[data-remarks-help]")).toHaveText("1 more character.");
  await expect(form.getByRole("button", { name: "Save remarks" })).toBeDisabled();
  await noSideways(page);
  await form.getByLabel("Remarks", { exact: true }).fill("The borrower brings the second ID on Monday.");
  await form.getByRole("button", { name: "Save remarks" }).click();
  await expect(row).toHaveAttribute("data-state", "missing", { timeout: 15_000 });
  await expect(row.locator("[data-missing-tag]")).toHaveText("Missing, with remarks");
  await expect(row.locator("[data-missing-summary]")).toContainText("Borrower to submit later");

  // Send: funds, LTO office, then it goes.
  await notary.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  const send = notary.getByRole("button", { name: /^Send to / });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await shot(page, "la-missing-with-remarks");
  await noSideways(page);
  await send.click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  const txn =await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "NOTARY" } } });
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status, { timeout: 20_000 }).toBe("ASSIGNED");

  // Loan file: the short Missing papers row near the top.
  await page.goto(`/loans/${PN}`);
  await expect(page.locator("[data-missing-papers]")).toContainText(MISSING);
  await noSideways(page);
  clean();

  // DP: the paper in Review the papers (no card on top), then accept; the return offers every paper but the missing one.
  await signInAs(page, "dp");
  // Test setup: the job goes to the test processor (the Send panel pre-selects the recommended one).
  const testDp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const job = await db.dpAssignment.update({ where: { id: (await db.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } })).id }, data: { dpUserId: testDp.id } });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.locator("[data-missing-papers-card]")).toHaveCount(0);
  const missingRow = page.getByRole("region", { name: "Review the papers" }).locator('[data-missing-paper="MISSING"]');
  await expect(missingRow).toContainText(MISSING);
  await expect(missingRow.locator("[data-missing-chip]")).toHaveText("Missing");
  await expect(missingRow).toContainText("Borrower to submit later");
  await expect(missingRow).toContainText("The borrower brings the second ID on Monday.");
  await expect(missingRow).toContainText("Test Loan Associate");
  await expect(missingRow.getByRole("checkbox")).toHaveCount(0);
  await shot(page, "dp-missing-papers-in-review");
  await noSideways(page);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible();
  await page.getByRole("button", { name: "Return to LA: papers needed" }).click();
  const dialog = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await expect(dialog.getByText("Promissory Note", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(MISSING, { exact: true })).toHaveCount(0);
  await shot(page, "dp-return-without-missing-paper");
  await noSideways(page);
});

test("vault gate with exceptions on the loan file, and Monitoring, Has missing papers", async ({ page }) => {
  const clean = watchConsole(page);
  const notary = await openNotary(page);
  for (const item of REQUIRED) await notary.getByLabel(item).check();
  const row = notary.locator("[data-paper-row]", { has: page.getByText(MISSING, { exact: true }) });
  await row.getByRole("button", { name: "Missing", exact: true }).click();
  const form = row.locator("[data-remarks-form]");
  await form.locator("[data-reason-chips] label", { hasText: "Not yet issued by the agency" }).click();
  await form.getByLabel("Remarks", { exact: true }).fill("Waiting for the agency to issue it.");
  // Enter saves (Shift+Enter would be a new line).
  await form.getByLabel("Remarks", { exact: true }).press("Enter");
  await expect(row).toHaveAttribute("data-state", "missing", { timeout: 15_000 });

  // Test setup: every transaction done, so the file is at the vault gate (the gate itself is tested
  // end to end in tests/integration/missing-papers.test.ts).
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: PN } });
  await db.loanTransaction.updateMany({ where: { loanId: loan.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await db.loan.update({ where: { id: loan.id }, data: { stage: "For Vault Transmittal" } });
  await page.goto(`/loans/${PN}`);
  const strip = page.locator("[data-missing-papers]");
  await expect(strip.locator("[data-complete-with-exceptions]")).toHaveText("Complete with exceptions");
  await expect(strip).toContainText(MISSING);
  await shot(page, "loan-file-complete-with-exceptions");
  await noSideways(page);
  clean();

  await signInAs(page, "monitor");
  await page.goto("/monitoring");
  const filter = page.locator("[data-missing-filter]");
  await expect(filter.locator("[data-missing-count]")).toHaveText("1");
  await filter.click();
  await expect(page).toHaveURL(/missing=1/);
  const list = page.locator("[data-missing-list]");
  await expect(list.locator(`[data-missing-loan="${PN}"]`)).toContainText(MISSING);
  await expect(list).toContainText("Not yet issued by the agency");
  await expect(list).toContainText(/since today|day/);
  await shot(page, "monitoring-has-missing-papers");
  await noSideways(page);
});
