import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanSettingsTestRows, db, resetLoans } from "./db";
import { signIn } from "./helpers";

const dialog = (page: Page) => page.locator("dialog#settings-modal");

test.beforeEach(async () => {
  await resetLoans();
  await cleanSettingsTestRows();
});
test.afterAll(async () => {
  await resetLoans();
  await cleanSettingsTestRows();
});

test("Add a transaction type, then the Loan Associate adds it from Check documents", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=transaction-types");
  await dialog(page).getByRole("link", { name: "Add transaction type" }).click();
  await expect(page).toHaveURL(/edit=new/);
  await dialog(page).getByLabel("Name").fill("Release letter");
  await dialog(page).getByLabel("Short code").fill("ZREL");
  await dialog(page).getByLabel("Done by").selectOption("DP");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  const row = dialog(page).getByRole("listitem").filter({ hasText: "Release letter" });
  await expect(row).toContainText("ZREL");
  await expect(row).toContainText("No papers set yet. Add them in Checklist items.");
  // Built-ins cannot be made inactive.
  await dialog(page).getByRole("link", { name: "Edit Notary" }).click();
  await expect(dialog(page).getByText(/always active/)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Make inactive" })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, "la");
  await page.goto("/search?q=PN-0001001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await page.getByRole("link", { name: "Start checking" }).click();
  // Phones pin the Send bar at the bottom: bring the button to the middle first, as a person would.
  const addBtn = page.getByRole("button", { name: "Add a transaction" });
  await addBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await addBtn.click();
  const addOne = page.getByRole("button", { name: "Add Release letter" });
  await addOne.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await addOne.click();
  await expect(page.getByText("Transaction added. Tick its papers below.")).toBeVisible();
  await expect(page.locator("[data-txn]").filter({ hasText: "Release letter" }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Add a transaction" }).getByText("Added", { exact: true })).toBeVisible();
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: "PN-0001001" }, include: { transactions: { include: { type: true } } } });
  expect(loan.transactions.find((t) => t.type.code === "ZREL")?.origin).toBe("ADDED");
});

test("Users: search, filters, Add and Edit pop-ups, and the roles pop-up", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

  // Search and filter (the address keeps them)
  await page.getByLabel("Search").fill("joy");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=joy/);
  await expect(page.getByRole("link", { name: /^Edit / })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Edit Joy Navarro" })).toBeVisible();
  await page.goto("/admin/users");
  await page.getByLabel("Role").selectOption({ label: "Admin" });
  await expect(page).toHaveURL(/role=/);
  await expect(page.getByRole("link", { name: /^Edit / })).toHaveCount(1);
  await page.goto("/admin/users");
  await expect(page.getByText("DP · Collateral & Mortgage").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Not signed in yet").filter({ visible: true }).first()).toBeVisible();

  // Add user
  await page.getByRole("link", { name: "Add user" }).click();
  const add = page.getByRole("dialog", { name: "Add user" });
  await expect(add).toBeVisible();
  await add.getByLabel("Name").fill("Zed Tester");
  await add.getByLabel("Email").fill("zz.tester@gdfi.ph");
  await add.getByLabel("Role").selectOption({ label: "Loan Associate" });
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add.getByText("Pick at least one branch: Loan Associate works only in assigned branches.")).toBeVisible(); // error beside the field
  await add.getByLabel("Cebu").check();
  await add.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit Zed Tester" })).toBeVisible();

  // Edit: switching off asks first
  await page.getByRole("link", { name: "Edit Zed Tester" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Zed Tester" });
  await edit.getByRole("switch", { name: "Active" }).uncheck();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alertdialog", { name: "Make Zed Tester inactive?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Make inactive and save" }).click();
  await expect(edit.getByText("Saved", { exact: true }).first()).toBeVisible();
  await edit.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("link", { name: "Edit Zed Tester" })).toHaveCount(0); // default filter: Active
  await page.getByLabel("Status").selectOption("inactive");
  await expect(page.getByRole("link", { name: "Edit Zed Tester" })).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { email: "zz.tester@gdfi.ph" } })).active).toBe(false);

  // Roles pop-up (read-only), Esc closes and focus returns
  await page.getByRole("link", { name: "What each role can do" }).click();
  const roles = page.getByRole("dialog", { name: "What each role can do" });
  await expect(roles.getByText("Document Processor / Collateral & Mortgage")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("users-roles");
});

