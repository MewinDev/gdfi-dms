import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanSettingsTestRows, db } from "./db";
import { signIn } from "./helpers";

const modal = (page: Page) => page.locator("dialog#settings-modal");
const confirm = (page: Page) => page.getByRole("alertdialog", { name: "Discard your changes?" });

/**
 * A branch made in the DMS (its name is editable; a branch from MyLoans has a read-only name).
 * Test setup only: made, or put back, before each test.
 */
const ZETA = { code: "860", name: "Zeta Discard" };

test.beforeEach(async ({ page }) => {
  await cleanSettingsTestRows();
  await db.branch.upsert({ where: { code: ZETA.code }, create: { ...ZETA, source: "DMS" }, update: { name: ZETA.name, active: true } });
  await signIn(page, "admin");
});

test.afterAll(async () => {
  await db.branch.deleteMany({ where: { code: ZETA.code, loans: { none: {} } } });
});

/** Opens Branches > Zeta Discard, changes the name, and returns the Name field. */
async function editMakati(page: Page, type = true) {
  await page.goto("/admin/settings?open=branches&q=860");
  await modal(page).getByRole("link", { name: "Edit Zeta Discard (860)" }).click();
  await expect(page).toHaveURL(/edit=/);
  const name = modal(page).getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Zeta Discard");
  if (type) await name.fill("Zeta Discard Changed");
  return name;
}

test("no question when nothing changed: list step, untouched form, read-only pop-up", async ({ page }) => {
  // The LTO offices list (nothing to save).
  await page.goto("/admin/settings?open=lto");
  await modal(page).getByLabel("Find an office").fill("cebu"); // a filter is not a change
  await modal(page).getByRole("button", { name: "Close" }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(confirm(page)).toHaveCount(0);

  // A form opened and not touched.
  await editMakati(page, false);
  await modal(page).getByRole("button", { name: "Back" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await modal(page).getByRole("link", { name: "Edit Zeta Discard (860)" }).click();
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);

  // Typing the same value back is not a change.
  const name = await editMakati(page);
  await name.fill("Zeta Discard");
  await modal(page).getByRole("button", { name: "Cancel" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/edit=/);

  // Read-only pop-up.
  await page.goto("/admin/users?open=roles");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("X, Cancel, Esc and Back ask when changed; Keep editing keeps the values and the focus", async ({ page }) => {
  const name = await editMakati(page);
  for (const how of ["X", "Cancel", "Esc", "Back"] as const) {
    await name.focus();
    if (how === "X") await modal(page).getByRole("button", { name: "Close" }).click();
    if (how === "Cancel") await modal(page).getByRole("button", { name: "Cancel" }).click();
    if (how === "Esc") await page.keyboard.press("Escape");
    if (how === "Back") await modal(page).getByRole("button", { name: "Back" }).click();
    await expect(confirm(page), how).toBeVisible();
    await expect(confirm(page)).toContainText("You changed something that is not saved yet.");
    await expect(confirm(page)).toContainText("Changed: Name.");
    // Focus starts on Keep editing.
    await expect(confirm(page).getByRole("button", { name: "Keep editing" })).toBeFocused();
    await confirm(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(confirm(page)).toHaveCount(0);
    await expect(name).toHaveValue("Zeta Discard Changed");
    await expect(page).toHaveURL(/edit=/);
  }
  // Keep editing puts focus back where it was (the Name field after Esc).
  await name.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter"); // Enter on the focused Keep editing
  await expect(name).toBeFocused();
});

test("on the confirm, Esc and a click on the dimmed background keep editing; focus stays inside", async ({ page }) => {
  const name = await editMakati(page);
  await modal(page).getByRole("button", { name: "Close" }).click();
  await expect(confirm(page)).toBeVisible();
  // Focus trap: Tab cycles between the two buttons only.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[role="alertdialog"]') !== null)).toBe(true);
  }
  // The window underneath is hidden from screen readers meanwhile.
  await expect(modal(page)).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(confirm(page)).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).not.toHaveAttribute("aria-hidden", "true");
  // Focus returns to the X that opened the question.
  await expect(modal(page).getByRole("button", { name: "Close" })).toBeFocused();

  await modal(page).getByRole("button", { name: "Close" }).click();
  await page.mouse.click(5, 5); // the dimmed background
  await expect(confirm(page)).toHaveCount(0);
  await expect(name).toHaveValue("Zeta Discard Changed");
});

test("Discard changes drops the values and closes; focus returns to the card", async ({ page }) => {
  await editMakati(page);
  await modal(page).getByRole("button", { name: "Close" }).click();
  await confirm(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(modal(page)).toHaveCount(0);
  expect((await db.branch.findUniqueOrThrow({ where: { code: "860" } })).name).toBe("Zeta Discard");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("card-branches");

  // Back inside a form: Discard goes back one step, and the value is gone.
  await editMakati(page);
  await modal(page).getByRole("button", { name: "Back" }).click();
  await confirm(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await modal(page).getByRole("link", { name: "Edit Zeta Discard (860)" }).click();
  await expect(modal(page).getByLabel("Name", { exact: true })).toHaveValue("Zeta Discard");
});

test("outside click asks when changed (tablet and desktop)", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 600, "On phones the pop-up is full screen: there is no outside to click.");
  await editMakati(page);
  await page.mouse.click(8, page.viewportSize()!.height - 8);
  await expect(confirm(page)).toBeVisible();
  await confirm(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(modal(page)).toBeVisible();
});

test("the browser Back button asks when changed", async ({ page }) => {
  const name = await editMakati(page);
  await name.press("Tab"); // let the change register
  await page.goBack();
  await expect(confirm(page)).toBeVisible();
  await confirm(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/edit=/);
  await expect(name).toHaveValue("Zeta Discard Changed");
  await page.goBack();
  await confirm(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(page).not.toHaveURL(/edit=/);
});

test("the confirm appears above the Users Add pop-up", async ({ page }) => {
  await page.goto("/admin/users?open=user&edit=new");
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Name").fill("Zed Draft");
  await add.getByRole("button", { name: "Close" }).click();
  await expect(confirm(page)).toBeVisible();
  await expect(confirm(page)).toContainText("Changed: Name.");
  // On top: its button can be clicked (nothing above it intercepts).
  await confirm(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(add.getByLabel("Name")).toHaveValue("Zed Draft");
  await expect(add.getByRole("button", { name: "Close" })).toBeFocused(); // back to the X that asked
});

test("Import: a chosen file that is not imported asks first", async ({ page }, info) => {
  await page.goto("/admin/settings?open=branches&step=import");
  // Nothing chosen yet: Back goes straight back.
  await modal(page).getByRole("button", { name: "Back" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/step=import/);
  await page.goto("/admin/settings?open=branches&step=import");
  const file = info.outputPath("b.csv");
  writeFileSync(file, "code,name\r\nZQQ,Zeta Q\r\n");
  await modal(page).locator('input[type="file"]').setInputFiles(file);
  await modal(page).getByRole("button", { name: "Close" }).click();
  await expect(confirm(page)).toContainText("You chose a file but have not imported it. If you leave now, nothing will be imported.");
  await confirm(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(modal(page)).toHaveCount(0);
  expect(await db.branch.findUnique({ where: { code: "ZQQ" } })).toBeNull();
});
