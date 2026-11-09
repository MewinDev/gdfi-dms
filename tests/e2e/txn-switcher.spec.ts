import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn } from "./helpers";

/**
 * Check documents: the selected transaction on the left; the others in a side list (1100 and up)
 * or a strip of cards (tablet and phone). Selection lives in ?tx=. Screenshots to SHOTS_DIR when set.
 */
test.beforeEach(async () => {
  await resetLoans();
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
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
/** The visible entry for a transaction (side-list row or strip card). */
const entry = (page: Page, code: string) => page.locator(`[data-txn=${code}]`).filter({ visible: true }).first();

async function openChecking(page: Page) {
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await page.getByRole("link", { name: "Start checking" }).click();
  await expect(page).toHaveURL(/tx=NOTARY/);
}

test("side list or strip: only the others (desktop), swap on select, ?tx= survives refresh and Back, focus and announcement", async ({ page }) => {
  await openChecking(page);
  const main = page.getByRole("main");
  // The total counts each pick-one group once (same rule as the checklist).
  const pkg = main.locator("[data-package-summary]").filter({ visible: true });
  const summary = pkg.getByText(/^\d+ of \d+ required papers$/);
  const total = Number(((await summary.textContent()) ?? "").match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(10);

  if (wide(page)) {
    // Every transaction, in number order; the open one marked "Open now" in its place.
    const side = main.getByRole("region", { name: "Transactions (4)" });
    await expect(side.getByRole("button")).toHaveCount(4);
    expect(await side.locator("[data-txn]").evaluateAll((els) => els.map((e) => e.getAttribute("data-txn")))).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
    await expect(side.locator("[data-txn=NOTARY]")).toHaveAttribute("aria-current", "true");
    await expect(side.locator("[data-txn=NOTARY] [data-open-now]")).toHaveText("Open now");
    await expect(side.locator("[data-open-now]")).toHaveCount(1);
    // One pill and one short line; the papers count is not repeated in the rows (the package summary has it).
    await expect(side.locator("[data-txn=EDST]")).toContainText("Needs 2 required papers");
    await expect(side.locator("[data-txn=EDST]")).not.toContainText("0 of 2 required papers");
  } else {
    const strip = main.getByRole("region", { name: "Transactions" });
    await expect(strip.getByRole("button")).toHaveCount(4);
    await expect(strip.locator("[data-txn=NOTARY]")).toHaveAttribute("aria-current", "true");
    await expect(strip.locator("[data-txn=NOTARY]")).toHaveClass(/bg-select-bg/);
  }
  await expect(pkg.getByText(new RegExp(`^0 of ${total} required papers$`))).toBeVisible();

  // A ticked paper moves the package summary.
  await page.getByRole("region", { name: "Notary", exact: true }).getByLabel("Promissory Note").check();
  await expect(pkg.getByText(new RegExp(`^1 of ${total} required papers$`))).toBeVisible();

  // An open problem shows a red chip on its entry.
  const ppsr = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1012026901001" }, type: { code: "PPSR" } } });
  const reason = await db.problemReason.findFirstOrThrow({ where: { active: true } });
  await db.problem.create({ data: { loanId: ppsr.loanId, transactionId: ppsr.id, reasonId: reason.id, raisedByLabel: "E2E", raisedAt: new Date(Date.now() - 2 * 86_400_000) } });
  await page.reload();
  await expect(entry(page, "PPSR")).toContainText(/Problem: .+ · \d+ days?/);
  await shot(page, "switch-notary");
  await noSideways(page);

  // Keyboard: the entry is a button; Enter selects.
  await entry(page, "EDST").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tx=EDST/);
  await expect(page.locator("h2:focus")).toHaveText("EDST");
  await expect(page.getByRole("status").filter({ hasText: "EDST opened" })).toBeAttached();
  if (wide(page)) {
    const side = main.getByRole("region", { name: "Transactions (4)" });
    await expect(side.locator("[data-txn=EDST]")).toHaveAttribute("aria-current", "true");
    await expect(side.locator("[data-txn=EDST] [data-open-now]")).toBeVisible();
    await expect(side.locator("[data-txn=NOTARY] [data-open-now]")).toHaveCount(0);
    expect(await side.locator("[data-txn]").evaluateAll((els) => els.map((e) => e.getAttribute("data-txn")))).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
  } else {
    await expect(main.locator("[data-txn=EDST]").filter({ visible: true })).toHaveAttribute("aria-current", "true");
  }
  await shot(page, "switch-edst");
  await noSideways(page);

  // Refresh keeps it; Back returns to Notary.
  await page.reload();
  await expect(page.getByRole("region", { name: "EDST", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/tx=NOTARY/);
  await expect(page.getByRole("region", { name: "Notary", exact: true })).toBeVisible();

  // Space also selects.
  await entry(page, "MORTGAGE").focus();
  await page.keyboard.press(" ");
  await expect(page).toHaveURL(/tx=MORTGAGE/);
});

test("default selection: an empty or unknown ?tx= opens the first one that needs action", async ({ page }) => {
  await openChecking(page);
  await page.goto("/loans/GD1012026901001?tab=todo&tx=NOPE");
  await expect(page.getByRole("region", { name: "Notary", exact: true })).toBeVisible();
  await noSideways(page);
});
