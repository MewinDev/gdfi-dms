import { expect, test, type Page } from "@playwright/test";
import { signInWith } from "./helpers";
import { db, resetLoans } from "./db";

/**
 * D-056 item 2: Cancel transaction. The LA does not have the tick; Admin (and the LA Supervisor/Head) does. The
 * confirm step asks for a reason and says what happens; the transaction becomes Cancelled and the action is logged.
 */
const PN = "GD1652026901003";

async function openPn(page: Page) {
  await page.goto(`/loans?fill=${PN}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => { await resetLoans(); });
test.afterAll(async () => { await resetLoans(); });

test("Cancel transaction: not for the LA; Admin cancels with a reason on the confirm step; it is Cancelled and logged", async ({ page }) => {
  await signInWith(page, "Continue as Loan Associate");
  await openPn(page);
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator("[data-cancel-transaction]")).toHaveCount(0);

  // The audit log is append-only: count the rows this run adds.
  const before = await db.auditLog.count({ where: { action: "transaction_cancelled", pn: PN } });
  await signInWith(page, "Continue as Admin");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await page.locator("[data-cancel-transaction]").getByRole("button", { name: "Cancel transaction" }).click();
  const sheet = page.getByRole("dialog", { name: "Cancel Mortgage" });
  await expect(sheet.locator("[data-purpose]")).toContainText("Mortgage will be cancelled on this loan file.");
  await noSideways(page);
  await sheet.getByLabel("Why cancel it?").fill("The mortgage is not needed for this unit.");
  await sheet.getByRole("button", { name: "Cancel transaction" }).click();
  await expect.poll(async () => (await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "MORTGAGE" } } })).status).toBe("CANCELLED");
  expect(await db.auditLog.count({ where: { action: "transaction_cancelled", pn: PN } })).toBe(before + 1);
  expect((await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "MORTGAGE" } } })).cancelReason).toBe("The mortgage is not needed for this unit.");
});
