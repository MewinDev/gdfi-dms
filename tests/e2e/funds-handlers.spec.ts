import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";

/**
 * Cash advances and fund transfers are handled by different people: a person who handles one type sees
 * only that type on Funds (lists, counts, CSV, report links), the buttons follow the type's ticks, the
 * role editor shows two blocks, Settings shows who handles each type and the "Nobody can ..." line, and
 * the approval bands have a Type switch. Test database only. Screenshots at 1440 and 390:
 * docs/screenshots/funds-handlers/.
 */
const DIR = "docs/screenshots/funds-handlers";
mkdirSync(DIR, { recursive: true });
const CA_KEYS = ["funds:ca_view", "funds:ca_approve", "funds:ca_release", "funds:ca_settle", "funds:ca_edit_lines", "funds:ca_change_type", "funds:ca_print"];
const FT_KEYS = ["funds:ft_view", "funds:ft_approve", "funds:ft_release", "funds:ft_settle", "funds:ft_edit_lines", "funds:ft_change_type", "funds:ft_print"];
const CA = "CA-2026-8101";
const FT = "FT-2026-8102";
const FT_DONE = "FT-2026-8103";

const width = (page: Page) => page.viewportSize()!.width;
async function shot(page: Page, name: string) {
  if (width(page) === 820) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: false });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function signIn(page: Page, button: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function signInOther(page: Page, label: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

let saved: { id: string; permissions: string[] }[] = [];
async function clean() {
  await resetLoans();
  await cleanTestRoles();
  for (const r of saved) await db.role.update({ where: { id: r.id }, data: { permissions: r.permissions } });
  saved = [];
  const fin = await db.role.findUniqueOrThrow({ where: { key: "FIN" } });
  await db.approvalBand.deleteMany({});
  for (const fundsTypeId of ["fundstype_ca", "fundstype_ft"]) await db.approvalBand.create({ data: { fundsTypeId, fromCents: 0, roleId: fin.id } });
}
test.beforeEach(clean);
test.afterAll(clean);

/** A cash advance and a fund transfer to approve, and a liquidated fund transfer; two one-type Finance people. */
async function fixtures() {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const base = { requestedById: dp.id, branchId: branch.id, requestedCents: 120_000 };
  const line = { create: [{ kind: "TRANSPORT", requestedCents: 120_000, note: "Tricycle to the LTO" }] };
  await db.cashAdvance.create({ data: { ...base, number: CA, lines: line } });
  await db.cashAdvance.create({ data: { ...base, number: FT, fundsTypeId: "fundstype_ft", fundsTypeCode: "FT", fundsTypeName: "Fund transfer", lines: line } });
  await db.cashAdvance.create({ data: { ...base, number: FT_DONE, status: "LIQUIDATED", approvedCents: 120_000, releasedCents: 120_000, releasedAt: new Date(), fundsTypeId: "fundstype_ft", fundsTypeCode: "FT", fundsTypeName: "Fund transfer", lines: line } });
  const caRole = await db.role.create({ data: { key: "C_Z_FIN_CASH", name: "Z Finance cash", permissions: ["loans:view", ...CA_KEYS] } });
  const ftRole = await db.role.create({ data: { key: "C_Z_FIN_TRANSFER", name: "Z Finance transfer", permissions: ["loans:view", ...FT_KEYS] } });
  await db.user.create({ data: { email: "zz.fin.cash@gdfi.ph", name: "Zz Cash Finance", roleId: caRole.id, isTestUser: true, allBranches: true } });
  await db.user.create({ data: { email: "zz.fin.transfer@gdfi.ph", name: "Zz Transfer Finance", roleId: ftRole.id, isTestUser: true, allBranches: true } });
  // Each one-type Finance approves its own type (bands per type).
  await db.approvalBand.deleteMany({});
  await db.approvalBand.create({ data: { fundsTypeId: "fundstype_ca", fromCents: 0, roleId: caRole.id } });
  await db.approvalBand.create({ data: { fundsTypeId: "fundstype_ft", fromCents: 0, roleId: ftRole.id } });
}

for (const who of [
  { label: "Zz Cash Finance (Z Finance cash)", mine: CA, other: FT, line: "Cash advances", shotName: "funds-ca-only-user" },
  { label: "Zz Transfer Finance (Z Finance transfer)", mine: FT, other: CA, line: "Fund transfers", shotName: "funds-ft-only-user" },
]) {
  test(`${who.line} only: no other type anywhere, no Type filter, the type said under Funds`, async ({ page }) => {
    await fixtures();
    await signInOther(page, who.label);
    await page.goto("/funds?tab=approve");
    await expect(page.locator("[data-funds-types-line]")).toHaveText(who.line);
    await expect(page.locator("[data-funds-type-filter]")).toHaveCount(0);
    await expect(page.locator(`[data-advance="${who.mine}"]`).first()).toBeAttached();
    await expect(page.locator(`[data-advance="${who.other}"]`)).toHaveCount(0);
    await expect(page.locator('[data-tab="approve"] [data-tab-count]')).toHaveText("1");
    await expect(page.locator("[data-funds-summary]")).toContainText("1 request");
    // The Approve button is there for their own type (their role is that type's band).
    await expect(page.locator(`[data-advance="${who.mine}"] [data-approve-open]`).filter({ visible: true })).toHaveCount(1);
    // Even with the other type in the address, nothing of it shows.
    await page.goto(`/funds?tab=approve&ftype=${who.other.slice(0, 2)}`);
    await expect(page.locator(`[data-advance="${who.other}"]`)).toHaveCount(0);
    // The CSV holds only their type.
    const csv = await (await page.request.get("/api/funds/export?tab=all")).text();
    expect(csv).toContain(who.mine);
    expect(csv).not.toContain(who.other);
    expect(csv).not.toContain(who.mine === CA ? FT_DONE : "CA-2026-81");
    // The other type's report: the normal refusal ("Not found"; the Funds pages stream, so the status is 200).
    if (who.mine === CA) {
      await page.goto(`/funds/${FT_DONE}/print`);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(page.locator("[data-liquidation-report]")).toHaveCount(0);
    }
    await page.goto("/funds?tab=approve");
    await noSideways(page);
    await shot(page, who.shotName);
  });
}

test("Both types: the Type filter; the buttons follow the type's ticks (no Release without the tick)", async ({ page }) => {
  await fixtures();
  await signIn(page, "Continue as Test Finance");
  await page.goto("/funds?tab=approve");
  await expect(page.locator("[data-funds-type-filter]")).toBeVisible();
  await expect(page.locator("[data-funds-types-line]")).toHaveCount(0);
  await expect(page.locator(`[data-advance="${CA}"]`).first()).toBeAttached();
  await expect(page.locator(`[data-advance="${FT}"]`).first()).toBeAttached();
  // An approver of fund transfers without Release: To release shows the plain line for its type.
  const role = await db.role.create({ data: { key: "C_Z_FT_APPROVER", name: "Z Approver transfer", permissions: ["loans:view", "funds:ft_view", "funds:ft_approve"] } });
  await db.user.create({ data: { email: "zz.ft.approver@gdfi.ph", name: "Zz Transfer Approver", roleId: role.id, isTestUser: true, allBranches: true } });
  const fin = await db.user.findUniqueOrThrow({ where: { email: "test.finance@gdfi.ph" } });
  await db.cashAdvance.update({ where: { number: FT }, data: { status: "APPROVED", approvedCents: 120_000, approvedById: fin.id, approvedAt: new Date() } });
  await signInOther(page, "Zz Transfer Approver (Z Approver transfer)");
  await page.goto("/funds?tab=release");
  await expect(page.locator(`[data-advance="${FT}"]`).first()).toBeAttached();
  await expect(page.locator("[data-release-open]")).toHaveCount(0);
  await expect(page.locator("[data-view-only]")).toHaveText("You can view these requests. Releasing fund transfers needs the 'Release fund transfers' tick on your role.");
  await noSideways(page);
});

test("Role editor: two blocks under Funds; unticking Release fund transfers says who loses it", async ({ page }) => {
  const fin = await db.role.findUniqueOrThrow({ where: { key: "FIN" } });
  const users = await db.user.count({ where: { roleId: fin.id, active: true } });
  await signIn(page, "Continue as Admin");
  await page.goto(`/admin/settings?open=roles&edit=${fin.id}`);
  const ca = page.locator('[data-subgroup="Cash advance"]');
  const ft = page.locator('[data-subgroup="Fund transfer"]');
  await expect(ca).toBeVisible();
  await expect(ft).toBeVisible();
  for (const label of ["See cash advances", "Approve cash advances", "Release cash advances", "Settle and close cash advances", "Edit lines of cash advances", "Change type of cash advances", "Print liquidation report for cash advances", "Release fund transfers"]) {
    await expect(page.getByRole("checkbox", { name: label, exact: false }).first()).toBeChecked();
  }
  await ca.scrollIntoViewIfNeeded();
  await noSideways(page);
  await shot(page, "role-editor-funds-two-blocks");
  await page.locator('[data-perm="funds:ft_release"]').getByRole("checkbox").uncheck();
  await expect(page.locator("[data-impact]")).toContainText(`${users} ${users === 1 ? "user loses" : "users lose"}: Release fund transfers.`);
  // Unticking See unticks the rest of that type only, said in one line.
  await page.locator('[data-perm="funds:ft_view"]').getByRole("checkbox").uncheck();
  await expect(page.locator("[data-also-note]")).toContainText("Also unticked: Approve fund transfers");
  await expect(page.locator('[data-perm="funds:ca_release"]').getByRole("checkbox")).toBeChecked();
  await page.locator("[data-impact]").scrollIntoViewIfNeeded();
  await shot(page, "role-editor-impact");
});

test("Settings: who handles each type, the 'Nobody can release fund transfers.' line, the bands' Type switch", async ({ page }) => {
  await signIn(page, "Continue as Admin");
  await page.goto("/admin/settings?open=funds-types");
  const ftBlock = page.locator('[data-who-handles-type="FT"]');
  await expect(page.locator('[data-who-handles-type="CA"] [data-handler-step="release"]')).toContainText("Test Finance");
  await expect(ftBlock.locator('[data-handler-step="approve"]')).toContainText("Test Finance");
  await expect(ftBlock.locator("[data-funds-gap]")).toHaveCount(0);
  await expect(ftBlock.locator("[data-change-in-roles]")).toBeVisible();
  await noSideways(page);
  await shot(page, "funds-types-who-handles");

  // Nobody with Release fund transfers: the line, here, on Roles and on Funds; gone once a role has it again.
  const holders = await db.role.findMany({ where: { permissions: { has: "funds:ft_release" } } });
  saved = holders.map((r) => ({ id: r.id, permissions: r.permissions }));
  for (const r of holders) await db.role.update({ where: { id: r.id }, data: { permissions: r.permissions.filter((k) => k !== "funds:ft_release") } });
  await page.reload();
  await expect(ftBlock.locator("[data-funds-gap]")).toHaveText("Nobody can release fund transfers.");
  await expect(ftBlock.locator('[data-handler-step="release"]')).toContainText("Nobody");
  await noSideways(page);
  await shot(page, "health-line");
  await page.goto("/admin/settings?open=roles");
  await expect(page.locator("[data-funds-health]")).toHaveText("Nobody can release fund transfers.");
  await page.goto("/funds");
  await expect(page.locator("[data-funds-health]")).toContainText("Nobody can release fund transfers.");
  const fin = holders.find((r) => r.key === "FIN")!;
  await db.role.update({ where: { id: fin.id }, data: { permissions: [...fin.permissions] } });
  await page.goto("/admin/settings?open=funds-types");
  await expect(ftBlock.locator("[data-funds-gap]")).toHaveCount(0);
  await page.goto("/admin/settings?open=roles");
  await expect(page.locator("[data-funds-health]")).toHaveCount(0);

  // Approval bands: one list per type.
  await page.goto("/admin/settings?open=approval-bands&btype=FT");
  await expect(page.locator('[data-band-type="FT"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-band-type="CA"]')).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog")).toContainText("Approved by Finance");
  await noSideways(page);
  await shot(page, "approval-bands-type-switch");
});
