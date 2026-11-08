import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * Replacement vs additional unit: the Related loans panel, the review pop-up for a replacement with
 * the no-payment confirmation, and Copy reusable papers for an additional unit. Mock MyLoans.
 */
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin" } as const;
const OLD = "PN-0001003";

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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
/** The same borrower in MyLoans under a new PN (the mock source). */
async function newPn(pn: string, over: Record<string, unknown> = {}) {
  const row = await db.setting.findUnique({ where: { key: "myloans.mockExtra" } });
  const list = ((row?.value as unknown[]) ?? []).slice();
  list.push({
    pn, cin: "CIN-771003", cif: "CIF-551003", sourceLoanId: `ML-${pn}`, borrowerName: "Ana Villanueva", branchName: "Cebu", branchCode: "CEB", status: "RELEASED",
    loanType: "Renewal", productName: "Auto Financing", totalReleasedAmount: 1_000_000, releaseDate: today(),
    vehicle: { plateNo: "NAB 1003", engineNo: "ENG-90003", chassisNo: "CHS-70003", make: "Toyota Vios" }, ...over,
  });
  await setting("myloans.mockExtra", list);
}
async function change(pn: string, over: Record<string, unknown>) {
  const row = await db.setting.findUnique({ where: { key: "myloans.mockOverrides" } });
  const all = { ...((row?.value as Record<string, Record<string, unknown>>) ?? {}) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setting("myloans.mockOverrides", all);
}
async function openPn(page: Page, pn: string) {
  await page.goto(`/loans?fill=${pn}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
}
async function tickAll(page: Page, code: string) {
  await page.goto(`/loans/${OLD}?tab=todo&tx=${code}`);
  const papers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await papers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => db.checklistCheck.count({ where: { checked: false, required: true, transaction: { loan: { pn: OLD }, type: { code } } } })).toBe(0);
}
const related = (page: Page) => page.locator("[data-related-loans]").filter({ visible: true }).first();

test.beforeEach(async () => {
  await resetLoans();
  await setting("myloans.refreshOnOpenMinutes", 15);
});
test.afterAll(resetLoans);

test("Additional unit: Related loans says Additional; Copy reusable papers copies only copies, never Originals", async ({ page }) => {
  await signInAs(page, "la");
  await openPn(page, OLD);
  await tickAll(page, "NOTARY");
  await tickAll(page, "MORTGAGE");
  await newPn("PN-0009301", { totalReleasedAmount: 900_000, vehicle: { plateNo: "NEW 9301", engineNo: "E9301", chassisNo: "C9301", make: "Toyota Wigo" } });
  await page.goto("/search?q=PN-0009301");
  await expect(page.locator("[data-other-loans]")).toContainText(`This borrower has another loan: ${OLD}`);
  await openPn(page, "PN-0009301");
  await page.goto("/loans/PN-0009301?tab=todo");
  await expect(related(page)).toContainText("Related loans (1)");
  await expect(related(page).locator('[data-related-row="ADDITIONAL"]')).toContainText(OLD);
  await expect(related(page)).not.toContainText("₱"); // no amounts without journey:view_amounts
  await related(page).scrollIntoViewIfNeeded();
  await shot(page, "related-additional");
  await noSideways(page);

  await signInAs(page, "admin");
  await page.goto("/loans/PN-0009301?tab=todo");
  await expect(related(page)).toContainText("₱1,000,000");
  const card = page.locator('[data-copy-papers="additional"]');
  await expect(card).toContainText(`Copy reusable papers from ${OLD}`);
  await card.getByRole("button", { name: "Copy reusable papers" }).click();
  const sheet = page.getByRole("dialog", { name: `Copy reusable papers from ${OLD}` });
  const original = sheet.locator('[data-copy-option="original"]').first();
  await expect(original).toContainText(`Original is filed under ${OLD}. Tick it here only if you hold another original or a certified copy.`);
  await expect(original.getByRole("checkbox")).toBeDisabled();
  await sheet.locator('[data-copy-option="copy"]').first().getByRole("checkbox").check();
  await shot(page, "copy-papers-additional");
  await noSideways(page);
  await sheet.getByRole("button", { name: /^Copy 1 paper$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Copy" }).click();
  await expect.poll(async () => db.documentMovement.count({ where: { action: "REFERENCED", remarks: { startsWith: `Referenced from ${OLD}` } } })).toBe(1);
});

test("Replacement: the review pop-up asks to confirm no payment; linked, both files say so", async ({ page }) => {
  await signInAs(page, "la");
  await openPn(page, OLD);
  await newPn("PN-0009302");
  await openPn(page, "PN-0009302");
  await page.goto("/loans/PN-0009302?tab=todo");
  await expect(related(page).locator('[data-related-row="ADDITIONAL"]')).toContainText(OLD); // still active: not a replacement yet
  await change(OLD, { status: "CANCELLED" });

  await signInAs(page, "admin");
  await page.goto(`/loans/${OLD}?tab=todo`);
  await page.locator("[data-source-strip]").getByRole("button", { name: "Refresh from MyLoans" }).click();
  await expect(page.getByText("Changes found: review.")).toBeVisible();
  await page.goto(`/loans/${OLD}?tab=todo&review=1`);
  const review = page.getByRole("dialog", { name: /^MyLoans changed this loan/ });
  const repl = review.locator("[data-source-replacement]");
  await expect(repl).toContainText("Possible replacement: PN-0009302");
  await expect(repl).toContainText("Matches: Product name, Loan type, Amount, Plate number, Chassis number, Engine number");
  await expect(repl.locator("[data-confirm-no-payment]")).toContainText("I confirmed no payment was made on the old PN");
  await review.getByLabel("Note (required)").fill("Unit issue found after release");
  await shot(page, "review-replacement");
  await noSideways(page);
  await review.getByRole("button", { name: "Link as replacement" }).click();
  await expect(review.locator("[data-source-error]")).toContainText("I confirmed no payment was made on the old PN");
  await repl.locator("[data-confirm-no-payment]").getByRole("checkbox").check();
  await review.getByRole("button", { name: "Link as replacement" }).click();
  await expect.poll(async () => (await db.loan.findUniqueOrThrow({ where: { pn: "PN-0009302" } })).replacesPn).toBe(OLD);
  expect((await db.loan.findUniqueOrThrow({ where: { pn: "PN-0009302" } })).replacementEvidence).toMatch(/confirmed no payment was made on PN-0001003/);
  await page.goto(`/loans/${OLD}?tab=todo`);
  await expect(page.locator("[data-replaced-by]")).toHaveText("Replaced by PN-0009302");
  await expect(related(page).locator('[data-related-row="REPLACES"]')).toContainText("Replaces this loan");
  await related(page).scrollIntoViewIfNeeded();
  await shot(page, "related-replacement");
  await noSideways(page);
});
