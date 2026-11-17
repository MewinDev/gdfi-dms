/**
 * Piece 2, permission core (D-008 to D-011, D-019, D-023, D-024). LOCAL test database.
 *   - override precedence (role tick, GRANT, DENY) and the fund-type ticks, on real users;
 *   - "who holds X" (holdsWhere) follows the overrides;
 *   - edit rights: overrides and the approver tick (Superadmin), All branches (Superadmin), branches and
 *     CA / FT (Admin and Superadmin), no role escalation, nobody edits their own; all audited;
 *   - the last holder of "Manage permissions" cannot be denied it; the matrix keeps someone with it;
 *   - every built-in role x another branch: list, count, detail and files are blocked;
 *   - the D-010 role migration keeps each moved person's abilities.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/current-user";
import { PERMISSIONS as P, ROLE_DEFAULTS, OPEN_ITEM_APPROVER_KEYS, SUP_DEFAULT_BEFORE_D029 } from "@/lib/auth/permissions";
import { holdsWhere } from "@/lib/auth/holders";
import { canFunds, typeWhere } from "@/lib/funds/access";
import { loanScope } from "@/lib/auth/scope";
import { saveUser } from "@/lib/services/admin";
import { saveUserAccess } from "@/lib/services/access";
import { saveFundTypeTicks, saveUserOverrides, setOpenItemApprover } from "@/lib/services/user-rights";
import { saveRoleMatrix } from "@/lib/services/roles";
import { getLoanForUser, listLoans } from "@/lib/services/queries";
import { mayOpenReceipt, mayOpenStageFile } from "@/lib/services/file-access";
import { MIGRATION_NOTE, planRoleMigration } from "@/lib/services/role-migration";
import { userPermissions } from "@/lib/auth/effective";
import { applyChange, lockoutRefusal, type AccessSnapshot } from "@/lib/services/lockout";
import { asUser, cleanLoans } from "./helpers";

const DOMAIN = "@gdfi.ph";
const em = (slug: string) => `zz.pc.${slug}${DOMAIN}`;
let superadmin: CurrentUser;
let admin: CurrentUser;
let b101 = "";
let b390 = "";
const PN_A = "GD1012026907951"; // branch 101 (in scope)
const PN_B = "GD3902026907952"; // branch 390 (out of scope)

async function roleId(key: string) {
  return (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
}
/** A test person on a role, with branch 101 only (or All), and optional ticks. */
async function person(slug: string, roleKey: string, o: { all?: boolean; ca?: boolean; ft?: boolean } = {}) {
  const email = em(slug);
  await prisma.userPermissionOverride.deleteMany({ where: { user: { email } } });
  const u = await prisma.user.upsert({
    where: { email },
    create: { email, name: `Zz ${slug}`, roleId: await roleId(roleKey), isTestUser: true, allBranches: !!o.all, handlesCa: !!o.ca, handlesFt: !!o.ft },
    update: { roleId: await roleId(roleKey), active: true, allBranches: !!o.all, handlesCa: !!o.ca, handlesFt: !!o.ft },
  });
  await prisma.userBranch.deleteMany({ where: { userId: u.id } });
  await prisma.userAccessGrant.deleteMany({ where: { userId: u.id } });
  if (!o.all) {
    await prisma.userAccessGrant.create({ data: { userId: u.id, kind: "BRANCH", branchId: b101 } });
    await prisma.userBranch.create({ data: { userId: u.id, branchId: b101 } });
  }
  return asUser(email);
}

