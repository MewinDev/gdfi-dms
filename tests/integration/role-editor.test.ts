/**
 * Settings > Roles, the editor's server side (test database only): the impact preview, the lock-out
 * protection, the last change on the role card and "Copy from another role". Custom roles start with
 * "Z", test users with "zz."; both are removed at the end, and built-in roles go back to their defaults.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS as P, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { checkRoleChange, lastRoleChanges, saveRole, setRoleActive } from "@/lib/services/roles";
import { setRowActive } from "@/lib/services/settings-status";
import { fmtDate } from "@/lib/time";
import { UserError } from "@/lib/services/errors";
import { asUser } from "./helpers";

let admin: CurrentUser;

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "role", summary: { contains: "Role Z" } } });
  await prisma.role.deleteMany({ where: { builtIn: false, name: { startsWith: "Z" } } });
  for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
    await prisma.role.update({ where: { key }, data: { permissions: [...d.permissions], branchAccess: d.branchAccess, description: d.description, active: true } });
  }
  await prisma.user.updateMany({ where: { email: "test.admin@gdfi.ph" }, data: { active: true } });
}

const refused = async (p: Promise<unknown>, msg: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(UserError);
  await expect(p).rejects.toThrow(msg);
};

/** A custom role with `n` active people (and one inactive person, who never counts). */
async function roleWithPeople(name: string, permissions: string[], n: number) {
  const roleId = await saveRole(admin, null, { name, description: "", branchAccess: "ALL", permissions });
  const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
  const ids: string[] = [];
  for (let i = 0; i <= n; i++) {
    const u = await prisma.user.create({ data: { email: `zz.${slug}.${i}@gdfi.ph`, name: `Zz ${name} ${i}`, roleId, isTestUser: true, allBranches: true, active: i < n } });
    ids.push(u.id);
  }
  return { roleId, userIds: ids.slice(0, n) };
}

