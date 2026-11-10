import { expect, type Locator, type Page } from "@playwright/test";

/** The "Approve this request?" window (Approve asks first). */
export const approveWindow = (page: Page) => page.locator('dialog[open][data-confirm-dialog="approve-confirm"]');

/**
 * Presses a row's Approve, then the window's gold Approve. `scope` is the row (or the page): its first
 * Approve button opens the window.
 */
export async function approveWithConfirm(page: Page, scope: Locator | Page = page) {
  await scope.locator("[data-approve-open]").filter({ visible: true }).first().click();
  const w = approveWindow(page);
  await expect(w).toBeVisible();
  await w.locator("[data-confirm-ok]").click();
}
