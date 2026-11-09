import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * MyLoans sync: the Settings card, Find loan suggestions, the review pop-up (material change and
 * cancellation), the Open items "MyLoans changes" group, replacement links and Copy reusable papers.
 * Mock MyLoans; changes are made the way the simulator makes them. Screenshots go to SHOTS_DIR.
 */
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin" } as const;
const PN = "GD1652026901003";

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
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
  await page.goto(`/loans?fill=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
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
  await setting("myloans.lastRun", null);
  await setting("myloans.state", { cursor: null, cap: null, runs: [] });
});
test.afterAll(async () => {
  await resetLoans();
  await setting("simulator.enabled", false);
});

test("Settings: the MyLoans sync card (health, run statistics, tiers, last runs, settings)", async ({ page }) => {
  // One loan file, due now.
  await signInAs(page, "la");
  await openPn(page);
  await db.loan.update({ where: { pn: PN }, data: { nextCheckAt: new Date(Date.now() - 60_000) } });
  await signInAs(page, "admin");
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: /^MyLoans sync/ })).toContainText("Mock · Healthy");
  await page.goto("/admin/settings?open=myloans-sync");
  const d = page.locator("dialog#settings-modal");
  await expect(d.locator("[data-sync-health]")).toHaveText("Healthy");
  await expect(d.locator("[data-sync-status]")).toContainText("Mock (sample loans)");
  await expect(d.locator("[data-sync-status]")).toContainText("Never");
  await expect(d.locator("[data-sync-tiers]")).toContainText("B: Not yet sent");
  await d.getByRole("button", { name: "Run now" }).click();
  await expect(d.getByText(/^Checked 1 loan: 0 with changes, 1 call to MyLoans\.$/)).toBeVisible();
  await expect(d.locator("[data-sync-status]")).toContainText("Run now, due loans");
  await expect(d.locator("[data-sync-status]")).toContainText("1 / 1");
  await expect(d.locator("[data-sync-runs]").getByRole("row")).toHaveCount(2);
  await expect(d.locator("[data-sync-runs]")).toContainText("Healthy");
  await d.getByLabel("Loans per run (at most)").fill("40");
  await d.getByLabel("Not yet sent: check every (minutes)").fill("180");
  await d.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await db.setting.findUnique({ where: { key: "myloans.maxPerRun" } }))?.value).toBe(40);
  expect((await db.setting.findUniqueOrThrow({ where: { key: "myloans.tierMinutes" } })).value).toEqual({ A: 60, B: 180, C: 1440 });
  await d.locator("[data-sync-runs]").scrollIntoViewIfNeeded();
  await shot(page, "myloans-sync-card");
  await noSideways(page);
  await setting("myloans.maxPerRun", 50);
  await setting("myloans.tierMinutes", { A: 60, B: 240, C: 1440 });
});

test("Find loan: live suggestions from 3 characters, at most 10, no match", async ({ page }) => {
  await signInAs(page, "la");
  await page.goto("/loans?find=1");
  const box = page.locator("#find-loan");
  await box.fill("PN");
  await expect(page.locator("[data-find-results]")).toHaveCount(0);
  await box.fill("GD16520269010");
  const list = page.getByRole("listbox", { name: "MyLoans matches" });
  await expect(list.getByRole("option").first()).toBeVisible();
  expect(await list.getByRole("option").count()).toBeLessThanOrEqual(10);
  await expect(list.getByRole("option", { name: /GD1652026901003/ })).toContainText("Ana Villanueva");
  await shot(page, "find-loan-search");
  await noSideways(page);
  await box.fill("zzzz-nobody");
  await expect(page.locator("[data-find-empty]")).toHaveText("No match in MyLoans.");
  await box.fill("GD1652026901003");
  await list.getByRole("option", { name: /GD1652026901003/ }).click();
  await expect(page).toHaveURL(/\/search\?q=GD1652026901003/);
});

test("Material change: LA sees it read-only (no amounts); Open items group; Admin reviews and applies", async ({ page }) => {
  await signInAs(page, "la");
  await openPn(page);
  await change(PN, { totalReleasedAmount: 1_020_000 });
  await page.goto(`/loans/${PN}?tab=todo`);
  await refresh(page);
  await expect(page.getByText("Changes found: review.")).toBeVisible();
  await page.reload();
  const entry = page.locator("[data-source-entry]");
  await expect(entry).toContainText("MyLoans changes · Needs review");
  await entry.getByRole("button", { name: "Review" }).click();
  const sheet = page.getByRole("dialog", { name: /^MyLoans changed this loan/ });
  await expect(sheet.locator("[data-amount-hidden]")).toHaveText("Amount changed");
  await expect(sheet.locator("[data-source-waiting]")).toHaveText("Waiting for Admin to review.");
  await sheet.getByRole("button", { name: "Close" }).last().click();
  // Check documents: the Open items card has the "MyLoans changes" group.
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const group = page.locator('[data-open-group="source"]').filter({ visible: true }).first();
  if (!(await group.isVisible())) await page.locator('[data-open-items="collapsible"] summary').click();
  await expect(page.locator('[data-open-group="source"]').filter({ visible: true }).first()).toContainText("MyLoans changes");
  await shot(page, "open-items-myloans");
  await noSideways(page);
  // Send is held only for the transactions the change reaches (Mortgage would be removed).
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator('[id^="send-why-"]')).toHaveText("MyLoans changed this loan. Admin is reviewing.");

  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo&review=1`);
  const review = page.getByRole("dialog", { name: /^MyLoans changed this loan/ });
  await expect(review.getByRole("row", { name: /Amount/ })).toContainText("₱1,000,000");
  await expect(review.getByRole("row", { name: /Amount/ })).toContainText("₱1,020,000");
  await expect(review.locator("[data-source-means]")).toContainText("Rule 4 no longer applies");
  await expect(review.locator("[data-source-means]")).toContainText("would be removed");
  await shot(page, "review-material");
  await noSideways(page);
  await review.getByLabel("Note (required)").fill("MyLoans corrected the amount");
  await review.getByRole("button", { name: "Apply changes" }).click();
  await expect.poll(async () => (await db.sourceChange.findFirstOrThrow()).state).toBe("APPLIED");
  await expect(page.locator("[data-source-entry]")).toHaveCount(0);
});