beforeAll(async () => {
  await cleanLoans();
  b101 = (await prisma.branch.findUniqueOrThrow({ where: { code: "101" } })).id;
  b390 = (await prisma.branch.findUniqueOrThrow({ where: { code: "390" } })).id;
  superadmin = await asUser("test.superadmin@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  const now = new Date();
  for (const [pn, branchId] of [[PN_A, b101], [PN_B, b390]] as const) {
    await prisma.loan.create({
      data: {
        pn, cin: null, cif: null, borrowerName: `Scope Sample ${pn.slice(-1)}`, branchId, loanType: "New", productName: "Auto Financing",
        totalReleasedAmount: 300_000, releasedAt: now, sourceStatus: "RELEASED", retrievedAt: now, openedById: admin.id,
        classification: "FINANCING", mortgageResult: "NOT_MORTGAGE", ruleFired: "test", stage: "For checklist",
      },
    });
  }
});

afterAll(async () => {
  await cleanLoans();
  await prisma.userPermissionOverride.deleteMany({ where: { user: { email: { startsWith: "zz.pc." } } } });
  await prisma.$disconnect();
});

describe("effective permissions on real users (role + GRANT - DENY, then CA / FT ticks)", () => {
  it("a DENY removes a role tick; a GRANT adds one; DENY wins", async () => {
    const u = await person("la1", "LA");
    expect(can(u, P.LOANS_REFRESH)).toBe(true);
    await saveUserOverrides(superadmin, u.id, [{ key: P.LOANS_REFRESH, value: "DENY", note: "Test deny" }, { key: P.REPORTS_TAT, value: "GRANT", note: "Test grant" }]);
    const after = await asUser(u.email);
    expect(can(after, P.LOANS_REFRESH)).toBe(false);
    expect(can(after, P.REPORTS_TAT)).toBe(true);
    await saveUserOverrides(superadmin, u.id, [{ key: P.REPORTS_TAT, value: "DENY", note: "Now denied" }]);
    expect(can(await asUser(u.email), P.REPORTS_TAT)).toBe(false);
    await saveUserOverrides(superadmin, u.id, [{ key: P.LOANS_REFRESH, value: "INHERIT" }, { key: P.REPORTS_TAT, value: "INHERIT" }]);
    expect(can(await asUser(u.email), P.LOANS_REFRESH)).toBe(true);
  });

  it("Finance sees and approves only the fund types ticked on the person", async () => {
    const ca = await person("fin.ca", "FIN", { all: true, ca: true });
    expect(canFunds(ca, "view", { fundsTypeId: "fundstype_ca" })).toBe(true);
    expect(canFunds(ca, "approve", { fundsTypeId: "fundstype_ft" })).toBe(false);
    expect(typeWhere(ca)).toEqual({ fundsTypeId: { notIn: ["fundstype_ft"] } });
    const none = await person("fin.none", "FIN", { all: true });
    expect(canFunds(none, "view", { fundsTypeId: "fundstype_ca" })).toBe(false);
  });

  it("holdsWhere follows the overrides (a granted DP is a processor; a denied one is not)", async () => {
    const la = await person("la2", "LA");
    const dp = await person("dp1", "DP");
    const ids = async () => (await prisma.user.findMany({ where: holdsWhere(P.DP_RECEIVE), select: { id: true } })).map((r) => r.id);
    expect(await ids()).toContain(dp.id);
    expect(await ids()).not.toContain(la.id);
    await saveUserOverrides(superadmin, la.id, [{ key: P.DP_RECEIVE, value: "GRANT", note: "Covers DP work" }]);
    await saveUserOverrides(superadmin, dp.id, [{ key: P.DP_RECEIVE, value: "DENY", note: "No DP work" }]);
    expect(await ids()).toContain(la.id);
    expect(await ids()).not.toContain(dp.id);
  });
});

describe("edit rights (D-023): who may change what; never your own", () => {
  it("only someone who can manage permissions sets overrides and the approver tick", async () => {
    const la = await person("la3", "LA");
    await expect(saveUserOverrides(admin, la.id, [{ key: P.REPORTS_TAT, value: "GRANT", note: "Admin tries" }])).rejects.toThrow(/manage permissions/i);
    await expect(setOpenItemApprover(admin, la.id, "GRANT", "Admin tries")).rejects.toThrow(/manage permissions/i);
    await setOpenItemApprover(superadmin, la.id, "GRANT", "Covers the branch");
    const after = await asUser(la.email);
    expect(OPEN_ITEM_APPROVER_KEYS.every((k) => can(after, k))).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "permissions_overridden", entityId: la.id }, orderBy: { at: "desc" } });
    expect(audit?.summary).toMatch(/Granted/);
  });

  it("an override needs a reason", async () => {
    const la = await person("la4", "LA");
    await expect(saveUserOverrides(superadmin, la.id, [{ key: P.REPORTS_TAT, value: "GRANT", note: "" }])).rejects.toThrow(/Say why/);
  });

  it("nobody changes their own permissions, role, branch access or fund types", async () => {
    await expect(saveUserOverrides(superadmin, superadmin.id, [{ key: P.REPORTS_TAT, value: "DENY", note: "Self" }])).rejects.toThrow(/your own/);
    await expect(saveUserAccess(admin, admin.id, { all: false, grants: [{ kind: "BRANCH", branchId: b101, divisionId: null, areaId: null, exclude: false }], homeBranchId: b101 })).rejects.toThrow(/your own/);
    await expect(saveFundTypeTicks(admin, admin.id, { handlesCa: false, handlesFt: false })).rejects.toThrow(/your own/);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    await expect(saveUser(admin, admin.id, { name: me.name, email: me.email, roleId: await roleId("LA"), active: "on" })).rejects.toThrow(/your own role/);
  });

  it("All branches is the Superadmin's; specific branches and CA / FT are the Admin's too", async () => {
    const fin = await person("fin2", "FIN", { ca: true });
    await expect(saveUserAccess(admin, fin.id, { all: true, grants: [], homeBranchId: null })).rejects.toThrow(/All branches/);
    await saveUserAccess(admin, fin.id, { all: false, grants: [{ kind: "BRANCH", branchId: b390, divisionId: null, areaId: null, exclude: false }], homeBranchId: null });
    await saveFundTypeTicks(admin, fin.id, { handlesCa: true, handlesFt: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fin.id } })).handlesFt).toBe(true);
    await saveUserAccess(superadmin, fin.id, { all: true, grants: [], homeBranchId: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fin.id } })).allBranches).toBe(true);
  });

  it("no role escalation: an Admin cannot give the Superadmin role; a new Admin-made user does not get All branches", async () => {
    await expect(saveUser(admin, null, { name: "Zz Escalate", email: em("escalate"), roleId: await roleId("SUPERADMIN"), active: "on" })).rejects.toThrow(/cannot give the role/);
    await prisma.user.deleteMany({ where: { email: em("newfin") } });
    await saveUser(admin, null, { name: "Zz New Fin", email: em("newfin"), roleId: await roleId("FIN"), active: "on" });
    const made = await prisma.user.findUniqueOrThrow({ where: { email: em("newfin") } });
    expect(made.allBranches).toBe(false); // Finance defaults to All, but only the Superadmin gives it
    expect(made.handlesCa || made.handlesFt).toBe(false); // a new person handles no fund type until ticked
  });
});

