import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { approveWindow } from "./approve";

/**
 * Decisions batch (10 November 2026): Approve asks first ("Approve this request?", once even on a double
 * click), "Print liquidation report" (no Print and a refusal without it), the role editor (the new tick,
 * the built-in Branch Supervisor, Finance losing "Move a hold to another person"), the "nobody can move a
 * hold" line, the Branch Supervisor moving holds only inside their branches, and FT / CA numbers.
 * Test database only. Screenshots at 1440 and 390: docs/screenshots/decisions-batch/.
 */
const DIR = "docs/screenshots/decisions-batch";
mkdirSync(DIR, { recursive: true });
const BUTTONS = { admin: "Continue as Admin", fin: "Continue as Test Finance", la: "Continue as Loan Associate" } as const;
const CA = "CA-2026-8001";
const FT = "FT-2026-8002";
const DONE = "CA-2026-8003";
const PN = "GD1652026990101";

const width = (page: Page) => page.viewportSize()!.width;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
/** A test user of a custom or built-in role: the "Other test user" list on the sign-in page. */
async function signInOther(page: Page, label: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string, target?: Locator) {
  if (width(page) === 820) return; // 1440 and 390 only
  await page.waitForTimeout(250);
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function clean() {
  await resetLoans();
  await cleanTestRoles();
  await db.loan.deleteMany({ where: { pn: PN } });
  const admin = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  if (!admin.permissions.includes("holds:transfer")) await db.role.update({ where: { id: admin.id }, data: { permissions: [...admin.permissions, "holds:transfer"] } });
  const fin = await db.role.findUniqueOrThrow({ where: { key: "FIN" } });
  await db.role.update({ where: { id: fin.id }, data: { permissions: fin.permissions.filter((k) => k !== "holds:transfer") } });
}
test.beforeEach(clean);
test.afterAll(clean);

/** An Angono loan (Elsa Morales) with a Mortgage; a cash advance and a fund transfer to approve; a liquidated one. */
async function fixtures() {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const fin = await db.user.findUniqueOrThrow({ where: { email: "test.finance@gdfi.ph" } });
  const ft = await db.fundsType.findUniqueOrThrow({ where: { code: "FT" } });
  const mortgage = await db.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const loan = await db.loan.create({
    data: {
      pn: PN, borrowerName: "Elsa Morales", branchId: branch.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "E2E fixture", stage: "For checklist", transactions: { create: { typeId: mortgage.id } },
    },
    include: { transactions: true },
  });
  const base = { requestedById: dp.id, branchId: branch.id };
  await db.cashAdvance.create({ data: { ...base, number: CA, requestedCents: 350_000, lines: { create: [{ transactionId: loan.transactions[0].id, kind: "LTO_FEE", requestedCents: 350_000 }] } } });
  await db.cashAdvance.create({ data: { ...base, fundsTypeId: ft.id, fundsTypeCode: "FT", fundsTypeName: ft.name, number: FT, formerNumbers: ["CA-2026-8000"], requestedCents: 200_000, lines: { create: [{ kind: "OTHER", otherDescription: "Courier", requestedCents: 200_000 }] } } });
  await db.cashAdvance.create({ data: { ...base, number: DONE, status: "LIQUIDATED", requestedCents: 100_000, approvedCents: 100_000, releasedCents: 100_000, approvedById: fin.id, approvedAt: new Date(), releasedById: fin.id, releasedAt: new Date(), lines: { create: [{ kind: "TRANSPORT", requestedCents: 100_000, approvedCents: 100_000, releasedCents: 100_000, note: "Tricycle to the LTO" }] } } });
  return { loan, dp };
}

test("Approve asks first: the amount and the request; Cancel and Esc do nothing; Approve approves once even on a double click", async ({ page }) => {
  test.setTimeout(180_000);
  const { dp } = await fixtures();
  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  // Both numbers by type, and the former number under the FT one.
  await expect(page.locator(`[data-advance="${CA}"] [data-request-number]`)).toHaveText(CA);
  await expect(page.locator(`[data-advance="${FT}"] [data-request-number]`)).toHaveText(FT);
  await expect(page.locator(`[data-advance="${FT}"] [data-formerly]`).filter({ visible: true }).first()).toHaveText("Formerly CA-2026-8000");
  await shot(page, "funds-ft-and-ca-numbers");
  // The search finds the FT request by its former number.
  const search = page.locator("[data-funds-search]");
  await search.fill("CA-2026-8000");
  await expect(page.locator(`[data-advance="${FT}"]`).filter({ visible: true })).not.toHaveCount(0);
  await expect(page.locator(`[data-advance="${CA}"]`).filter({ visible: true })).toHaveCount(0);
  await search.fill("");

  const row = page.locator(`[data-advance="${CA}"]`);
  const w = approveWindow(page);
  await row.locator("[data-approve-open]").filter({ visible: true }).first().click();
  await expect(w).toBeVisible();
  await expect(w.getByRole("heading")).toHaveText("Approve this request?");
  await expect(w.locator("[data-approve-amount]")).toHaveText("₱3,500.00");
  await expect(w.locator("[data-approve-line]")).toHaveText(`${CA} · Test Document Processor · LTO fee · Elsa Morales`);
  // Focus starts on Cancel; Cancel is white, Approve gold.
  await expect(w.locator("[data-confirm-cancel]")).toBeFocused();
  await expect(w.locator("[data-confirm-ok]")).toHaveClass(/btn-gold/);
  const [cancelBox, okBox] = [(await w.locator("[data-confirm-cancel]").boundingBox())!, (await w.locator("[data-confirm-ok]").boundingBox())!];
  expect(cancelBox.height).toBeGreaterThanOrEqual(44);
  expect(okBox.height).toBeGreaterThanOrEqual(44);
  if (width(page) === 390) {
    // A bottom sheet on a phone.
    const box = (await w.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
  }
  await noSideways(page);
  await shot(page, "approve-confirm");
  // Esc cancels; Cancel cancels: nothing is approved.
  await page.keyboard.press("Escape");
  await expect(w).toBeHidden();
  await row.locator("[data-approve-open]").filter({ visible: true }).first().click();
  await w.locator("[data-confirm-cancel]").click();
  await expect(w).toBeHidden();
  const adv = await db.cashAdvance.findUniqueOrThrow({ where: { number: CA } });
  expect(adv.status).toBe("REQUESTED");
  // Approve with a double click: approved once (one history row, one notice).
  await row.locator("[data-approve-open]").filter({ visible: true }).first().click();
  await w.locator("[data-confirm-ok]").dblclick();
  await expect.poll(async () => (await db.cashAdvance.findUniqueOrThrow({ where: { number: CA } })).status).toBe("APPROVED");
  await page.waitForTimeout(1500); // let a second submit (if any) land
  expect(await db.auditLog.count({ where: { entityId: adv.id, action: "advance_approved" } })).toBe(1);
  expect(await db.notification.count({ where: { userId: dp.id, title: `${CA} (Cash advance) approved` } })).toBe(1);
  expect(await db.cashAdvance.findUniqueOrThrow({ where: { number: CA } })).toMatchObject({ approvedCents: 350_000 });

  // Changed amounts: the window shows the changed total.
  await page.goto("/funds?tab=approve");
  const ftRow = page.locator(`[data-advance="${FT}"]`);
  await ftRow.getByRole("button", { name: "Deny", exact: true }).filter({ visible: true }).first().click();
  const sheet = page.getByRole("dialog", { name: `Approve or deny ${FT}` });
  await sheet.getByRole("textbox").first().fill("1500.00");
  await sheet.getByLabel(/^Note/).fill("Courier is cheaper this week");
  await sheet.locator("[data-approve-open]").click();
  await expect(w.locator("[data-approve-amount]")).toHaveText("₱1,500.00");
  await expect(w.locator("[data-approve-line]")).toHaveText(new RegExp(`^${FT} · Test Document Processor · Other`));
  await noSideways(page);
  await shot(page, "approve-confirm-changed-total");
  await w.locator("[data-confirm-cancel]").click();
  await expect(w).toBeHidden();
  expect((await db.cashAdvance.findUniqueOrThrow({ where: { number: FT } })).status).toBe("REQUESTED");
});

test("Print liquidation report: Finance prints; a role without the tick has no Print and the report is refused", async ({ page }) => {
  await fixtures();
  await signInAs(page, "fin");
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator(`[data-advance="${DONE}"] [data-print-link]`).filter({ visible: true })).toHaveCount(1);

  const role = await db.role.create({ data: { key: "C_Z_NO_PRINT", name: "Z Funds viewer no print", builtIn: false, permissions: ["loans:view", "funds:ca_view", "funds:ft_view"] } });
  await db.user.create({ data: { email: "zz.noprint@gdfi.ph", name: "Zz No Print", roleId: role.id, isTestUser: true, allBranches: true } });
  await signInOther(page, "Zz No Print (Z Funds viewer no print)");
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator(`[data-advance="${DONE}"]`).first()).toBeAttached();
  await expect(page.locator("[data-print-link]")).toHaveCount(0);
  await page.goto("/funds?tab=history");
  await expect(page.locator("[data-print-link]")).toHaveCount(0);
  await page.goto(`/funds/${DONE}/print`);
  await expect(page.locator("[data-print-refused]")).toContainText("Ask an Admin to turn on ‘Print liquidation report for cash advances’ for your role.");
  await expect(page.locator("[data-liquidation-report]")).toHaveCount(0);
  await noSideways(page);
  await shot(page, "print-refused");
});

