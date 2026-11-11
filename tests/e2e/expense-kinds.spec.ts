import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { openFundsDetails } from "./helpers";

/**
 * Expense kinds: Settings > Expense kinds (list, Other explained, add a kind, the suggestions block),
 * Other with its required "What is this expense?", Finance's "+ Add new kind" (selected at once; a
 * processor without the tick has no link), and the Add rule modal (no field covers the next one).
 * Screenshots to docs/screenshots/expense-kinds/ (1440 and 390 px).
 */
const DIR = "docs/screenshots/expense-kinds";
mkdirSync(DIR, { recursive: true });
const BUTTONS = { admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
const BASE = ["NOTARY_FEE", "PPSR_FEE", "LTO_FEE", "TRANSPORT", "OTHER"];

async function clean() {
  await resetLoans();
  await db.cashAdvanceRule.deleteMany({ where: { kind: { notIn: BASE.filter((k) => k !== "OTHER") } } });
  await db.expenseKind.deleteMany({ where: { code: { notIn: BASE } } });
}
test.beforeEach(clean);
test.afterAll(clean);

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string, target?: Locator) {
  if (width(page) === 820) return; // 1440 and 390 only
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}
const dialog = (page: Page) => page.getByRole("dialog").filter({ visible: true }).last();

/** DP: My funds > Request, one general expense typed as Other with this description (blank: leave it empty). */
async function addOtherExpense(page: Page, i: number, amount: string, desc: string) {
  await page.getByRole("button", { name: "Add an expense" }).click();
  const row = page.locator("[data-other-expense]").nth(i);
  await row.getByLabel("Kind").selectOption({ label: "Other" });
  await row.getByLabel("Amount (PHP)").fill(amount);
  if (desc) await row.getByLabel("What is this expense?").fill(desc);
  return row;
}

test("Settings > Expense kinds: the list, Other explained, add a kind, names unique", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/settings");
  const card = page.locator("#card-expense-kinds");
  await expect(card).toContainText("What a cash advance or fund transfer can be for.");
  await card.click();
  const d = dialog(page);
  await expect(d.locator("[data-kind-row]")).toHaveCount(5);
  const other = d.locator('[data-kind-row="OTHER"]');
  await expect(other).toContainText("Used when nothing else fits. The person must say what it is.");
  await expect(other).toContainText("Person enters");
  await expect(d.locator("[data-kind-row]").last()).toHaveAttribute("data-kind-row", "OTHER");
  await shot(page, "settings-card", d);

  await d.getByRole("link", { name: "Add kind" }).click();
  const f = dialog(page);
  await f.getByLabel("Name").fill("Photocopy");
  await f.getByRole("radio", { name: /Suggested amount/ }).check();
  await f.getByLabel("Amount (PHP)").fill("25");
  await shot(page, "add-kind", f);
  await f.getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).locator('[data-kind-row="PHOTOCOPY"]')).toContainText("Suggested PHP 25");
  await expect(dialog(page).locator("[data-kind-row]").last()).toHaveAttribute("data-kind-row", "OTHER");

  // The same name with other capitals and spaces is refused.
  await dialog(page).getByRole("link", { name: "Add kind" }).click();
  await dialog(page).getByLabel("Name").fill("photo COPY ");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).getByText(/Photocopy already exists/)).toBeVisible();
});

