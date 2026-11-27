import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openFundsDetails, signInWith, docShot } from "./helpers";
import { db, resetLoans } from "./db";
import { approveWithConfirm } from "./approve";

/**
 * Funds types (Cash advance CA, Fund transfer FT) on the same funds flow: Settings > Funds types, the
 * DP's request with the type choice, a Finance list with both pills, the release form for each type,
 * the type filter (no CSV: exports are off for now). Screenshots to docs/screenshots/funds-types/ (1440 and 390 px).
 */
const DIR = "docs/screenshots/funds-types";
mkdirSync(DIR, { recursive: true });
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;

test.beforeEach(async () => {
  await resetLoans();
});

const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string, target?: ReturnType<Page["locator"]>) {
  if (width(page) === 820) return; // 1440 and 390 only
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await docShot(target, { path });
  else await docShot(page, { path, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

/** LA opens GD1652026901003 and sends Mortgage (needs funds: LTO fee) to the test DP, who accepts. */
async function acceptedMortgageNeedingFunds(page: Page) {
  await signInWith(page, BUTTONS.la);
  await page.goto("/loans?q=GD1652026901003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
  const t = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code: "MORTGAGE" } } });
  await page.goto(`/loans/GD1652026901003?tab=todo&work=${t.id}`);
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
  await page.getByText("Needs funds", { exact: true }).click();
  await page.locator("label", { hasText: "LTO fee" }).click();
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("ASSIGNED");
  await signInWith(page, BUTTONS.dp);
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id } });
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("This job needs funds. Request a cash advance first.").first()).toBeVisible();
  return t.id;
}

test("Settings > Funds types: the two proposed types and their switches", async ({ page }) => {
  await signInWith(page, BUTTONS.admin);
  await page.goto("/admin/settings");
  await expect(page.locator("#card-funds-types")).toBeVisible();
  await page.goto("/admin/settings?open=funds-types");
  const dlg = page.getByRole("dialog", { name: "Funds types" });
  await expect(dlg).toContainText("CA · Cash advance");
  await expect(dlg).toContainText("FT · Fund transfer");
  await expect(dlg).toContainText("Proposed, to be confirmed with Finance");
  await expect(dlg).toContainText("reference number · account details · receipts");
  await shot(page, "settings-funds-types");
  await noSideways(page);
});