test("Document types: add, edit, make inactive with a confirm, Inactive filter, make active", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings");
  await expect(page.getByRole("region", { name: "Documents and steps" }).getByRole("link", { name: /^Document types/ })).toContainText(/\d+ types/);
  await page.goto("/admin/settings?open=document-types");
  await dialog(page).getByRole("link", { name: "Add document type" }).click();
  await dialog(page).getByLabel("Name").fill("Zeta deed");
  await dialog(page).getByLabel("Short code").fill("ZDEED");
  await dialog(page).getByLabel("Original or copy (default)").selectOption("ORIGINAL");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await dialog(page).getByLabel("Find a document type").fill("zeta");
  await dialog(page).getByRole("link", { name: "Edit Zeta deed" }).click();
  await dialog(page).getByLabel("Notes (optional)").fill("For land loans");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).getByText("Saved", { exact: true }).first()).toBeVisible();

  await dialog(page).getByRole("button", { name: "Make inactive" }).click();
  await expect(page.getByRole("alertdialog").getByText("Used by 0 checklist items. They keep it. It will not appear for new items. Make inactive?")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Make inactive" }).click();
  await expect(dialog(page).getByText("Made inactive.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Back" }).click();

  await dialog(page).getByLabel("Find a document type").fill("zeta");
  await expect(dialog(page).getByRole("link", { name: "Edit Zeta deed" })).toHaveCount(0); // default: Active
  await dialog(page).getByLabel("Show").selectOption("inactive");
  const row = dialog(page).getByRole("listitem").filter({ hasText: "Zeta deed" });
  await expect(row).toContainText("Inactive");
  await row.getByRole("button", { name: "Make Zeta deed active" }).click();
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Zeta deed" })).toHaveCount(0);
  const d = await db.documentType.findUniqueOrThrow({ where: { code: "ZDEED" } });
  expect([d.active, d.notes, d.defaultOriginality]).toEqual([true, "For land loans", "ORIGINAL"]);
  expect(await db.auditLog.count({ where: { entityId: d.id, action: { in: ["made_inactive", "made_active"] } } })).toBe(2);
});

test("Branches: Make inactive confirm names the effect; Inactive filter; Make active", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=branches");
  await dialog(page).getByRole("link", { name: "Edit Davao" }).click();
  await dialog(page).getByRole("button", { name: "Make inactive" }).click();
  await expect(page.getByRole("alertdialog").getByText("Davao has 0 open loan files. They stay as they are, but no new loan files can be opened for Davao. Make inactive?")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep it active" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Make inactive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Make inactive" }).click();
  await expect(dialog(page).getByText("Made inactive.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Back" }).click();
  await expect(dialog(page).getByRole("link", { name: "Edit Davao" })).toHaveCount(0);
  await dialog(page).getByLabel("Show").selectOption("all");
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Davao" })).toContainText("Inactive");
  await dialog(page).getByRole("button", { name: "Make Davao active" }).click();
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Davao" })).not.toContainText("Inactive");
  // The card counts active rows only.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /^Branches/ })).toContainText("4 branches");
});

test("Import / Export: Back link; download, check and import round trip for Branches", async ({ page }, info) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=branches");
  await dialog(page).getByRole("button", { name: "Import / Export" }).click();
  await expect(page).toHaveURL(/step=import/);
  await expect(page.getByRole("dialog", { name: "Branches: Import / Export" })).toBeVisible();
  await expect(dialog(page).getByRole("table", { name: "Columns" })).toContainText("Branch name as MyLoans spells it.");
  await dialog(page).getByRole("button", { name: "Back" }).click();
  await expect(page).not.toHaveURL(/step=import/);
  await expect(dialog(page).getByRole("link", { name: "Edit Davao" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Import / Export" }).click();

  // Download template and current data
  const [tpl] = await Promise.all([page.waitForEvent("download"), dialog(page).getByRole("link", { name: "Download template" }).click()]);
  expect(tpl.suggestedFilename()).toBe("gdfi-dms-template-branches.csv");
  const tplText = readFileSync(await tpl.path()!, "utf8");
  expect(tplText.startsWith("﻿code,name,status,notes\r\n")).toBe(true);
  expect(tplText).toContain("EXAMPLE, delete this row");
  const [cur] = await Promise.all([page.waitForEvent("download"), dialog(page).getByRole("link", { name: "Download current data" }).click()]);
  const curText = readFileSync(await cur.path()!, "utf8");
  expect(curText).toContain("QC,Quezon City,Active");

  // Edit the downloaded data: add one branch, keep the rest; one bad row.
  const file = info.outputPath("branches.csv");
  writeFileSync(file, `${curText.trimEnd()}\r\nZIM,Zeta Imported,Active,\r\nZBAD,Cebu,Active,\r\n`, "utf8");
  await dialog(page).locator('input[type="file"]').setInputFiles(file);
  await expect(dialog(page).getByText("Chosen: branches.csv")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Check file" }).click();
  await expect(dialog(page).getByText("1 new, 0 changed, 4 unchanged, 1 with problems")).toBeVisible();
  await expect(dialog(page).getByText("Row 7, Branch name: already used by another branch.")).toBeVisible();
  expect(await db.branch.findUnique({ where: { code: "ZIM" } })).toBeNull(); // nothing saved yet

  const audits = await db.auditLog.count({ where: { action: "settings_imported" } });
  await dialog(page).getByRole("button", { name: "Import 1 row" }).click();
  await expect(dialog(page).getByText("Imported 1 new and 0 updated. 1 row was skipped.")).toBeVisible();
  expect((await db.branch.findUniqueOrThrow({ where: { code: "ZIM" } })).name).toBe("Zeta Imported");
  expect(await db.branch.count({ where: { code: { in: ["QC", "CEB", "DVO", "MKT"] } } })).toBe(4);
  expect(await db.auditLog.count({ where: { action: "settings_imported" } })).toBe(audits + 1);
});