test("Role editor: the Print liquidation report tick, the Branch Supervisor role, Finance losing Move a hold", async ({ page }) => {
  const finRole = await db.role.findUniqueOrThrow({ where: { key: "FIN" } });
  const sup = await db.role.findUniqueOrThrow({ where: { key: "SUP" } });
  await signInAs(page, "admin");
  await page.goto(`/admin/settings?open=roles&edit=${finRole.id}`);
  const print = page.locator('[data-perm="funds:ca_print"]');
  await expect(print).toContainText("Print liquidation report for cash advances");
  await expect(print.getByRole("checkbox")).toBeChecked();
  await expect(page.locator('[data-perm="holds:transfer"]').getByRole("checkbox")).not.toBeChecked();
  await print.scrollIntoViewIfNeeded();
  await noSideways(page);
  await shot(page, "role-editor-funds-print");

  await page.goto(`/admin/settings?open=roles&edit=${sup.id}`);
  await expect(page.getByRole("dialog")).toContainText("Roles and access: Branch Supervisor");
  for (const k of ["loans:view", "loans:search", "holds:transfer", "problems:resolve_any", "monitor:dp", "monitor:lto", "reports:tat"]) {
    await expect(page.locator(`[data-perm="${k}"]`).getByRole("checkbox"), k).toBeChecked();
  }
  for (const k of ["funds:ca_approve", "funds:ft_release", "roles:manage", "users:edit", "branches:import", "settings:system"]) {
    await expect(page.locator(`[data-perm="${k}"]`).getByRole("checkbox"), k).not.toBeChecked();
  }
  await expect(page.locator('[data-perm="holds:transfer"]')).toContainText("Move a hold to another person");
  await page.locator('[data-perm="holds:transfer"]').scrollIntoViewIfNeeded();
  await noSideways(page);
  await shot(page, "role-editor-branch-supervisor");

  // Unticking "Move a hold to another person" on a Finance that still has it: who loses it, and the usual confirm.
  await db.role.update({ where: { id: finRole.id }, data: { permissions: [...finRole.permissions.filter((k) => k !== "holds:transfer"), "holds:transfer"] } });
  const users = await db.user.count({ where: { roleId: finRole.id, active: true } });
  await page.goto(`/admin/settings?open=roles&edit=${finRole.id}`);
  await page.locator('[data-perm="holds:transfer"]').getByRole("checkbox").uncheck();
  await expect(page.locator("[data-impact]")).toContainText(`${users} ${users === 1 ? "user loses" : "users lose"}: Move a hold to another person.`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Remove these permissions?");
  await expect(dlg.locator("[data-remove-confirm]")).toContainText("Finance loses: Move a hold to another person.");
  await dlg.getByRole("button", { name: "Keep editing" }).click();
});

test("Settings, Roles: 'N active branches have nobody who can move a hold', with the branches", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=roles");
  await expect(page.getByRole("dialog")).toContainText("Roles and access");
  await expect(page.locator("[data-hold-mover-health]")).toHaveCount(0); // Admin (All branches) can move holds everywhere
  // Without the tick on Admin, and no supervisors: every active branch has nobody.
  const admin = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  await db.role.update({ where: { id: admin.id }, data: { permissions: admin.permissions.filter((k) => k !== "holds:transfer") } });
  const active = await db.branch.count({ where: { active: true, hidden: false } });
  await page.reload();
  const line = page.locator("[data-hold-mover-health]");
  await expect(line).toContainText(`${active} active branches have nobody who can move a hold.`);
  await line.getByText("Show branches").click();
  await expect(line.locator("[data-hold-mover-branches] li")).toHaveCount(active);
  await expect(line.locator("[data-hold-mover-branches]")).toContainText("Angono");
  await noSideways(page);
  await shot(page, "hold-transfer-health-line");
  // A Branch Supervisor of Angono covers Angono.
  const sup = await db.role.findUniqueOrThrow({ where: { key: "SUP" } });
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await db.user.create({ data: { email: "zz.health.sup@gdfi.ph", name: "Zz Health Supervisor", roleId: sup.id, isTestUser: true, branches: { create: [{ branchId: angono.id }] } } });
  await page.reload();
  await expect(page.locator("[data-hold-mover-health]")).toContainText(`${active - 1} active branch`);
});