test("Cancellation: Admin closes the loan as cancelled", async ({ page }) => {
  await signInAs(page, "la");
  await openPn(page);
  await change(PN, { status: "CANCELLED" });
  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=todo`);
  await refresh(page);
  await expect(page.getByText("Changes found: review.")).toBeVisible();
  await page.goto(`/loans/${PN}?tab=todo&review=1`);
  const review = page.getByRole("dialog", { name: /^MyLoans changed this loan/ });
  await expect(review.locator("[data-source-means]")).toContainText("MyLoans now says the loan is cancelled.");
  await expect(review.locator("[data-source-affected]")).toContainText("Notary");
  await shot(page, "review-cancelled");
  await noSideways(page);
  await review.getByRole("button", { name: "Close as cancelled" }).click();
  await expect(review.locator("[data-source-error]")).toContainText("short note");
  await review.getByLabel("Note (required)").fill("MyLoans cancelled the loan");
  await review.getByRole("button", { name: "Close as cancelled" }).click();
  await expect(page.getByText(/Closed: Cancelled in MyLoans/)).toBeVisible();
  expect((await db.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("Cancelled in MyLoans");
});

test("Replacement PN: simulated, linked on both files, Copy reusable papers", async ({ page }) => {
  await setting("simulator.enabled", true);
  await signInAs(page, "la");
  await openPn(page);
  // Tick the Notary papers (the valid IDs belong to the borrower).
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const papers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await papers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => db.checklistCheck.count({ where: { checked: true, transaction: { loan: { pn: PN }, type: { code: "NOTARY" } } } })).toBeGreaterThan(3);

  await signInAs(page, "admin");
  await page.goto(`/loans/${PN}?tab=journey`);
  const sim = page.locator("[data-simulate-source]");
  await sim.getByLabel("Simulate a MyLoans change").selectOption("replace");
  await sim.getByRole("button", { name: "Simulate" }).click();
  await expect(sim.getByText(/Simulated: MyLoans now has GD\d{13} replacing GD1652026901003/)).toBeVisible();
  const extra = (await db.setting.findUniqueOrThrow({ where: { key: "myloans.mockExtra" } })).value as { pn: string }[];
  const newPn = extra[0].pn;

  await signInAs(page, "la");
  await page.goto(`/search?q=${newPn}`);
  await expect(page.locator("[data-preview-warnings] [data-other-loans]")).toContainText(`This borrower has another loan: ${PN}`);
  await expect(page.locator("[data-preview-warnings]")).toContainText(`replaces ${PN}`);
  await shot(page, "find-loan-replacement-preview");
  await openPn(page, newPn);
  await expect(page.locator("[data-replaces]")).toHaveText(`Replaces ${PN}`);
  await expect(page.locator("[data-related-loans]")).toContainText(PN);
  await shot(page, "replacement-new-file");
  await noSideways(page);
  await page.locator("[data-replaces]").click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await expect(page.locator("[data-replaced-by]")).toHaveText(`Replaced by ${newPn}`);
  await shot(page, "replacement-old-file");
  await noSideways(page);

  await signInAs(page, "admin");
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
