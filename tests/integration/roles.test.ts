/**
 * Roles and access (LOCAL database only). Custom roles start with "Z", test users with "zz.";
 * both are removed at the end (test clean-up only). Built-in roles are reset to default after.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS as P, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { testProvider } from "@/lib/auth/providers";
import { accessMatrixCsv, duplicateRole, resetRoleToDefault, saveRole, setRoleActive } from "@/lib/services/roles";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, markLabelsPrinted, saveChecklist } from "@/lib/services/workflow";
import { saveSettingsRow, saveUser } from "@/lib/services/admin";
import { saveUserAccess } from "@/lib/services/access";
import { setRowActive } from "@/lib/services/settings-status";
import { getLoanForUser } from "@/lib/services/queries";
import { checkImport } from "@/lib/import/importer";
import { parseCsv, toCsv } from "@/lib/import/csv";
import { UserError } from "@/lib/services/errors";
import { asUser, cleanLoans } from "./helpers";

let admin: CurrentUser;
let la: CurrentUser;

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.role.deleteMany({ where: { builtIn: false, name: { startsWith: "Z" } } });
  await prisma.role.deleteMany({ where: { builtIn: false, name: { startsWith: "Copy of" } } });
  for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
    await prisma.role.update({ where: { key }, data: { permissions: [...d.permissions], branchAccess: d.branchAccess, description: d.description, active: true } });
  }
  await prisma.user.updateMany({ where: { email: "test.admin@gdfi.ph" }, data: { active: true } });
}

const refused = async (p: Promise<unknown>, msg: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(UserError);
  await expect(p).rejects.toThrow(msg);
};

beforeAll(async () => {
  await cleanup();
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
});
afterAll(async () => {
  await cleanLoans();
  await cleanup();
  await prisma.$disconnect();
});

/** A custom role and a test user who has it (Antipolo). */
async function customUser(name: string, permissions: string[], branchAccess: "ASSIGNED" | "ALL" = "ASSIGNED") {
  const roleId = await saveRole(admin, null, { name, description: "", branchAccess, permissions });
  const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
  const email = `zz.${name.toLowerCase().replace(/[^a-z]+/g, ".")}@gdfi.ph`;
  await saveUser(admin, null, { name: `Zed ${name}`, email, roleId, active: true, branchIds: [qc.id] });
  return { roleId, user: await asUser(email) };
}

describe("Seeded roles after the migration", () => {
  it("match the defaults (same abilities as before)", async () => {
    for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
      const r = await prisma.role.findUniqueOrThrow({ where: { key } });
      expect([key, r.builtIn, r.branchAccess, [...effectivePermissions(r)].sort()]).toEqual([key, true, d.branchAccess, [...d.permissions].sort()]);
    }
  });
});

