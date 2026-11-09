import { expect, test, type Page } from "@playwright/test";
import { db } from "./db";
import { signIn } from "./helpers";

/**
 * Settings > Roles ("roles are just ticks"): the grouped editor, View / Change pairs, the search and the
 * technical names switch, the impact preview, the confirm before removing, the last change on the card
 * and the lock-out block. Screenshots at 1440 and 390 px: docs/screenshots/permissions/.
 */
const DIR = "docs/screenshots/permissions";
const shoots = (page: Page) => [1440, 390].includes(page.viewportSize()?.width ?? 0);
async function shot(page: Page, name: string, fullPage = false) {
  if (!shoots(page)) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}

const ROLE = "Zz E2E Refreshers";
const EMAIL = "zz.e2e.refresher@gdfi.ph";

async function cleanup() {
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.role.deleteMany({ where: { name: ROLE } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);

test("Roles: the ticks grouped in plain words, View / Change side by side, search and technical names", async ({ page }) => {
  await signIn(page, "admin");
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  await page.goto(`/admin/settings?open=roles&edit=${la.id}`);
  const groups = page.locator("[data-group]");
  await expect(groups).toHaveCount(11);
  await expect(page.locator('[data-group="myloans"]')).toContainText("MyLoans and sync");
  const pair = page.locator('[data-pair="myloans:view|loans:refresh"]');
  await expect(pair).toContainText("View");
  await expect(pair).toContainText("Change");
  await expect(pair.getByRole("checkbox", { name: /Refresh a loan from MyLoans/ })).toBeChecked();
  await expect(page.locator("[data-tick-count]")).toContainText("permissions ticked");
  await expect(page.locator("[data-used-by]")).toContainText("Used by");
  // No technical names until the switch is on.
  await expect(page.locator("[data-tech-name]")).toHaveCount(0);
  await shot(page, "role-editor-grouped");
  await page.getByLabel("Find a permission").fill("refresh");
  await expect(groups).toHaveCount(1);
  await page.locator("[data-tech-switch]").check();
  await expect(page.locator('[data-perm="loans:refresh"] [data-tech-name]')).toHaveText("Technical name: loans:refresh");
  await page.locator("[data-tech-switch]").uncheck();
});

test("Roles: the impact preview before Save, the confirm before removing, and the last change on the card", async ({ page }) => {
  const role = await db.role.create({ data: { key: "C_ZZ_E2E_REFRESHERS", name: ROLE, permissions: ["loans:view", "myloans:view"], branchAccess: "ALL" } });
  await db.user.create({ data: { email: EMAIL, name: "Zz E2E Refresher", roleId: role.id, isTestUser: true, allBranches: true } });
  await signIn(page, "admin");
  await page.goto(`/admin/settings?open=roles&edit=${role.id}`);
  const refresh = page.locator('[data-perm="loans:refresh"]').getByRole("checkbox");
  await refresh.check();
  await expect(page.locator("[data-impact]")).toContainText("1 user gains: Refresh a loan from MyLoans. 0 users lose anything.");
  await page.locator('[data-perm="loans:refresh"]').scrollIntoViewIfNeeded();
  await shot(page, "role-editor-impact");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await db.role.findUniqueOrThrow({ where: { id: role.id } })).permissions.includes("loans:refresh")).toBe(true);

  // Unticking the View also unticks the Change, said in one line; Save asks first.
  await page.locator('[data-perm="myloans:view"]').getByRole("checkbox").uncheck();
  await expect(page.locator("[data-also-note]")).toContainText("Also unticked: Refresh a loan from MyLoans");
  await expect(refresh).not.toBeChecked();
  await expect(page.locator("[data-impact]")).toContainText("1 user loses:");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Remove these permissions?");
  await expect(dlg.locator("[data-remove-confirm]")).toContainText("See when MyLoans was last checked, Refresh a loan from MyLoans");
  await dlg.getByRole("button", { name: "Save and remove" }).click();
  await expect.poll(async () => (await db.role.findUniqueOrThrow({ where: { id: role.id } })).permissions.sort()).toEqual(["loans:view"]);

  await page.goto("/admin/settings?open=roles");
  await expect(page.locator(`[data-role-card="${ROLE}"] [data-last-change]`)).toContainText("removed See when MyLoans was last checked, Refresh a loan from MyLoans");
});

test("Roles: the lock-out block (nobody can take Manage roles away from their own role)", async ({ page }) => {
  await signIn(page, "admin");
  const admin = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  await page.goto(`/admin/settings?open=roles&edit=${admin.id}`);
  await page.locator('[data-perm="roles:manage"]').getByRole("checkbox").uncheck();
  const block = page.locator("[data-lockout]");
  await expect(block).toContainText("This cannot be saved");
  await expect(block).toContainText('You cannot take "Manage roles" away from your own role.');
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await block.scrollIntoViewIfNeeded();
  await shot(page, "role-editor-lockout");
  // Nothing was saved.
  expect((await db.role.findUniqueOrThrow({ where: { id: admin.id } })).permissions).toContain("roles:manage");
});