test("The Branch Supervisor moves a hold inside their branch, not outside it", async ({ page }) => {
  const { loan } = await fixtures();
  const sup = await db.role.findUniqueOrThrow({ where: { key: "SUP" } });
  const [angono, antipolo] = await Promise.all([db.branch.findUniqueOrThrow({ where: { code: "165" } }), db.branch.findUniqueOrThrow({ where: { code: "101" } })]);
  await db.user.create({ data: { email: "zz.sup.in@gdfi.ph", name: "Zz Angono Sup", roleId: sup.id, isTestUser: true, branches: { create: [{ branchId: angono.id }] } } });
  await db.user.create({ data: { email: "zz.sup.out@gdfi.ph", name: "Zz Antipolo Sup", roleId: sup.id, isTestUser: true, branches: { create: [{ branchId: antipolo.id }] } } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const reason = await db.holdReason.findFirstOrThrow({ where: { active: true } });
  await db.hold.create({ data: { loanId: loan.id, transactionId: loan.transactions[0].id, reasonId: reason.id, reasonName: reason.name, note: "Waiting for the client's papers", raisedById: la.id, raisedByLabel: la.name, ownerId: la.id, ownerLabel: la.name } });

  await signInOther(page, "Zz Angono Sup (Branch Supervisor)");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await expect(page.locator("[data-hold-summary] [data-transfer-hold]").filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("[data-hold-summary] [data-resume]")).toHaveCount(0);
  await noSideways(page);

  await signInOther(page, "Zz Antipolo Sup (Branch Supervisor)");
  const res = await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  expect(res?.status()).toBe(404);
  await expect(page.locator("[data-transfer-hold]")).toHaveCount(0);
});
