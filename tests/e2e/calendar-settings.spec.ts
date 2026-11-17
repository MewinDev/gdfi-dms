import { expect, test, type Page } from "@playwright/test";
import { db } from "./db";
import { signIn, docShot } from "./helpers";

/**
 * Settings, Holidays and working days (D-041): Check before Save, the preview line, an office closure for
 * ticked branches, and the seeded samples labelled as such. A far-future date keeps the real due dates out of it.
 * Screenshots at 1440 and 390 px: docs/screenshots/calendar-settings/.
 */
const DIR = "docs/screenshots/calendar-settings";
const MARK = "Zz e2e closure";
const shoots = (page: Page) => [1440, 390].includes(page.viewportSize()?.width ?? 0);
async function shot(page: Page, name: string) {
  if (!shoots(page)) return;
  await page.evaluate(() => document.fonts.ready);
  await docShot(page, { path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png` });
}
const clean = () => db.holidayCalendar.deleteMany({ where: { reason: { startsWith: MARK } } });

test.beforeEach(clean);
test.afterAll(clean);

test("Admin checks, then saves an office closure for one branch", async ({ page }) => {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=holidays");
  const area = page.locator("[data-calendar-area]");
  await expect(area).toBeVisible();
  // The seeded holidays are samples, labelled so.
  await expect(area.locator("[data-sample]").first()).toBeVisible();
  await shot(page, "area");

  const form = page.locator('[data-calendar-form="closure"]');
  const save = form.getByRole("button", { name: "Save closure" });
  await expect(save).toBeDisabled(); // Check first
  await expect(form.getByText("Check first: it shows which due dates will move.")).toBeVisible();
  await form.getByLabel("Date").fill("2099-01-05");
  await form.getByLabel("Find a branch").fill("Angono");
  await form.getByLabel("Branches closed").selectOption(angono.id);
  await form.getByLabel("Reason").fill(`${MARK}: typhoon, offices closed`);
  await form.getByRole("button", { name: "Check" }).click();
  await expect(form.locator("[data-calendar-preview]")).toContainText(/No saved due date changes\.|This will extend \d+ items? \(\d+ currently overdue\)\./);
  await expect(save).toBeEnabled();
  // The checked values stay in the form (Save sends exactly what was checked).
  await expect(form.getByLabel("Reason")).toHaveValue(`${MARK}: typhoon, offices closed`);
  await form.locator("[data-calendar-preview]").scrollIntoViewIfNeeded();
  await shot(page, "closure-checked");

  // Changing a value after Check turns Save off again.
  await form.getByLabel("Reason").fill(`${MARK}: typhoon, offices closed by the LGU`);
  await expect(save).toBeDisabled();
  await form.getByRole("button", { name: "Check" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.locator("[data-calendar-preview]")).toContainText("Office closure saved.");
  await expect.poll(() => db.holidayCalendar.count({ where: { reason: { startsWith: MARK }, kind: "CLOSURE", allBranches: false, branches: { some: { branchId: angono.id } } } })).toBe(1);
  const row = page.locator('[data-calendar-row="2099-01-05"]');
  await expect(row).toContainText("Office closure");

  // Make inactive (D-042): Check first, then Make inactive; only the due dates it moved go back.
  await row.getByRole("button", { name: /^Make inactive/ }).click();
  const toggle = row.locator("[data-entry-toggle]");
  await expect(toggle.getByRole("button", { name: "Make inactive" })).toBeDisabled();
  await toggle.getByRole("button", { name: "Check" }).click();
  await expect(toggle.locator("[data-calendar-preview]")).toContainText(/No saved due date changes\.|back to the due dates? they had before/);
  await toggle.getByRole("button", { name: "Make inactive" }).click();
  await expect(toggle.locator("[data-calendar-preview]")).toContainText("Made inactive.");
  await expect.poll(async () => (await db.holidayCalendar.findFirstOrThrow({ where: { reason: { startsWith: MARK } } })).active).toBe(false);
});

test("a closure without a reason is refused with what to do", async ({ page }) => {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=holidays");
  const form = page.locator('[data-calendar-form="closure"]');
  await form.getByLabel("Date").fill("2099-01-06");
  await form.getByLabel("Find a branch").fill("Angono");
  await form.getByLabel("Branches closed").selectOption(angono.id);
  await form.getByLabel("Reason").fill("x");
  await form.getByRole("button", { name: "Check" }).click();
  await expect(form.getByText(/Say why the office is closed/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Save closure" })).toBeDisabled();
});
