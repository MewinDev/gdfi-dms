import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice, signIn } from "./helpers";

/**
 * Print labels were removed (11 November 2026, confirmed by the users): labels are not used in the LA
 * and DP flow. This fails if a "Print labels" button, a labels warning, the "Labels are on all papers"
 * tick or a label permission tick comes back: Check papers (Send panel), the loan file (To do and
 * Documents), the DP job page and the role editor. Sending to DP and accepting need no label step.
 * Production build (npm run e2e:groups), one width at a time. Console clean (no React key warnings).
 * Screenshots: docs/screenshots/remove-labels/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/remove-labels";
mkdirSync(DIR, { recursive: true });
const PN = "GD1012026901001";
const REQUIRED = ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Deed of Sale", "Valid IDs of borrower (2)"];
/** Any word about labels on a screen (the paper's Document ID stays: it is not a label). */
const LABEL = /\blabels?\b/i;

test.beforeEach(async () => {
  await resetLoans();
});

async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
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
/** The main area says nothing about labels and has no print-label control. */
async function noLabels(page: Page) {
  const main = page.getByRole("main");
  await expect(main).not.toContainText(LABEL);
  await expect(main.getByRole("button", { name: LABEL })).toHaveCount(0);
  await expect(main.getByRole("link", { name: LABEL })).toHaveCount(0);
  await expect(main.getByRole("checkbox", { name: LABEL })).toHaveCount(0);
  await expect(page.locator("[data-print-all], [data-print-card], [data-print-paper]")).toHaveCount(0);
}

test("LA checks the papers and sends with no label step; the DP accepts with no label tick", async ({ page }) => {
  test.setTimeout(240_000);
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await noLabels(page);
  await page.getByRole("link", { name: "Start checking" }).click();

  // Check papers (Send panel): the papers, funds and the LTO office are all it asks for.
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  await expect(notary.getByRole("heading", { name: "Send to a Document Processor" })).toBeVisible();
  for (const item of REQUIRED) await notary.getByLabel(item).check();
  await notary.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  const send = notary.getByRole("button", { name: /^Send to / });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await noLabels(page);
  await noSideways(page);
  await shot(page, "check-papers");

  await send.click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  const txn = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "NOTARY" } } });
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status, { timeout: 20_000 }).toBe("ASSIGNED");

  // Loan file: To do and Documents say nothing about labels; the old label page is gone.
  await page.goto(`/loans/${PN}`);
  await noLabels(page);
  await page.goto(`/loans/${PN}?tab=documents`);
  await expect(page.locator("[data-documents-tab]")).toBeVisible();
  await noLabels(page);
  await noSideways(page);
  expect((await page.request.get(`/loans/${PN}/labels`)).status()).toBe(404);
  clean();

  // DP job page: the papers and Accept, no "Labels are on all papers" tick.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as Test Document Processor" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Test setup: the job goes to the test processor (the Send panel pre-selects the recommended one).
  const testDp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const job = await db.dpAssignment.update({ where: { id: (await db.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } })).id }, data: { dpUserId: testDp.id } });
  await page.goto(`/jobs/${job.id}`);
  const accept = page.getByRole("button", { name: "Accept", exact: true });
  await expect(accept).toBeEnabled();
  await noLabels(page);
  await noSideways(page);
  await shot(page, "dp-job");
  await accept.click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible();
  expect((await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
  await noLabels(page);
  clean();
});

test("Role editor: no label permission tick, even with the technical names", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "admin");
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  await page.goto(`/admin/settings?open=roles&edit=${la.id}`);
  await expect(page.locator("[data-group]").first()).toBeVisible();
  await page.locator("[data-tech-switch]").check();
  await expect(page.locator('[data-perm^="labels:"]')).toHaveCount(0);
  await expect(page.locator("[data-perm]").filter({ hasText: LABEL })).toHaveCount(0);
  await page.getByLabel("Find a permission").fill("label");
  await expect(page.locator("[data-group]")).toHaveCount(0);
  await page.locator("[data-tech-switch]").uncheck();
  clean();
});