describe("lock-out: someone always keeps Manage permissions", () => {
  it("the last active holder cannot lose it through a DENY; a GRANT counts as holding it", () => {
    const keys = new Set<string>([P.ROLES_MANAGE, P.USERS_VIEW, P.USERS_EDIT, P.ACCESS_MANAGE]);
    const person = (roleId: string) => ({ active: true, roleId, overrides: [] as { key: string; effect: "GRANT" | "DENY" }[], handlesCa: false, handlesFt: false });
    const snap: AccessSnapshot = {
      roles: new Map([["r-sa", { name: "Superadmin", active: true, permissions: keys }], ["r-la", { name: "LA", active: true, permissions: new Set<string>([P.LOANS_VIEW]) }]]),
      users: new Map([["u1", person("r-sa")], ["u2", person("r-sa")]]),
    };
    const deny = [{ key: P.ROLES_MANAGE, effect: "DENY" as const }];
    expect(lockoutRefusal(snap, { kind: "user", userId: "u1", overrides: deny })).toBeNull(); // u2 still holds it
    const lastOne = applyChange(snap, { kind: "user", userId: "u2", active: false });
    expect(lockoutRefusal(lastOne, { kind: "user", userId: "u1", overrides: deny })).toMatch(/last active person who can manage permissions/);
    // An LA granted it is a holder too: then u1 may be denied.
    const granted = applyChange(lastOne, { kind: "user", userId: "u3", roleId: "r-la", overrides: [{ key: P.ROLES_MANAGE, effect: "GRANT" }] });
    expect(lockoutRefusal(granted, { kind: "user", userId: "u1", overrides: deny })).toBeNull();
  });

  it("the matrix refuses to take Manage permissions from your own role, or from every role", async () => {
    const sa = await prisma.role.findUniqueOrThrow({ where: { key: "SUPERADMIN" } });
    await expect(saveRoleMatrix(superadmin, [{ roleId: sa.id, permissions: sa.permissions.filter((k) => k !== P.ROLES_MANAGE) }])).rejects.toThrow(/your own role/);
    await expect(saveRoleMatrix(admin, [])).rejects.toThrow();
  });
});

