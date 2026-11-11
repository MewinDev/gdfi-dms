import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice } from "./helpers";

/**
 * The DP's "Review the papers" with missing papers in the same list (no card on top), on the production
 * build (npm run e2e:groups), one width at a time: a missing row has the amber icon instead of a tick box,
 * the Missing chip, the reason and remarks, who and when; Accept works with it; it is never offered as a
 * paper to return; a paper received late comes back as a normal row. Screenshots go to
 * docs/screenshots/dp-review-missing/. No sideways scroll; the console stays clean (no React key warnings).
 */
const DIR = "docs/screenshots/dp-review-missing";
mkdirSync(DIR, { recursive: true });
const PN = "GD1012026901001";
const BUTTONS = { la: "Continue as Loan Associate", dp: "Continue as Test Document Processor" } as const;
const IDS = "Valid IDs of borrower (2)";
const DISCLOSURE = "Disclosure Statement";
const PRESENT = ["Promissory Note", "Chattel Mortgage (for notarization)", "Deed of Sale"];

test.beforeEach(async () => {
  await resetLoans();
});

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string, target?: Locator) {
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || /Warning:|unique "key"/.test(t)) bad.push(t);
  });
  page.on("pageerror", (e) => bad.push(e.message));
  return () => expect(bad.filter((t) => !/favicon|Failed to load resource/.test(t))).toEqual([]);
}

/** The LA marks `missing` Missing with a reason and remarks, ticks the rest and sends Notary. Returns the DP job id (given to the test processor). */
/** tickFirst: the LA ticks the paper Present first (it gets its Document ID), then marks it Missing (the kit case). */
async function sendWithMissing(page: Page, missing: { label: string; reason: string; remarks: string; tickFirst?: boolean }[]) {
  await signInAs(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  await expect(notary.getByRole("heading", { name: "Send to a Document Processor" })).toBeVisible();
  const names = new Set(missing.map((m) => m.label));
  for (const item of [...PRESENT, DISCLOSURE]) if (!names.has(item)) await notary.getByLabel(item).check();
  for (const m of missing) {
    const row = notary.locator("[data-paper-row]", { has: page.getByText(m.label, { exact: true }) });
    if (m.tickFirst) {
      await notary.getByLabel(m.label).check();
      await expect.poll(async () => (await db.documentItem.findFirst({ where: { label: m.label, transaction: { loan: { pn: PN }, type: { code: "NOTARY" } } } }))?.documentId ?? null, { timeout: 15_000 }).not.toBeNull();
      await notary.getByLabel(m.label).uncheck();
    }
    await row.getByRole("button", { name: "Missing", exact: true }).click();
    const form = row.locator("[data-remarks-form]");
    await form.locator("[data-reason-chips] label", { hasText: m.reason }).click();
    await form.getByLabel("Remarks", { exact: true }).fill(m.remarks);
    await form.getByRole("button", { name: "Save remarks" }).click();
    await expect(row).toHaveAttribute("data-state", "missing", { timeout: 15_000 });
  }
  await notary.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  const send = notary.getByRole("button", { name: /^Send to / });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  const txn = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "NOTARY" } } });
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status, { timeout: 20_000 }).toBe("ASSIGNED");
  // Test setup: the job goes to the test processor (the Send panel pre-selects the recommended one).
  const testDp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
  await db.dpAssignment.update({ where: { id: job.id }, data: { dpUserId: testDp.id } });
  return job.id;
}

const review = (page: Page) => page.getByRole("region", { name: "Review the papers" });
const missingRow = (page: Page, label: string) => review(page).locator('[data-missing-paper="MISSING"]', { hasText: label });

async function expectMissingRow(page: Page, label: string, reason: string, remarks: string) {
  const row = missingRow(page, label);
  await expect(row).toBeVisible();
  await expect(row.locator("[data-missing-chip]")).toHaveText("Missing");
  await expect(row.getByRole("img", { name: "Missing, with remarks" })).toBeVisible();
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  await expect(row.locator("[data-missing-reason] strong")).toHaveText(reason);
  await expect(row.locator("[data-missing-reason]")).toContainText(`· ${remarks}`);
  await expect(row.locator("[data-missing-by]")).toContainText("Test Loan Associate");
  await expect(row.locator("[data-missing-by]")).toContainText("PHT");
  // At 820 and 390 the reason line wraps and the Document ID sits under it, nothing sideways.
  const box = await row.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(width(page));
}

