import { expect, test, type Page } from "@playwright/test";
import { signInWith, docShot } from "./helpers";
import { db, resetLoans } from "./db";

/**
 * MyLoans sync: the Settings card, Find loan suggestions, Open Items (piece 8: an amount change and a cancellation),
 * the loan file's banner and "myloans changes" group, replacement links and Copy reusable papers.
 * Mock MyLoans; changes are made the way the simulator makes them. Screenshots go to SHOTS_DIR.
 */
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin" } as const;
const PN = "GD1652026901003";

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await docShot(page, { path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const setting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
async function change(pn: string, over: Record<string, unknown>) {
  const row = await db.setting.findUnique({ where: { key: "myloans.mockOverrides" } });
  const all = { ...((row?.value as Record<string, Record<string, unknown>>) ?? {}) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setting("myloans.mockOverrides", all);
}
async function openPn(page: Page, pn = PN) {
  await page.goto(`/loans?q=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
async function refresh(page: Page) {
  await page.locator("[data-source-strip]").getByRole("button", { name: "Refresh from MyLoans" }).click();
}

test.beforeEach(async () => {
  await resetLoans();
  await setting("myloans.refreshOnOpenMinutes", 15);
});
test.afterAll(async () => {
  await resetLoans();
  await setting("simulator.enabled", false);
});

test("Settings: the MyLoans sync card (piece 7): Run now raises a review item and applies nothing; the run log; settings", async ({ page }) => {
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await signInWith(page, BUTTONS.admin);
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: /^MyLoans sync/ })).toContainText("Mock · Not run yet");
  await page.goto("/admin/settings?open=myloans-sync");
  const d = page.locator("dialog#settings-modal");
  await expect(d.locator("[data-sync-health]")).toHaveText("Not run yet");
  await expect(d.locator("[data-sync-status]")).toContainText("Mock (sample loans)");
  await expect(d.locator("[data-sync-status]")).toContainText("Not started (the first run reads the last 26 hours)");
  await d.getByRole("button", { name: "Run now" }).click();
  await expect(d.getByText(/read from myloans: 1 loan with Open Items, \d+ released not yet in the DMS\.$/)).toBeVisible();
  await expect(d.locator("[data-sync-health]")).toHaveText("Healthy");
  await expect(d.locator("[data-sync-status]")).toContainText("Run now, changes): done");
  await expect(d.locator("[data-sync-runs]").getByRole("row")).toHaveCount(2);
  await expect(d.locator("[data-sync-runs]")).toContainText("Done");
  // Strict v2: the change waits for an approver; the loan keeps its amount.
  expect(await db.openItem.count({ where: { loan: { pn: PN }, status: "PENDING" } })).toBe(1);
  expect(Number((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).totalReleasedAmount)).toBe(1_000_000);
  await d.getByLabel("Run the sync every (minutes)").fill("45");
  await d.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => ((await db.setting.findUnique({ where: { key: "myloans.sync" } }))?.value as { intervalMinutes?: number } | undefined)?.intervalMinutes).toBe(45);
  await page.goto("/admin/settings?open=myloans-sync");
  await d.locator("[data-sync-runs]").scrollIntoViewIfNeeded();
  await shot(page, "myloans-sync-card");
  await noSideways(page);
  await db.setting.deleteMany({ where: { key: "myloans.sync" } });
});

test("Amount change (piece 8): the LA sees the banner and the Open items row; Send held where it reaches; the approver approves it on Open Items", async ({ page }) => {
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await page.goto(`/loans/${PN}?tab=todo`);
  await refresh(page);
  await expect(page.getByText("Changes found: an Open Item waits for an approver.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-open-items-banner]")).toContainText("1 Open Item from myloans: Amount.");
  // Check documents: the Open items card has the "myloans changes" group, linking to the Open Items page.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const group = page.locator('[data-open-group="source"]').filter({ visible: true }).first();
  if (!(await group.isVisible())) await page.locator('[data-open-items="collapsible"] summary').click();
  await expect(page.locator('[data-open-group="source"]').filter({ visible: true }).first()).toContainText("myloans changes");
  await shot(page, "open-items-myloans");
  await noSideways(page);
  // Send is held only for the transactions the change reaches (Mortgage would be removed).
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator('[id^="send-why-"]')).toHaveText("myloans changed this loan. An approver decides the Open Item first.");

  await signInWith(page, BUTTONS.admin);
  await page.goto("/dashboard");
  // D-053: Open Items in the menu, with the pending count, for the approvers (D-058: the sidebar at every
  // width; the link's name carries the count, the badge shows it).
  const menu = page.locator('#main-sidebar nav[aria-label="Main"] a[href="/open-items"]');
  await expect(menu).toHaveAttribute("aria-label", "Open Items, 1"); // (on a phone the sidebar is closed, so no computed name)
  await expect(menu.locator("[data-nav-badge]")).toHaveText("1");
  await page.goto(`/open-items?pn=${PN}`);
  const card = page.locator(`[data-oi-card="rules"][data-pn="${PN}"]`);
  await expect(card.locator('[data-oi-item="amount"]')).toContainText("₱1,000,000.00");
  await expect(card.locator('[data-oi-item="amount"]')).toContainText("₱1,020,000.00");
  await expect(card.locator("[data-oi-effect]")).toContainText("Mortgage is not needed: this is a Renewal loan above ₱1,000,000.");
  await expect(card.locator("[data-oi-effect]")).toContainText("would be removed");
  await expect(card.locator("[data-oi-waiting]")).toHaveText("Waiting 0 working days");
  await shot(page, "open-items-page");
  await noSideways(page);
  await card.getByLabel("Remarks (required)").fill("MyLoans corrected the amount");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.openItem.findFirstOrThrow({ where: { loan: { pn: PN } } })).status).toBe("APPROVED");
  await page.goto(`/loans/${PN}?tab=todo`);
  await expect(page.locator("[data-open-items-banner]")).toHaveCount(0);
});

test("Cancelled in myloans: the loan file says why Send, Forward and cash wait; the approver closes it on Open Items", async ({ page }) => {
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  await change(PN, { status: "CANCELLED" });
  await signInWith(page, BUTTONS.admin);
  await page.goto(`/loans/${PN}?tab=todo`);
  await refresh(page);
  await expect(page.getByText("Changes found: an Open Item waits for an approver.")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-loan-ended]")).toContainText("myloans says this loan is no longer released (cancelled in myloans). Send, Forward and new cash wait");
  await page.goto(`/open-items?pn=${PN}`);
  const card = page.locator(`[data-oi-card="status"][data-pn="${PN}"]`);
  await expect(card.locator('[data-oi-item="status"]')).toContainText("Cancelled in myloans");
  await expect(card.locator("[data-oi-blocked]")).toContainText("Send, Forward and new cash wait");
  await shot(page, "open-items-cancelled");
  await noSideways(page);
  await card.getByLabel("Remarks (required)").fill("MyLoans cancelled the loan");
  await card.getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("Cancelled in MyLoans");
  await page.goto(`/loans/${PN}`);
  await expect(page.getByText(/Closed: Cancelled in MyLoans/)).toBeVisible();
});

test("Replacement PN: simulated, linked on both files, Copy reusable papers", async ({ page }) => {
  await setting("simulator.enabled", true);
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  // Tick the Notary papers (the valid IDs belong to the borrower).
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const papers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await papers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => db.checklistCheck.count({ where: { checked: true, transaction: { loan: { pn: PN }, type: { code: "NOTARY" } } } })).toBeGreaterThan(3);

  await signInWith(page, BUTTONS.admin);
  await page.goto(`/loans/${PN}?tab=journey`);
  const sim = page.locator("[data-simulate-source]");
  await sim.getByLabel("Simulate a MyLoans change").selectOption("replace");
  await sim.getByRole("button", { name: "Simulate" }).click();
  await expect(sim.getByText(/Simulated: MyLoans now has GD\d{13} replacing GD1652026901003/)).toBeVisible();
  const extra = (await db.setting.findUniqueOrThrow({ where: { key: "myloans.mockExtra" } })).value as { pn: string }[];
  const newPn = extra[0].pn;

  await signInWith(page, BUTTONS.la);
  await page.goto(`/search?q=${newPn}`);
  // D-051: no "other loans of this borrower" warning; only the redo myloans names.
  await expect(page.locator("[data-other-loans]")).toHaveCount(0);
  await expect(page.locator("[data-preview-warnings]")).toContainText(`replaces ${PN}`);
  await shot(page, "find-loan-replacement-preview");
  await openPn(page, newPn);
  // Nothing is linked until a person links it from Related loans (with a note).
  await expect(page.locator("[data-replaces]")).toHaveCount(0);
  await signInWith(page, BUTTONS.admin);
  await page.goto(`/loans/${PN}?tab=todo`);
  await expect(page.locator("[data-loan-ended]")).toContainText(`replaced by ${newPn}`);
  const row = page.locator("[data-related-loans]").filter({ visible: true }).first().locator('[data-related-row="SAME_BORROWER"]');
  await row.getByRole("button", { name: "Link as replacement" }).click();
  const linkSheet = page.locator("[data-link-sheet]");
  await linkSheet.getByRole("checkbox").check();
  await linkSheet.getByLabel("Note (required)").fill("Same unit, new PN from MyLoans");
  await linkSheet.getByRole("button", { name: "Link as replacement" }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: newPn } })).replacesPn).toBe(PN);
  await signInWith(page, BUTTONS.la);
  await page.goto(`/loans/${newPn}`);
  await expect(page.locator("[data-replaces]")).toHaveText(`Replaces ${PN}`);
  await expect(page.locator("[data-related-loans]")).toContainText(PN);
  await shot(page, "replacement-new-file");
  await noSideways(page);
  await page.locator("[data-replaces]").click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await expect(page.locator("[data-replaced-by]")).toHaveText(`Replaced by ${newPn}`);
  await shot(page, "replacement-old-file");
  await noSideways(page);

  await signInWith(page, BUTTONS.admin);
  await page.goto(`/loans/${newPn}?tab=todo`);
  const card = page.locator("[data-copy-papers]");
  await expect(card).toContainText(`Copy reusable papers from ${PN}`);
  await card.getByRole("button", { name: "Copy reusable papers" }).click();
  const sheet = page.getByRole("dialog", { name: `Copy reusable papers from ${PN}` });
  const first = sheet.getByRole("checkbox").first();
  await first.check();
  await shot(page, "copy-reusable-papers");
  await noSideways(page);
  await sheet.getByRole("button", { name: /^Copy 1 paper$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Copy" }).click();
  await expect.poll(async () => db.documentMovement.count({ where: { action: "REASSIGNED" } })).toBe(2);
});

test("Released, not yet in the DMS (10b): the LA's branch pool shows it with the release date; waiting counts from when it entered the pool", async ({ page }) => {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const pn = "GD1652026980001";
  await db.sourceLoanCandidate.create({ data: { externalLoanId: 980_001, cin: "CIN-FAKE-980001", pn, borrowerName: "Pool Borrower", branchCode: "165", branchName: "Angono", amount: "350000.00", releaseDate: new Date(Date.now() - 20 * 86_400_000) } });
  await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: branch.id, pn, label: `${pn}: Pool Borrower`, state: "POOL", measure: "WAITING" } });
  await signInWith(page, BUTTONS.la);
  await page.goto("/inbox?tab=pool");
  const row = page.locator("main").getByText(pn).first();
  await expect(row).toBeVisible();
  await expect(page.locator("[data-candidate]").first()).toContainText("released");
  await expect(page.locator("[data-pool-tone]").first()).toHaveAttribute("data-pool-tone", "green");
  await shot(page, "branch-pool-candidate");
  await noSideways(page);
});