test("DP picks Fund transfer; Finance sees both pills, filters by type, and releases each type with its own fields", async ({ page }) => {
  test.setTimeout(300_000);
  const mortgage = await acceptedMortgageNeedingFunds(page);

  // DP: the request with the type choice (default Cash advance), then Fund transfer.
  await page.goto("/my-funds");
  await page.locator("[data-request-funds]").click(); // D-065: the request form is in the side panel
  const choice = page.locator("[data-funds-type-choice]");
  await expect(choice.getByRole("radio", { name: /CA · Cash advance/ })).toBeChecked();
  await choice.getByRole("radio", { name: /FT · Fund transfer/ }).check();
  await page.getByRole("textbox", { name: /LTO fee amount/ }).fill("2500.00");
  // D-056: a fund transfer asks where Finance sends it (the full number is shown to Finance only when sending).
  const acct = page.locator("[data-request-account]");
  await acct.getByLabel("Bank or e-wallet").fill("BPI");
  await acct.getByLabel("Account name").fill("Test Document Processor");
  await acct.getByLabel("Account number").fill("1234 5678 4821");
  await shot(page, "dp-request-type-choice");
  await noSideways(page);
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await page.locator('[data-confirm-dialog="request-confirm"] [data-confirm-ok]').click(); // D-065: Send asks first
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();
  const ft = await db.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transactionId: mortgage } } } });
  expect(ft).toMatchObject({ fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });
  // A new Fund transfer is numbered FT-<year>-<4 digits> (its own running number, not CA-).
  expect(ft.number).toMatch(/^FT-\d{4}-\d{4}$/);

  // A Cash advance from the same processor (general expense), so the list has both types.
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const ca = await db.cashAdvance.create({ data: { number: "CA-E2E-0001", requestedById: dp.id, branchId: ft.branchId, requestedCents: 50_000, lines: { create: [{ kind: "TRANSPORT", requestedCents: 50_000, note: "Tricycle to the LTO" }] } } });
  expect(ca.fundsTypeCode).toBe("CA"); // a record without a type is a Cash advance

  // Finance: To approve with both pills.
  await signInWith(page, BUTTONS.fin);
  await page.goto("/funds?tab=approve");
  await expect(page.locator(`[data-advance="${ft.number}"] [data-funds-type="FT"]`)).toBeVisible();
  await expect(page.locator(`[data-advance="CA-E2E-0001"] [data-funds-type="CA"]`)).toBeVisible();
  await expect(page.locator('[data-filter-type="FT"] [data-type-count]')).toHaveText("1");
  await expect(page.locator('[data-filter-type="CA"] [data-type-count]')).toHaveText("1");
  await shot(page, "finance-list-both-pills");
  await noSideways(page);

  // The type filter: only Fund transfers. No CSV button (CSV exports are off for now).
  await page.locator('[data-filter-type="FT"]').click();
  await expect(page).toHaveURL(/ftype=FT/);
  await expect(page.locator("[data-advance]")).toHaveCount(1);
  await expect(page.locator("[data-funds-csv]")).toHaveCount(0);
  await shot(page, "finance-filter-fund-transfer-csv");
  await page.locator("[data-funds-type-filter]").getByRole("link", { name: /^All/ }).click();

  // Approve both.
  for (const n of [ft.number, "CA-E2E-0001"]) {
    await approveWithConfirm(page, page.locator(`[data-advance="${n}"]`));
    await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { number: n } })).status).toBe("APPROVED");
  }

  // To release: the form follows the type.
  await page.goto("/funds?tab=release");
  const ftCard = page.locator(`[data-advance="${ft.number}"]`);
  const caCard = page.locator(`[data-advance="CA-E2E-0001"]`);
  // Each row's button opens the release form of its type (Release for cash, Send for a transfer).
  await expect(caCard.getByRole("button", { name: "Release", exact: true })).toBeVisible();
  await expect(ftCard.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await noSideways(page);
  await caCard.getByRole("button", { name: "Release", exact: true }).click();
  let sheet = page.getByRole("dialog", { name: "Release cash: CA-E2E-0001" });
  await expect(sheet.getByRole("button", { name: "Release cash", exact: true })).toBeVisible();
  await expect(sheet.getByLabel("Transfer date")).toHaveCount(0);
  await shot(page, "finance-release-cash-advance", sheet);
  await sheet.getByRole("button", { name: "Close" }).click();
  await ftCard.getByRole("button", { name: "Send", exact: true }).click();
  sheet = page.getByRole("dialog", { name: `Send transfer: ${ft.number}` });
  await expect(sheet.getByRole("button", { name: "Send transfer", exact: true })).toBeVisible();
  await expect(sheet.getByLabel("Transfer reference number")).toBeVisible();
  // D-056: the account the processor typed, in full here only, with the tick that Finance checked it.
  await expect(sheet.locator("[data-account-number]")).toHaveText("123456784821");
  await expect(sheet.getByLabel("Last 4 digits")).toHaveCount(0);
  await shot(page, "finance-release-fund-transfer", sheet);

  // Send the transfer: reference, date, and the tick.
  await sheet.getByLabel("Transfer reference number").fill("FT-889101");
  await sheet.getByLabel("I checked the receiving account").check();
  await sheet.getByRole("button", { name: "Send transfer", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { id: ft.id } })).status).toBe("RELEASED");
  expect(await db.cashAdvance.findUniqueOrThrow({ where: { id: ft.id } })).toMatchObject({ releaseRef: "FT-889101", accountProvider: "BPI", accountLast4: "4821", accountNumber: "" });
  // Cash advance: as before, the reference note only.
  await caCard.getByRole("button", { name: "Release", exact: true }).click();
  sheet = page.getByRole("dialog", { name: "Release cash: CA-E2E-0001" });
  await sheet.getByLabel(/Reference/).fill("VOUCHER-0002");
  await sheet.getByRole("button", { name: "Release cash", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { id: ca.id } })).status).toBe("RELEASED");

  // Outstanding shows the transfer details (account ending only) and the DP sees the pill.
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator(`[data-advance="${ft.number}"]`)).toContainText("account ending 4821");
  await expect(page.locator(`[data-advance="${ft.number}"]`)).not.toContainText("123456784821");
  await signInWith(page, BUTTONS.dp);
  await page.goto("/my-funds?tab=advances");
  await page.locator(`[data-advance-number="${ft.number}"]`).first().click(); // D-065: the advance's panel
  await expect(page.locator('[data-funds-type="FT"]').first()).toBeVisible();
  // D-056: the processor confirms receipt; a wrong amount is flagged to Finance, who clears it with remarks.
  const confirm = page.locator(`[data-confirm-receipt="${ft.number}"]`);
  await confirm.getByLabel("Reference number").fill("FT-889101");
  await confirm.getByLabel("Amount received (PHP)").fill("2400");
  await confirm.getByLabel("Last 4 digits of the account").fill("4821");
  await confirm.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(confirm.getByText(/It does not match: amount: typed ₱2,400.00, Finance recorded ₱2,500.00/)).toBeVisible();
  await noSideways(page);
  await signInWith(page, BUTTONS.fin);
  await page.goto("/funds?tab=outstanding");
  const row = page.locator(`[data-advance="${ft.number}"]`);
  // A tablet hides the money trail (where the mismatch shows) until the row's Details is open.
  if (page.viewportSize()?.width === 820) await openFundsDetails(row);
  await expect(row.locator("[data-receipt-mismatch]").filter({ visible: true }).first()).toContainText("amount: typed ₱2,400.00");
  await row.getByRole("button", { name: "Clear mismatch" }).filter({ visible: true }).first().click();
  const clear = page.getByRole("dialog", { name: `${ft.number}: clear the receipt mismatch` });
  await clear.getByLabel("What did you check or correct?").fill("Bank shows 2,500.00; the processor misread the slip.");
  await clear.getByRole("button", { name: "Clear", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { id: ft.id } })).receiptConfirmedAt).not.toBeNull();
  await signInWith(page, BUTTONS.dp);
  await page.goto("/my-funds?tab=advances");
  // The notification says which type it is.
  expect(await db.notification.count({ where: { userId: dp.id, title: `${ft.number} (Fund transfer) sent` } })).toBe(1);
});
