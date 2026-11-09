import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { signIn } from "./helpers";

const dialog = (page: Page) => page.locator("dialog#settings-modal");

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
});
test.afterAll(async () => {
  await cleanTestRoles();
});

test("Custom role from a copy: switches, plain words, save, assign, sign in, then make inactive", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings");
  const card = page.getByRole("region", { name: "People and access" });
  await expect(card.getByRole("link", { name: /^Roles and access/ })).toContainText(/9 roles · 0 custom/);
  await card.getByRole("link", { name: /^Roles and access/ }).click();
  await expect(page).toHaveURL(/open=roles/);

  // Duplicate Loan Associate → the copy opens in the role step.
  await dialog(page).getByRole("button", { name: "Duplicate Loan Associate" }).click();
  await expect(page.getByRole("dialog", { name: "Roles and access: Copy of Loan Associate" })).toBeVisible();
  await expect(page).toHaveURL(/open=roles&edit=/);
  await page.reload(); // the ?open= address keeps the step
  await expect(page.getByRole("dialog", { name: "Roles and access: Copy of Loan Associate" })).toBeVisible();

  const words = dialog(page).getByRole("region", { name: "In plain words" }).or(dialog(page).locator("section", { has: page.getByRole("heading", { name: "In plain words" }) })).first();
  await expect(words).toContainText("Can send to a processor and accept returned papers.");

  // Unsaved changes ask first.
  await dialog(page).getByRole("switch", { name: "Send to a processor" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog").getByRole("heading", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();

  await dialog(page).getByLabel("Name", { exact: true }).fill("Z Branch Checker");
  await expect(words).toContainText("Can accept returned papers.");
  await expect(words).not.toContainText("send to a processor");

  // Dependencies are explained before they apply.
  await dialog(page).getByRole("switch", { name: "Find a loan" }).click(); // waits for the explanation
  await expect(dialog(page).getByText("Turning off Find a loan also turns off Open a loan file, because it needs it.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "OK, change them" }).click();
  await expect(dialog(page).getByRole("switch", { name: "Open a loan file" })).not.toBeChecked();
  await dialog(page).getByRole("switch", { name: "Open a loan file" }).click();
  await expect(dialog(page).getByText("Turning on Open a loan file also turns on Find a loan, because it needs it.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).first().click();
  await expect(dialog(page).getByRole("switch", { name: "Open a loan file" })).not.toBeChecked();
  await expect(dialog(page).getByText("1 of 5 on")).toBeVisible(); // Loans: only See loan files is on now
  await dialog(page).getByRole("switch", { name: "Find a loan" }).check();

  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).getByText("Saved", { exact: true }).first()).toBeVisible();
  const role = await db.role.findFirstOrThrow({ where: { name: "Z Branch Checker" } });
  expect(role.permissions).toContain("loans:search");
  expect(role.permissions).not.toContain("loans:open");
  expect(role.permissions).not.toContain("processing:send");
  expect(await db.auditLog.count({ where: { entityId: role.id } })).toBe(2); // duplicated, then saved

  // Back link → list shows the custom role.
  await dialog(page).getByRole("button", { name: "Back" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  const row = dialog(page).getByRole("listitem").filter({ hasText: "Z Branch Checker" });
  await expect(row).toContainText("Custom");
  await expect(row).toContainText("0 people");

  // Access matrix download
  const [dl] = await Promise.all([page.waitForEvent("download"), dialog(page).getByRole("link", { name: "Download access matrix" }).click()]);
  const csv = readFileSync(await dl.path()!, "utf8");
  expect(csv.startsWith("﻿area,permission,key,")).toBe(true);
  expect(csv).toContain("Z Branch Checker");
  expect(csv).toMatch(/Check documents,Tick papers,checklist:tick,Yes,No/); // Loan Associate Yes, Admin No

  // Assign it to a new test user.
  await page.goto("/admin/users?open=user&edit=new");
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Name").fill("Zed Checker");
  await add.getByLabel("Email").fill("zz.checker@gdfi.ph");
  await add.getByLabel("Role").selectOption({ label: "Z Branch Checker (test users in test mode)" });
  await add.getByLabel("Quezon City").check();
  await add.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Sign in as that test user (test mode): allowed and refused actions.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label: "Zed Checker (Z Branch Checker)" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: /Settings/ })).toHaveCount(0);
  await page.goto("/search?q=PN-0001001");
  await expect(page.getByRole("main").getByText("Loan found")).toBeVisible(); // allowed: Find a loan
  await expect(page.getByRole("main").getByText("Your role does not allow opening loan files.")).toBeVisible(); // refused: open
  await expect(page.getByRole("main").getByRole("button", { name: "Open loan file" })).toBeDisabled();
  const settings = await page.goto("/admin/settings");
  expect(settings?.status()).toBe(404); // refused: Settings

  // Move the user to another role, then the role can be made inactive.
  await page.context().clearCookies();
  await signIn(page, "admin");
  const zed = await db.user.findUniqueOrThrow({ where: { email: "zz.checker@gdfi.ph" } });
  await page.goto(`/admin/settings?open=roles&edit=${role.id}`);
  await dialog(page).getByRole("button", { name: "Make inactive" }).click();
  await expect(page.getByRole("alertdialog").getByText("1 person has this role. Move them to another role first, then make it inactive.")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Open Users with this role" }).click();
  await expect(page).toHaveURL(new RegExp(`role=${role.id}`));
  await page.getByRole("link", { name: "Edit Zed Checker" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Zed Checker" });
  await edit.getByLabel("Role").selectOption({ label: "Loan Associate" });
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alertdialog").getByText(/Zed Checker will lose: nothing\. And gain: .*Open a loan file.*Send to a processor/)).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Change role and save" }).click();
  await expect(edit.getByText("Saved", { exact: true }).first()).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: zed.id } })).roleId).not.toBe(role.id);

  await page.goto(`/admin/settings?open=roles&edit=${role.id}`);
  await dialog(page).getByRole("button", { name: "Make inactive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Make inactive" }).click();
  await expect(dialog(page).getByText("Made inactive.")).toBeVisible();
  expect((await db.role.findUniqueOrThrow({ where: { id: role.id } })).active).toBe(false);
  await dialog(page).getByRole("button", { name: "Back" }).click();
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Z Branch Checker" })).toHaveCount(0); // default filter: Active
});

test("Admin is locked: switches on and disabled, with a note", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=roles");
  await dialog(page).getByRole("link", { name: "Edit Admin" }).click();
  await expect(dialog(page).getByText(/Admin is locked\./)).toBeVisible();
  await expect(dialog(page).getByRole("switch", { name: "Manage roles and access" })).toBeChecked();
  await expect(dialog(page).getByRole("switch", { name: "Manage roles and access" })).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "Make inactive" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manage users" }).or(dialog(page).getByRole("link", { name: "See them in Users" })).first()).toBeVisible();
});