describe("A custom role grants and denies on the server", () => {
  it("five actions across areas", async () => {
    const { user } = await customUser("Z Angono Reviewer", [P.LOANS_VIEW, P.LOANS_SEARCH, P.CHECKLIST_TICK, P.LABELS_PRINT]);
    expect(user.permissions.has(P.LABELS_PRINT)).toBe(true);

    // Allowed: find a loan (MyLoans preview).
    expect((await lookupPn(user, "GD1012026901001")).kind).toBe("preview");
    // Refused: open a loan file (no "Open a loan file").
    await refused(openLoanFile(user, { pn: "GD1012026901001" }), /does not allow opening loan files/);

    await openLoanFile(la, { pn: "GD1012026901001" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" }, include: { transactions: { include: { type: true, checks: true } } } });
    const notary = loan.transactions.find((t) => t.type.code === "NOTARY")!;
    // Allowed: tick papers.
    await saveChecklist(user, { transactionId: notary.id, checkedIds: [notary.checks[0].id], newOthers: [] });
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: notary.checks[0].id } })).checked).toBe(true);
    // Allowed: print labels.
    const doc = await prisma.documentItem.findFirstOrThrow({ where: { checkId: notary.checks[0].id } });
    await markLabelsPrinted(user, [doc.id]);
    // Refused: send to a processor.
    const dp = await prisma.user.findFirstOrThrow({ where: { email: "dp.joy@gdfi.ph" } });
    await refused(assignToDp(user, { transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id } as never), /does not allow this step/);
    // Refused: Settings and Users.
    await refused(saveSettingsRow(user, "holiday", null, { date: "2099-03-03", name: "Nope" }), /does not allow changing this part of Settings/);
    await refused(saveUser(user, null, { name: "X", email: "zz.x@gdfi.ph", roleId: user.id, active: true, branchIds: [] }), /does not allow adding or editing users/);
  });

  it("Branch access is per user; the role's branch access is only the default for new users", async () => {
    const { roleId, user } = await customUser("Z Viewer", [P.LOANS_VIEW]);
    await openLoanFile(la, { pn: "GD1652026901004", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }); // Angono, Financing
    expect(user.scopeBranchIds).not.toBeNull();
    expect(await getLoanForUser(user, "GD1652026901004")).toBeNull();
    // Changing the role's default does not change existing people.
    await saveRole(admin, roleId, { name: "Z Viewer", description: "", branchAccess: "ALL", permissions: [P.LOANS_VIEW] });
    expect((await asUser(user.email)).scopeBranchIds).not.toBeNull();
    // The person's own access does.
    await saveUserAccess(admin, user.id, { all: true, grants: [], homeBranchId: null });
    const again = await asUser(user.email);
    expect(again.scopeBranchIds).toBeNull();
    expect(await getLoanForUser(again, "GD1652026901004")).not.toBeNull();
    // A new user of the role starts with the role's default (All).
    await saveUser(admin, null, { name: "Zed New Viewer", email: "zz.new.viewer@gdfi.ph", roleId, active: true });
    expect((await asUser("zz.new.viewer@gdfi.ph")).scopeBranchIds).toBeNull();
  });

  it("custom-role test users sign in only in test mode", async () => {
    const { user } = await customUser("Z Signer", [P.LOANS_VIEW]);
    process.env.TEST_MODE = "true";
    expect(await testProvider.resolveUser(user.email)).not.toBeNull();
    process.env.TEST_MODE = "false";
    expect(await testProvider.resolveUser(user.email)).toBeNull();
    process.env.TEST_MODE = "true";
    // Built-in non-sign-in roles stay as before.
    expect(await testProvider.resolveUser("dp.joy@gdfi.ph")).toBeNull();
  });

  it("processors: a custom role appears only with \"Receive and process transactions\"", async () => {
    const { user } = await customUser("Z Processor", [P.LOANS_VIEW, P.DP_RECEIVE]);
    const { recommendDp } = await import("@/lib/services/workflow");
    const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    const role = await prisma.role.findFirstOrThrow({ where: { name: "Z Processor" } });
    // Fewest open jobs wins: the new processor has none, like the seeded ones; it is now a candidate.
    const candidates = await prisma.user.findMany({ where: { active: true, role: { active: true, permissions: { has: P.DP_RECEIVE } }, branches: { some: { branchId: qc.id } } } });
    expect(candidates.map((c) => c.id)).toContain(user.id);
    await saveRole(admin, role.id, { name: "Z Processor", description: "", branchAccess: "ASSIGNED", permissions: [P.LOANS_VIEW] });
    const after = await prisma.user.findMany({ where: { active: true, role: { active: true, permissions: { has: P.DP_RECEIVE } }, branches: { some: { branchId: qc.id } } } });
    expect(after.map((c) => c.id)).not.toContain(user.id);
    expect(await recommendDp(qc.id)).not.toBeNull();
  });
});

describe("Safety rules", () => {
  it("Admin is locked", async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    await refused(saveRole(admin, adminRole.id, { name: "Admin", description: adminRole.description, branchAccess: "ALL", permissions: [P.LOANS_VIEW] }), /Admin is locked/);
    await refused(setRoleActive(admin, adminRole.id, false), /locked/);
    await refused(saveRole(admin, adminRole.id, { name: "Administrator", description: "", branchAccess: "ALL", permissions: [] }), /Built-in role names cannot be changed/);
  });

  it("cannot remove your own ability; the last people who can manage roles keep it", async () => {
    const { roleId, user: manager } = await customUser("Z Access Manager", [P.USERS_VIEW, P.ROLES_MANAGE]);
    await refused(saveRole(manager, roleId, { name: "Z Access Manager", description: "", branchAccess: "ASSIGNED", permissions: [P.USERS_VIEW] }), /cannot remove your own ability/);
    // With every Admin inactive, the custom role is the last way to manage roles.
    await prisma.user.updateMany({ where: { role: { key: "ADMIN" } }, data: { active: false } });
    try {
      await refused(saveRole(admin, roleId, { name: "Z Access Manager", description: "", branchAccess: "ASSIGNED", permissions: [P.USERS_VIEW] }), /Nobody else could manage roles/);
      await refused(setRowActive(admin, "user", manager.id, false), /last active person who can manage roles/);
    } finally {
      await prisma.user.updateMany({ where: { email: "test.admin@gdfi.ph" }, data: { active: true } });
    }
    // With an Admin active again, it may be removed.
    await saveRole(admin, roleId, { name: "Z Access Manager", description: "", branchAccess: "ASSIGNED", permissions: [P.USERS_VIEW] });
  });

  it("the last active Admin cannot be moved to another role", async () => {
    const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    await refused(saveUser(admin, admin.id, { name: admin.name, email: admin.email, roleId: laRole.id, active: true, branchIds: [] }), /own Admin role/);
  });
});