describe("every built-in role x another branch: list, count, detail and files are blocked (D-019)", () => {
  for (const key of Object.keys(ROLE_DEFAULTS)) {
    it(`${key} with branch 101 only cannot reach branch 390`, async () => {
      const u = await person(`scope.${key.toLowerCase()}`, key, { ca: true, ft: true });
      if (can(u, P.LOANS_VIEW)) {
        const rows = await listLoans(u, {} as never);
        expect(rows.map((r) => r.pn)).not.toContain(PN_B);
        expect(rows.map((r) => r.pn)).toContain(PN_A);
      }
      // Detail: out of scope is "not found".
      expect(await getLoanForUser(u, PN_B)).toBeNull();
      // Counts (the Finance Home and the Funds page use this scope).
      const advance = await prisma.cashAdvance.upsert({
        where: { number: "CA-2026-9907" },
        create: { number: "CA-2026-9907", requestedById: admin.id, branchId: b390, requestedCents: 100_00 },
        update: {},
      });
      expect(await prisma.cashAdvance.count({ where: { id: advance.id, ...loanScope(u), ...typeWhere(u) } })).toBe(0);
      // Files: a receipt of a branch-390 advance, and stage evidence of a branch-390 job.
      expect(mayOpenReceipt(u, advance)).toBe(false);
      expect(mayOpenStageFile(u, { dpUserId: admin.id, secondaryDpUserId: null, dpBranchId: b390, loan: { branchId: b390 } })).toBe(false);
    });
  }

  it("the same person sees their own branch (sanity)", async () => {
    const fin = await person("scope.fin.own", "FIN", { ca: true });
    const advance = await prisma.cashAdvance.upsert({ where: { number: "CA-2026-9908" }, create: { number: "CA-2026-9908", requestedById: admin.id, branchId: b101, requestedCents: 100_00 }, update: {} });
    expect(mayOpenReceipt(fin, advance)).toBe(true);
    expect(await prisma.cashAdvance.count({ where: { id: advance.id, ...loanScope(fin), ...typeWhere(fin) } })).toBe(1);
    await prisma.cashAdvance.deleteMany({ where: { number: { in: ["CA-2026-9907", "CA-2026-9908"] } } });
  });
});

