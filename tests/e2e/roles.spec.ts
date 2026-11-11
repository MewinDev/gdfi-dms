import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { signIn } from "./helpers";
import { ROLE_DEFAULTS } from "../../lib/auth/permissions";

/** The seed creates one built-in role per ROLE_DEFAULTS entry (prisma/seed.ts); no custom roles. */
const SEEDED_ROLES = Object.keys(ROLE_DEFAULTS).length;

const dialog = (page: Page) => page.locator("dialog#settings-modal");
/** A tick in the role editor, by its technical name. */
const tickOf = (page: Page, key: string) => dialog(page).locator(`[data-perm="${key}"]`).getByRole("checkbox");

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
});
test.afterAll(async () => {
  await cleanTestRoles();
});

test("Custom role from a copy: ticks, plain words, save, assign, sign in, then make inactive", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings");
  const card = page.getByRole("region", { name: "People and access" });
  await expect(card.getByRole("link", { name: /^Roles and access/ })).toContainText(`${SEEDED_ROLES} roles · 0 custom`);
  await card.getByRole("link", { name: /^Roles and access/ }).click();
  await expect(page).toHaveURL(/open=roles/);

  // Duplicate Loan Associate → the copy opens in the role step.
  await dialog(page).getByRole("button", { name: "Duplicate Loan Associate" }).click();
  await expect(page.getByRole("dialog", { name: "Roles and access: Copy of Loan Associate" })).toBeVisible();
  await expect(page).toHaveURL(/open=roles&edit=/);
  await page.reload(); // the ?open= address keeps the step
  await expect(page.getByRole("dialog", { name: "Roles and access: Copy of Loan Associate" })).toBeVisible();

  const words = dialog(page).getByRole("region", { name: "In plain words" }).or(dialog(page).locator("section", { has: page.getByRole("heading", { name: "In plain words" }) })).first();
  await expect(words).toContainText("Can send to a processor, flag funds and accept returned papers.");

  // Unsaved changes ask first.
  await tickOf(page, "processing:send").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog").getByRole("heading", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();

  await dialog(page).getByLabel("Name", { exact: true }).fill("Z Branch Checker");
  await expect(words).toContainText("Can flag funds and accept returned papers.");
  await expect(words).not.toContainText("send to a processor");

  // Dependencies apply at once and are said in one short line.
  await tickOf(page, "loans:search").uncheck();
  await expect(dialog(page).locator("[data-also-note]")).toHaveText("Also unticked: Open a loan file (it needs Find a loan).");
  await expect(tickOf(page, "loans:open")).not.toBeChecked();
  await expect(dialog(page).getByText("1 of 4 ticked")).toBeVisible(); // Loans: only See loan files is ticked now (Export loans is hidden while CSV exports are off)
  await tickOf(page, "loans:open").check();
  await expect(dialog(page).locator("[data-also-note]")).toHaveText("Also ticked: Find a loan (needed by Open a loan file).");
  await tickOf(page, "loans:open").uncheck();
  await expect(tickOf(page, "loans:search")).toBeChecked();
  // Loan Associate can see Settings, Expense kinds ("See expense kinds", since b829f40). Untick it so this
  // role has no Settings tick at all: then Settings is refused below.
  await tickOf(page, "funds:kinds_view").uncheck();

  // Removing ticks asks first (the confirm window lists them).
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alertdialog").getByText(/loses: .*Open a loan file.*Send to a processor/)).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save and remove" }).click();
  await expect(dialog(page).getByText("Saved", { exact: true }).first()).toBeVisible();
  const role = await db.role.findFirstOrThrow({ where: { name: "Z Branch Checker" } });
  expect(role.permissions).toContain("loans:search");
  expect(role.permissions).not.toContain("loans:open");
  expect(role.permissions).not.toContain("processing:send");
  expect(role.permissions).not.toContain("funds:kinds_view");
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
  expect(csv).toMatch(/Transactions and papers,Tick papers,checklist:tick,Yes,No/); // Loan Associate Yes, Admin No

  // Assign it to a new test user.
  await page.goto("/admin/users?open=user&edit=new");
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Name").fill("Zed Checker");
  await add.getByLabel("Email").fill("zz.checker@gdfi.ph");
  await add.getByLabel("Role").selectOption({ label: "Z Branch Checker (test users in test mode)" });
  // Branch access: Selected, then tick Antipolo in the tree (the search opens the nodes that match).
  await add.getByRole("radio", { name: "Selected" }).check();
  await add.getByPlaceholder("Find a branch by name or code").fill("101");
  await add.getByLabel("Antipolo", { exact: true }).check();
  await add.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Sign in as that test user (test mode): allowed and refused actions.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label: "Zed Checker (Z Branch Checker)" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: /Settings/ })).toHaveCount(0);
  await page.goto("/search?q=GD1012026901001");
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

test("Admin is an ordinary role: its ticks can change; Manage roles is protected by the lock-out rules", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=roles");
  await dialog(page).getByRole("link", { name: "Edit Admin" }).click();
  await expect(dialog(page).getByText(/Admin is locked/)).toHaveCount(0);
  await expect(tickOf(page, "roles:manage")).toBeChecked();
  await expect(tickOf(page, "roles:manage")).toBeEnabled();
  await tickOf(page, "roles:manage").uncheck();
  await expect(dialog(page).locator("[data-lockout]")).toContainText('You cannot take "Manage roles" away from your own role.');
  await expect(page.getByRole("link", { name: "Manage users" }).or(dialog(page).getByRole("link", { name: "See them in Users" })).first()).toBeVisible();
});