describe("Duplicate, rename, inactive, reset, audit, matrix", () => {
  it("duplicate makes a custom copy; names are unique ignoring case", async () => {
    const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    const copyId = await duplicateRole(admin, laRole.id);
    const copy = await prisma.role.findUniqueOrThrow({ where: { id: copyId } });
    expect([copy.name, copy.builtIn, [...copy.permissions].sort()]).toEqual(["Copy of Loan Associate", false, [...ROLE_DEFAULTS.LA.permissions].sort()]);
    await refused(saveRole(admin, copyId, { name: "loan associate", description: "", branchAccess: "ASSIGNED", permissions: [] }), /already exists/);
    await refused(saveRole(admin, null, { name: "Z", description: "", branchAccess: "ASSIGNED", permissions: [] }), /at least 2 characters/);
    await saveRole(admin, copyId, { name: "Z Renamed Copy", description: "", branchAccess: "ASSIGNED", permissions: copy.permissions });
    expect((await prisma.role.findUniqueOrThrow({ where: { id: copyId } })).name).toBe("Z Renamed Copy");
  });

  it("a role with people cannot be made inactive until they are moved", async () => {
    const { roleId, user } = await customUser("Z Temp", [P.LOANS_VIEW]);
    await refused(setRoleActive(admin, roleId, false), /1 person has this role/);
    const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    await saveUser(admin, user.id, { name: user.name, email: user.email, roleId: laRole.id, active: true, branchIds: [qc.id] });
    await setRoleActive(admin, roleId, false);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).active).toBe(false);
    // Inactive roles cannot be given to anyone.
    await refused(saveUser(admin, user.id, { name: user.name, email: user.email, roleId, active: true, branchIds: [qc.id] }), /inactive/);
  });

  it("one audit row per change, with the exact permissions added and removed; reset to default", async () => {
    const roleId = await saveRole(admin, null, { name: "Z Angono Checker", description: "", branchAccess: "ASSIGNED", permissions: [P.LOANS_VIEW, P.CHECKLIST_TICK, P.TXN_ADD] });
    const before = await prisma.auditLog.count({ where: { entityId: roleId } });
    await saveRole(admin, roleId, { name: "Z Angono Checker", description: "", branchAccess: "ASSIGNED", permissions: [P.LOANS_VIEW, P.CHECKLIST_TICK, P.LABELS_PRINT] });
    const rows = await prisma.auditLog.findMany({ where: { entityId: roleId }, orderBy: { at: "asc" } });
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.summary).toBe("Role Z Angono Checker: added Print labels; removed Add a transaction");
    expect(rows.at(-1)!.actorId).toBe(admin.id);
    // Saving with no change writes nothing.
    await saveRole(admin, roleId, { name: "Z Angono Checker", description: "", branchAccess: "ASSIGNED", permissions: [P.LOANS_VIEW, P.CHECKLIST_TICK, P.LABELS_PRINT] });
    expect(await prisma.auditLog.count({ where: { entityId: roleId } })).toBe(before + 1);

    const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    await saveRole(admin, laRole.id, { name: "Loan Associate", description: laRole.description, branchAccess: "ASSIGNED", permissions: ROLE_DEFAULTS.LA.permissions.filter((k) => k !== P.LABELS_PRINT) });
    expect((await prisma.role.findUniqueOrThrow({ where: { id: laRole.id } })).permissions).not.toContain(P.LABELS_PRINT);
    await resetRoleToDefault(admin, laRole.id);
    expect([...(await prisma.role.findUniqueOrThrow({ where: { id: laRole.id } })).permissions].sort()).toEqual([...ROLE_DEFAULTS.LA.permissions].sort());
    const last = await prisma.auditLog.findFirstOrThrow({ where: { entityId: laRole.id }, orderBy: { at: "desc" } });
    expect(last.summary).toBe("Role Loan Associate reset to default: added Print labels");
  });

  it("the access matrix matches the data", async () => {
    const rows = parseCsv(await accessMatrixCsv());
    const header = rows[0];
    const roles = await prisma.role.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    expect(header.slice(0, 3)).toEqual(["area", "permission", "key"]);
    expect(header.length).toBe(3 + roles.length);
    for (const row of rows.slice(1).filter((r) => r[2] !== "branch_access")) {
      roles.forEach((r, i) => expect([r.key, row[2], row[3 + i]]).toEqual([r.key, row[2], effectivePermissions(r).has(row[2] as never) ? "Yes" : "No"]));
    }
  });

  it("user import accepts custom role names (any case) and refuses unknown roles plainly", async () => {
    await saveRole(admin, null, { name: "Z Importable Role", description: "", branchAccess: "ASSIGNED", permissions: [P.LOANS_VIEW] });
    const plan = await checkImport(admin, "users", "u.csv", toCsv(["name", "email", "role", "branches", "status"], [
      { name: "Zed One", email: "zz.one@gdfi.ph", role: "z importable role", branches: "101", status: "Active" },
      { name: "Zed Two", email: "zz.two@gdfi.ph", role: "Wizard", branches: "101", status: "Active" },
    ]));
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.rows[0].action).toBe("new");
    expect(plan.rows[1].problems).toEqual(['Row 3, Role: no role is called "Wizard". Use a role name from Settings > Roles and access.']);
  });
});
