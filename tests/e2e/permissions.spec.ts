import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { signIn } from "./helpers";

/**
 * Roles are just ticks: the loan file without and with "Refresh a loan from MyLoans".
 * Screenshots at 1440 and 390 px: docs/screenshots/permissions/ (820 runs the checks without them).
 */
const DIR = "docs/screenshots/permissions";
const PN = "GD1012026901001";
const shoots = (page: Page) => [1440, 390].includes(page.viewportSize()?.width ?? 0);
async function shot(page: Page, name: string) {
  if (!shoots(page)) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png` });
}

const LA_TICKS = ["loans:view", "loans:search", "loans:open", "checklist:tick", "labels:print", "transactions:add", "transactions:complete", "processing:send", "processing:accept_returns", "funds:flag", "problems:raise", "problems:resolve", "holds:raise", "holds:resolve", "myloans:view"];

async function noRefreshUser() {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  const role = await db.role.create({ data: { key: "C_Z_LA_NO_REFRESH", name: "Z LA (no refresh)", builtIn: false, permissions: LA_TICKS } });
  const u = await db.user.create({ data: { email: "zz.norefresh@gdfi.ph", name: "Zz No Refresh LA", roleId: role.id, isTestUser: true, homeBranchId: branch.id } });
  await db.userAccessGrant.create({ data: { userId: u.id, kind: "BRANCH", branchId: branch.id } });
  await db.userBranch.create({ data: { userId: u.id, branchId: branch.id } });
  return role;
}

/** A test user of a custom role: the "Other test user" list on the sign-in page. */
async function signInAs(page: Page, name: string, role: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label: `${name} (${role})` });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
});
test.afterAll(async () => {
  await cleanTestRoles();
});

test("Loan File: no Refresh button without the tick; it appears once Admin ticks it on the role", async ({ page }) => {
  // The LA opens the loan file (the LA role has Refresh).
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("button", { name: /Open loan file/ }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await expect(page.getByRole("button", { name: "Refresh from MyLoans" })).toBeVisible();

  const role = await noRefreshUser();
  await signInAs(page, "Zz No Refresh LA", "Z LA (no refresh)");
  await page.goto(`/loans/${PN}`);
  const strip = page.locator("[data-source-strip]");
  await expect(strip.locator("[data-last-checked]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh from MyLoans" })).toHaveCount(0);
  await shot(page, "loan-file-no-refresh");

  // Admin ticks it (the role editor's own path is covered by role-editor.spec.ts); the person's next page follows.
  await db.role.update({ where: { id: role.id }, data: { permissions: [...LA_TICKS, "loans:refresh"] } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh from MyLoans" })).toBeVisible();
  await shot(page, "loan-file-with-refresh");
  await page.getByRole("button", { name: "Refresh from MyLoans" }).click();
  await expect(strip).toContainText(/No changes|Changes found|small details/);
});

test("Loan File: without \"See when MyLoans was last checked\" the strip shows nothing", async ({ page }) => {
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("button", { name: /Open loan file/ }).click();
  const role = await noRefreshUser();
  await db.role.update({ where: { id: role.id }, data: { permissions: LA_TICKS.filter((k) => k !== "myloans:view") } });
  await signInAs(page, "Zz No Refresh LA", "Z LA (no refresh)");
  await page.goto(`/loans/${PN}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator("[data-last-checked]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh from MyLoans" })).toHaveCount(0);
});