test("one missing paper: in the list with no tick box, Accept works, the return never offers it", async ({ page }) => {
  const jobId = await sendWithMissing(page, [{ label: IDS, reason: "Lost or unavailable", remarks: "Missing valid Id of the borrower" }]);
  await signInAs(page, "dp");
  const clean = watchConsole(page);
  await page.goto(`/jobs/${jobId}`);
  await expect(review(page)).toBeVisible();
  // The old card on top is gone; the paper is in the list instead.
  await expect(page.locator("[data-missing-papers-card]")).toHaveCount(0);
  await expect(page.getByText("Missing papers and reasons")).toHaveCount(0);
  // "Sent to <processor>" is not repeated on the processor's own page.
  await expect(page.getByRole("main").getByText(/^Sent to /)).toHaveCount(0);
  await expectMissingRow(page, IDS, "Lost or unavailable", "Missing valid Id of the borrower");
  await expect(review(page).locator("[data-paper-count]")).toHaveText(/^\d+ of \d+ papers · 1 missing with remarks$/);
  await expect(review(page).getByText("Untick a paper you did not receive.")).toBeVisible();
  await expect(review(page).locator("[data-missing-note]")).toHaveText("Papers marked Missing by the Loan Associate go through as exceptions. They are not a reason to return the file.");
  // Checklist order: Disclosure Statement comes before the IDs, the IDs after the Deed of Sale.
  const order = await review(page).locator("[data-received-papers] > label, [data-received-papers] > [data-missing-paper]").allInnerTexts();
  expect(order.findIndex((t) => t.includes(IDS))).toBeGreaterThan(order.findIndex((t) => t.includes("Promissory Note")));
  await shot(page, "one-missing", review(page));
  await noSideways(page);

  // A paper ticked Present can still be unticked: "Some papers are missing" names only present papers.
  await review(page).getByRole("checkbox", { name: "Promissory Note: received" }).uncheck();
  await expect(review(page).locator("[data-some-missing]")).toContainText("1 paper not received.");
  await review(page).getByRole("button", { name: "Some papers are missing" }).click();
  const sheet = page.getByRole("dialog", { name: "Some papers are missing" });
  await expect(sheet.getByText("Promissory Note", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText(IDS, { exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await review(page).getByRole("checkbox", { name: "Promissory Note: received" }).check();

  // Accept: the missing paper does not block it and is not "not received".
  await expect(review(page).locator("[data-some-missing]")).toHaveCount(0);
  await review(page).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible({ timeout: 15_000 });
  expect((await db.dpAssignment.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ACCEPTED");
  await page.getByRole("button", { name: "Return to LA: papers needed" }).click();
  const dialog = page.getByRole("dialog", { name: "Return to LA: papers needed" });
  await expect(dialog.getByText("Promissory Note", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(IDS, { exact: true })).toHaveCount(0);
  await noSideways(page);
  clean();
});

test("two missing papers; one received late comes back as a normal row", async ({ page }) => {
  const jobId = await sendWithMissing(page, [
    { label: DISCLOSURE, reason: "Borrower to submit later", remarks: "The borrower signs it on Monday." },
    { label: IDS, reason: "Lost or unavailable", remarks: "Missing valid Id of the borrower" },
  ]);
  await signInAs(page, "dp");
  const clean = watchConsole(page);
  await page.goto(`/jobs/${jobId}`);
  await expectMissingRow(page, DISCLOSURE, "Borrower to submit later", "The borrower signs it on Monday.");
  await expectMissingRow(page, IDS, "Lost or unavailable", "Missing valid Id of the borrower");
  await expect(review(page).locator("[data-paper-count]")).toHaveText(/ · 2 missing with remarks$/);
  await expect(review(page).locator("[data-missing-note]")).toHaveCount(1);
  await shot(page, "two-missing", review(page));
  await noSideways(page);
  clean();

  // The LA marks the Disclosure Statement Received (it arrived): a normal present row for the DP.
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const row = page.locator("[data-paper-row]", { has: page.getByText(DISCLOSURE, { exact: true }) }).filter({ visible: true }).first();
  await row.locator("[data-receive]").click();
  await row.getByRole("button", { name: "Mark Received" }).click();
  await expect(row).toHaveAttribute("data-state", "received-late", { timeout: 15_000 });

  await signInAs(page, "dp");
  await page.goto(`/jobs/${jobId}`);
  await expect(missingRow(page, DISCLOSURE)).toHaveCount(0);
  await expect(review(page).getByRole("checkbox", { name: `${DISCLOSURE}: received` })).toBeChecked();
  await expect(review(page).locator("[data-paper-count]")).toHaveText(/ · 1 missing with remarks$/);
  await expectMissingRow(page, IDS, "Lost or unavailable", "Missing valid Id of the borrower");
});

test("a paper ticked first (it has a Document ID) then marked Missing shows as Missing, not ticked", async ({ page }) => {
  const jobId = await sendWithMissing(page, [{ label: IDS, reason: "Lost or unavailable", remarks: "Missing valid Id of the borrower", tickFirst: true }]);
  const doc = await db.documentItem.findFirstOrThrow({ where: { label: IDS, transaction: { loan: { pn: PN }, type: { code: "NOTARY" } } } });
  expect(doc.documentId).toMatch(/-ID-01$/);
  await signInAs(page, "dp");
  const clean = watchConsole(page);
  await page.goto(`/jobs/${jobId}`);
  await expectMissingRow(page, IDS, "Lost or unavailable", "Missing valid Id of the borrower");
  // The Document ID from the earlier tick is shown on the row, but it is not a tick: no "received" box for it.
  await expect(missingRow(page, IDS)).toContainText(doc.documentId!);
  await expect(review(page).getByRole("checkbox", { name: `${IDS}: received` })).toHaveCount(0);
  await expect(review(page).locator("[data-paper-count]")).toHaveText("4 of 5 papers · 1 missing with remarks");
  await shot(page, "with-document-id", review(page));
  await noSideways(page);
  // Accept: no custody for the missing paper.
  await review(page).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work on it" })).toBeVisible({ timeout: 15_000 });
  expect(await db.documentMovement.count({ where: { documentItemId: doc.id, action: "ACKNOWLEDGED_BY_DP" } })).toBe(0);
  expect((await db.documentItem.findUniqueOrThrow({ where: { id: doc.id } })).stage).toBe("EXPECTED");
  clean();

  // The loan file: header, progress and the Notary card count received papers only.
  await signInAs(page, "la");
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const summary = page.locator("[data-package-summary]").filter({ visible: true }).first();
  await expect(summary).toContainText(/\d+ of \d+ received · 1 missing with remarks/);
  await shot(page, "loan-file-counts");
  await noSideways(page);
});