test("Other needs \"What is this expense?\"; Finance adds a new kind and it is selected; a processor has no link", async ({ page }) => {
  await signInAs(page, "dp");
  await page.goto("/my-funds?tab=request");
  const row = await addOtherExpense(page, 0, "150", "");
  const send = page.getByRole("button", { name: "Send to Finance" });
  await expect(send).toBeDisabled();
  await expect(page.locator("[data-send-why]")).toContainText("Say what this expense is");
  await expect(row.locator("[data-add-kind]")).toHaveCount(0); // no "Add and manage expense kinds" tick
  await shot(page, "other-empty", page.getByRole("region", { name: "Request" }));
  await row.getByLabel("What is this expense?").fill("12");
  await expect(row.getByText("Say what this expense is in at least 3 characters.")).toBeVisible();
  await row.getByLabel("What is this expense?").fill("Courier");
  await expect(row).toContainText("7/60");
  await expect(send).toBeEnabled();
  await shot(page, "other-filled", page.getByRole("region", { name: "Request" }));
  await send.click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();
  const line = await db.cashAdvanceLine.findFirstOrThrow({ where: { kind: "OTHER" } });
  expect(line.otherDescription).toBe("Courier");

  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  const advance = page.locator("[data-advance]", { hasText: "Other: Courier" }).first();
  // At 820 the lines sit in the row's Details (collapsed); 1440 and 390 show them in the row.
  if (width(page) === 820) await openFundsDetails(advance);
  await expect(page.getByText("Other: Courier").filter({ visible: true }).first()).toBeVisible();
  // The line editors sit in the row's "More" menu.
  await advance.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Change Other: Courier" }).click();
  const sheet = dialog(page);
  await sheet.getByRole("button", { name: "+ Add new kind" }).click();
  const add = dialog(page);
  await add.getByLabel("Name").fill("Parking");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet.getByLabel("Expense kind")).toHaveValue("PARKING");
  await expect(sheet.getByLabel("What is this expense?")).toHaveCount(0);
  await shot(page, "finance-add-new-kind", sheet);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await db.cashAdvanceLine.findUniqueOrThrow({ where: { id: line.id } })).kind).toBe("PARKING");
  const parking = await db.expenseKind.findUniqueOrThrow({ where: { code: "PARKING" } });
  expect(await db.auditLog.count({ where: { action: "expense_kind_added", entityId: parking.id } })).toBe(1);
});

test("Often typed as Other: the suggestion block, Add as a kind", async ({ page }) => {
  await signInAs(page, "dp");
  await page.goto("/my-funds?tab=request");
  for (const [i, t] of ["Courier", "courier", "COURIER"].entries()) await addOtherExpense(page, i, "100", t);
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();

  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=expense-kinds");
  const block = dialog(page).locator("[data-other-suggestions]");
  await expect(block).toContainText("Often typed as Other");
  await expect(block).toContainText("typed 3 times");
  await shot(page, "suggestions", block);
  await block.getByRole("button", { name: /Add .* as a kind/ }).click();
  const m = dialog(page);
  await m.getByRole("radio", { name: /Suggested amount/ }).check();
  await m.getByLabel("Amount (PHP)").fill("150");
  await m.getByRole("button", { name: "Add kind" }).click();
  await expect(page.locator("[data-other-suggestions]")).toHaveCount(0);
  await expect(dialog(page).locator("[data-kind-row]").filter({ hasText: /Courier/i })).toContainText("Suggested PHP 150");
  expect(await db.cashAdvanceLine.count({ where: { kind: "OTHER" } })).toBe(3); // relabel was not ticked
});

test("Add rule modal: no field covers the next one; Other explains itself", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=cash-advance&edit=new");
  const f = page.locator("[data-ca-rule-form]");
  await expect(f.getByLabel("Purpose")).toBeVisible();
  const box = async (name: string) => (await f.locator(`[data-field="${name}"]`).boundingBox())!;
  const [tx, kind, purpose, sug, max] = await Promise.all(["transactionTypeId", "expenseKind", "purpose", "suggestedAmount", "maxAmount"].map(box));
  const below = (a: { y: number; height: number }, b: { y: number }) => a.y + a.height <= b.y + 0.5;
  if (width(page) >= 640) {
    expect(Math.abs(tx.y - kind.y)).toBeLessThan(2); // one row
    expect(Math.abs(sug.y - max.y)).toBeLessThan(2);
    expect(below(kind, purpose) && below(tx, purpose)).toBe(true);
  } else {
    expect(below(tx, kind) && below(kind, purpose) && below(sug, max)).toBe(true); // stacked
  }
  expect(below(purpose, sug)).toBe(true);
  expect(purpose.width).toBeGreaterThanOrEqual(width(page) >= 640 ? tx.width + kind.width : tx.width); // full width
  await f.getByLabel("Expense kind").selectOption({ label: "Other" });
  await expect(f.locator("[data-other-rule-note]")).toHaveText("Applies to Other and to any kind without its own rule.");
  await expect(f.getByLabel("What is this expense?")).toHaveCount(0);
  // The modal's buttons stay on screen; the body scrolls by itself.
  await expect(page.getByRole("button", { name: "Save" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Cancel" }).or(page.getByRole("button", { name: "Cancel" })).first()).toBeInViewport();
  await shot(page, "add-rule-modal", dialog(page));
});