describe("D-010 role migration keeps each moved person's abilities", () => {
  const role = (id: string, key: string, permissions: string[], builtIn = false) => ({ id, key, name: key, builtIn, active: true, permissions });
  const user = (id: string, roleId: string) => ({ id, name: id, email: `${id}@x`, active: true, roleId, handlesCa: false, handlesFt: false, permissionOverrides: [] as { key: string; effect: string; note?: string }[] });

  it("approver and per-type Finance roles -> Finance, exactly the same abilities", () => {
    const fin = role("r-fin", "FIN", ROLE_DEFAULTS.FIN.permissions, true);
    const apprCa = role("r-a", "C_APPROVER_CA", [P.LOANS_VIEW, P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_EDIT_LINES]);
    const finFt = role("r-f", "C_FIN_FT", [P.LOANS_VIEW, P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE]);
    const plan = planRoleMigration([fin, apprCa, finFt], [user("u1", "r-a"), user("u2", "r-f")]);
    for (const [uid, old] of [["u1", apprCa], ["u2", finFt]] as const) {
      const m = plan.moves.find((x) => x.userId === uid)!;
      expect(m.toRoleKey).toBe("FIN");
      const before = userPermissions(old.permissions, [], { handlesCa: true, handlesFt: true });
      const after = userPermissions(fin.permissions, [...m.grants.map((key) => ({ key, effect: "GRANT" as const })), ...m.denies.map((key) => ({ key, effect: "DENY" as const }))], m.ticks!);
      expect([...after].sort()).toEqual([...before].sort());
    }
    expect(plan.roleUpdates.filter((r) => r.deactivate).map((r) => r.key).sort()).toEqual(["C_APPROVER_CA", "C_FIN_FT"]);
  });

  it("D-029: the old Branch Supervisor role gets today's LA Supervisor/Head default (moves holds); no per-person grants; earlier grants are removed and listed", () => {
    const sup = { ...role("r-s", "SUP", [P.LOANS_VIEW, P.LOANS_SEARCH, P.HOLDS_TRANSFER, P.PROBLEMS_RESOLVE_ANY, P.REPORTS_TAT], true), name: "Branch Supervisor" };
    const plan = planRoleMigration([sup], [user("u3", "r-s")]);
    expect(plan.moves.find((x) => x.userId === "u3")).toBeUndefined();
    expect(plan.roleUpdates.find((r) => r.key === "SUP")).toMatchObject({ name: "LA Supervisor/Head", permissions: ROLE_DEFAULTS.SUP.permissions });
    expect(ROLE_DEFAULTS.SUP.permissions).toContain(P.HOLDS_TRANSFER);
    // Someone the earlier run gave grants to: removed and listed.
    const withGrants = { ...user("u4", "r-s"), permissionOverrides: [{ key: P.REPORTS_TAT, effect: "GRANT", note: MIGRATION_NOTE }, { key: P.MONITOR_DP, effect: "GRANT", note: "Given by hand" }] };
    const again = planRoleMigration([{ ...sup, name: "LA Supervisor/Head", permissions: SUP_DEFAULT_BEFORE_D029 }], [withGrants]);
    expect(again.removals).toEqual([expect.objectContaining({ userId: "u4", keys: [P.REPORTS_TAT] })]); // a hand-given grant stays
    expect(again.roleUpdates.find((r) => r.key === "SUP")!.permissions).toContain(P.HOLDS_TRANSFER);
    // A role someone changed by hand keeps its ticks.
    const custom = planRoleMigration([{ ...sup, name: "LA Supervisor/Head", permissions: [P.LOANS_VIEW] }], []);
    expect(custom.roleUpdates.find((r) => r.key === "SUP")).toBeUndefined();
  });

  it("D-028: the Superadmin default has no day-to-day action; one active Superadmin is warned", () => {
    for (const k of [P.FUNDS_CA_APPROVE, P.FUNDS_FT_RELEASE, P.DP_RECEIVE, P.RETURNS_ACCEPT, P.HOLDS_TRANSFER, P.SOURCE_REVIEW, P.SOURCE_REVIEW_BORROWER]) expect(ROLE_DEFAULTS.SUPERADMIN.permissions, k).not.toContain(k);
    for (const k of [P.ROLES_MANAGE, P.ACCESS_ALL_BRANCHES, P.USERS_EDIT, P.SETTINGS_SYSTEM, P.BRANCHES_MANAGE]) expect(ROLE_DEFAULTS.SUPERADMIN.permissions, k).toContain(k);
    const saRole = role("r-sa", "SUPERADMIN", ROLE_DEFAULTS.SUPERADMIN.permissions, true);
    expect(planRoleMigration([saRole], [user("sa1", "r-sa")]).warnings.join(" ")).toMatch(/Only one active Superadmin/);
    expect(planRoleMigration([saRole], [user("sa1", "r-sa"), user("sa2", "r-sa")]).warnings.join(" ")).not.toMatch(/Only one active Superadmin/);
    // Admin approves Open Items by default (D-029).
    for (const k of [P.SOURCE_REVIEW, P.SOURCE_REVIEW_BORROWER]) expect(ROLE_DEFAULTS.ADMIN.permissions, k).toContain(k);
  });

  it("Admin loses Manage permissions only when an active Superadmin exists", () => {
    const adminRole = role("r-ad", "ADMIN", ROLE_DEFAULTS.ADMIN.permissions.concat(P.ROLES_MANAGE), true);
    const saRole = role("r-sa", "SUPERADMIN", ROLE_DEFAULTS.SUPERADMIN.permissions, true);
    const without = planRoleMigration([adminRole, saRole], []);
    expect(without.roleUpdates.find((r) => r.key === "ADMIN")).toBeUndefined();
    expect(without.warnings.join(" ")).toMatch(/no active Superadmin/);
    const withSa = planRoleMigration([adminRole, saRole], [user("sa", "r-sa")]);
    expect(withSa.roleUpdates.find((r) => r.key === "ADMIN")!.permissions).not.toContain(P.ROLES_MANAGE);
  });
});