beforeAll(async () => {
  process.env.TEST_MODE = "true";
  await cleanup();
  admin = await asUser("test.admin@gdfi.ph");
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("Impact preview", () => {
  it("counts the role's active people and names what they gain and lose", async () => {
    const { roleId } = await roleWithPeople("Z Impact", [P.LOANS_VIEW, P.MYLOANS_VIEW], 3);
    const gain = await checkRoleChange(admin, roleId, [P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH]);
    expect(gain.impact).toMatchObject({ users: 3, added: [P.LOANS_REFRESH], removed: [] });
    expect(gain.impact.text).toBe("3 users gain: Refresh a loan from MyLoans. 0 users lose anything.");
    expect(gain.lockout).toBeNull();
    const lose = await checkRoleChange(admin, roleId, [P.LOANS_VIEW]);
    expect(lose.impact.removed).toEqual([P.MYLOANS_VIEW]);
    expect(lose.impact.text).toBe("0 users gain anything. 3 users lose: See when MyLoans was last checked.");
    // Ticking a Change brings its View along, as the save does.
    const pair = await checkRoleChange(admin, roleId, [P.LOANS_VIEW, P.BRANCHES_MANAGE]);
    expect(pair.impact.added).toEqual([P.BRANCHES_VIEW, P.BRANCHES_MANAGE]);
    // A new role has nobody yet.
    expect((await checkRoleChange(admin, null, [P.LOANS_VIEW])).impact.users).toBe(0);
  });

  it("needs Manage roles", async () => {
    const la = await asUser("test.la@gdfi.ph");
    await refused(checkRoleChange(la, null, []), /roles/);
  });
});

describe("Lock-out protection", () => {
  it("the editor's own role cannot lose Manage roles", async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const r = await checkRoleChange(admin, adminRole.id, ROLE_DEFAULTS.ADMIN.permissions.filter((k) => k !== P.ROLES_MANAGE));
    expect(r.lockout).toMatch(/your own role/);
    await refused(saveRole(admin, adminRole.id, { name: "Admin", description: "", branchAccess: "ALL", permissions: ROLE_DEFAULTS.ADMIN.permissions.filter((k) => k !== P.ROLES_MANAGE) }), /your own role/);
  });

  it("the last role that can manage roles keeps the tick, with the reason", async () => {
    const { roleId, userIds } = await roleWithPeople("Z Role Keeper", [P.USERS_VIEW, P.ROLES_MANAGE], 1);
    const keeper = await asUser((await prisma.user.findUniqueOrThrow({ where: { id: userIds[0] } })).email);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    // The keeper takes Manage roles off Admin: allowed, the keeper's role still has it.
    await saveRole(keeper, adminRole.id, { name: "Admin", description: adminRole.description, branchAccess: "ALL", permissions: ROLE_DEFAULTS.ADMIN.permissions.filter((k) => k !== P.ROLES_MANAGE) });
    // Now Admin cannot take it off the keeper's role: it is the last one.
    const r = await checkRoleChange(admin, roleId, [P.USERS_VIEW]);
    expect(r.lockout).toBe('Z Role Keeper is the last role that can manage roles. Keep "Manage roles" ticked, or tick it on another role first.');
    await refused(saveRole(admin, roleId, { name: "Z Role Keeper", description: "", branchAccess: "ALL", permissions: [P.USERS_VIEW] }), /last role that can manage roles/);
    // Nor make it inactive.
    expect((await checkRoleChange(admin, roleId, [P.USERS_VIEW, P.ROLES_MANAGE], false)).lockout).toMatch(/last role that can manage roles/);
    await prisma.user.deleteMany({ where: { roleId } });
    await refused(setRoleActive(admin, roleId, false), /last role that can manage roles/);
  });

  it("the last active person who can change branch access cannot be made inactive", async () => {
    const { userIds } = await roleWithPeople("Z Access Keeper", [P.USERS_VIEW, P.USERS_EDIT, P.ACCESS_MANAGE], 1);
    // Every Admin inactive: the keeper is the only active person with Change branch access.
    await prisma.user.updateMany({ where: { role: { key: "ADMIN" } }, data: { active: false } });
    await refused(setRowActive(admin, "user", userIds[0], false), /last active person who can change branch access/);
    // And their role cannot lose the tick.
    const role = await prisma.role.findFirstOrThrow({ where: { name: "Z Access Keeper" } });
    expect((await checkRoleChange(admin, role.id, [P.USERS_VIEW, P.USERS_EDIT])).lockout).toMatch(/Nobody active could change branch access|last role/);
  });
});

describe("Role card: the last change", () => {
  it("shows the date, who and what was added or removed", async () => {
    const { roleId } = await roleWithPeople("Z Card", [P.LOANS_VIEW, P.MYLOANS_VIEW], 1);
    await saveRole(admin, roleId, { name: "Z Card", description: "", branchAccess: "ALL", permissions: [P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH] });
    const last = await lastRoleChanges([roleId]);
    expect(last.get(roleId)).toBe(`Last changed ${fmtDate(new Date())} by ${admin.name}: added Refresh a loan from MyLoans`);
    await saveRole(admin, roleId, { name: "Z Card", description: "", branchAccess: "ALL", permissions: [P.LOANS_VIEW] });
    expect((await lastRoleChanges([roleId])).get(roleId)).toMatch(/: removed See when MyLoans was last checked, Refresh a loan from MyLoans$/);
  });
});

describe("Copy from another role", () => {
  it("a new role starts with the copied ticks; the audit row says where they came from", async () => {
    const la = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    const id = await saveRole(admin, null, { name: "Z Copied LA", description: "", branchAccess: la.branchAccess, permissions: la.permissions, copiedFromId: la.id });
    const r = await prisma.role.findUniqueOrThrow({ where: { id } });
    expect([...r.permissions].sort()).toEqual([...la.permissions].sort());
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "role", entityId: id, action: "role_created" } });
    expect(row.summary).toContain("Added role Z Copied LA (copied from Loan Associate)");
    expect((row.details as { copiedFrom?: string }).copiedFrom).toBe(la.id);
    await prisma.auditLog.deleteMany({ where: { entityId: id } });
  });
});
