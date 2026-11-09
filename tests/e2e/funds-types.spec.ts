import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * Funds types (Cash advance CA, Fund transfer FT) on the same funds flow: Settings > Funds types, the
 * DP's request with the type choice, a Finance list with both pills, the release form for each type,
 * the type filter and its CSV. Screenshots to docs/screenshots/funds-types/ (1440 and 390 px).
 */
const DIR = "docs/screenshots/funds-types";
mkdirSync(DIR, { recursive: true });
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;

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
async function shot(page: Page, name: string, target?: ReturnType<Page["locator"]>) {
  if (width(page) === 820) return; // 1440 and 390 only
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

/** LA opens GD1652026901003 and sends Mortgage (needs funds: LTO fee) to the test DP, who accepts. */
async function acceptedMortgageNeedingFunds(page: Page) {
  await signInAs(page, "la");
  await page.goto("/loans?fill=GD1652026901003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
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
  await signInAs(page, "dp");
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id } });
  await page.goto(`/jobs/${job.id}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("This job needs funds. Request a cash advance first.").first()).toBeVisible();
  return t.id;
}

test("Settings > Funds types: the two proposed types and their switches", async ({ page }) => {
  await signInAs(page, "admin");
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

test("DP picks Fund transfer; Finance sees both pills, filters by type, gets the CSV, and releases each type with its own fields", async ({ page }) => {
  test.setTimeout(300_000);
  const mortgage = await acceptedMortgageNeedingFunds(page);

  // DP: the request with the type choice (default Cash advance), then Fund transfer.
  await page.goto("/my-funds");
  const choice = page.locator("[data-funds-type-choice]");
  await expect(choice.getByRole("radio", { name: /CA · Cash advance/ })).toBeChecked();
  await choice.getByRole("radio", { name: /FT · Fund transfer/ }).check();
  await page.getByRole("textbox", { name: /LTO fee amount/ }).fill("2500.00");
  await shot(page, "dp-request-type-choice");
  await noSideways(page);
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();
  const ft = await db.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transactionId: mortgage } } } });
  expect(ft).toMatchObject({ fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });

  // A Cash advance from the same processor (general expense), so the list has both types.
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const ca = await db.cashAdvance.create({ data: { number: "CA-E2E-0001", requestedById: dp.id, branchId: ft.branchId, requestedCents: 50_000, lines: { create: [{ kind: "TRANSPORT", requestedCents: 50_000, note: "Tricycle to the LTO" }] } } });
  expect(ca.fundsTypeCode).toBe("CA"); // a record without a type is a Cash advance

  // Finance: To approve with both pills.
  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  await expect(page.locator(`[data-advance="${ft.number}"] [data-funds-type="FT"]`)).toBeVisible();
  await expect(page.locator(`[data-advance="CA-E2E-0001"] [data-funds-type="CA"]`)).toBeVisible();
  await expect(page.locator("[data-funds-type-filter]")).toContainText("Fund transfer · 1");
  await expect(page.locator("[data-funds-type-filter]")).toContainText("Cash advance · 1");
  await shot(page, "finance-list-both-pills");
  await noSideways(page);

  // The type filter and its CSV: only Fund transfers, with the Type column.
  await page.locator('[data-filter-type="FT"]').click();
  await expect(page).toHaveURL(/ftype=FT/);
  await expect(page.locator("[data-advance]")).toHaveCount(1);
  await expect(page.locator("[data-funds-csv]")).toHaveAttribute("href", /ftype=FT/);
  await shot(page, "finance-filter-fund-transfer-csv");
  const csv = await (await page.request.get((await page.locator("[data-funds-csv]").getAttribute("href"))!)).text();
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  expect(lines[0].split(",").slice(0, 3)).toEqual(["Number", "Type", "Type name"]);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(`${ft.number},FT,Fund transfer`);
  await page.locator("[data-funds-type-filter]").getByRole("link", { name: /^All/ }).click();

  // Approve both.
  for (const n of [ft.number, "CA-E2E-0001"]) {
    await page.locator(`[data-advance="${n}"]`).getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { number: n } })).status).toBe("APPROVED");
  }

  // To release: the form follows the type.
  await page.goto("/funds?tab=release");
  const ftCard = page.locator(`[data-advance="${ft.number}"]`);
  const caCard = page.locator(`[data-advance="CA-E2E-0001"]`);
  await expect(caCard.getByRole("button", { name: "Release cash", exact: true })).toBeVisible();
  await expect(caCard.getByLabel("Transfer date")).toHaveCount(0);
  await expect(ftCard.getByRole("button", { name: "Send transfer", exact: true })).toBeVisible();
  await expect(ftCard.getByLabel("Transfer reference number")).toBeVisible();
  await expect(ftCard.getByLabel("Last 4 digits")).toHaveAttribute("maxlength", "4");
  await shot(page, "finance-release-cash-advance", caCard);
  await shot(page, "finance-release-fund-transfer", ftCard);
  await noSideways(page);

  // Send the transfer: reference, date, bank, account name, last 4 digits.
  await ftCard.getByLabel("Transfer reference number").fill("FT-889101");
  await ftCard.getByLabel("Bank or e-wallet").fill("BPI");
  await ftCard.getByLabel("Account name").fill("Test Document Processor");
  await ftCard.getByLabel("Last 4 digits").fill("4821");
  await ftCard.getByRole("button", { name: "Send transfer", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { id: ft.id } })).status).toBe("RELEASED");
  expect(await db.cashAdvance.findUniqueOrThrow({ where: { id: ft.id } })).toMatchObject({ releaseRef: "FT-889101", accountProvider: "BPI", accountLast4: "4821" });
  // Cash advance: as before, the reference note only.
  await caCard.getByLabel(/Reference/).fill("VOUCHER-0002");
  await caCard.getByRole("button", { name: "Release cash", exact: true }).click();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { id: ca.id } })).status).toBe("RELEASED");

  // Outstanding shows the transfer details (account ending only) and the DP sees the pill.
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator(`[data-advance="${ft.number}"]`)).toContainText("account ending 4821");
  await signInAs(page, "dp");
  await page.goto("/my-funds?tab=advances");
  await expect(page.locator('[data-funds-type="FT"]').first()).toBeVisible();
  // The notification says which type it is.
  expect(await db.notification.count({ where: { userId: dp.id, title: `${ft.number} (Fund transfer) sent` } })).toBe(1);
});
