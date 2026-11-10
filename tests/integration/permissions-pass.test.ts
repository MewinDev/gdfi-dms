/**
 * The permissions pass: every feature is a tick on a role (LOCAL test database only). Custom roles start
 * with "Z", test users with "zz."; both are removed at the end and built-in roles go back to default.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ALL_PERMISSIONS, AREA_PERMISSIONS, KIND_PERMISSION, LIST_PERMISSION, PERMISSIONS as P, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { NO_REFRESH, openLoanFile, refreshFromMyLoans } from "@/lib/services/loan-file";
import { saveRole, setRoleActive } from "@/lib/services/roles";
import { saveUser } from "@/lib/services/admin";
import { overseerIds } from "@/lib/services/jobs";
import { fileAdvisory } from "@/lib/services/lto-advisories";
import { applyChange, loadSnapshot, lockoutRefusal } from "@/lib/services/lockout";
import { inactiveRefusal } from "@/lib/services/settings-status";
import { UserError } from "@/lib/services/errors";
import { asUser, cleanLoans } from "./helpers";

const PN = "GD1012026901001";
let admin: CurrentUser;
let la: CurrentUser;

async function restore() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.role.deleteMany({ where: { builtIn: false, name: { startsWith: "Z" } } });
  for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
    await prisma.role.update({ where: { key }, data: { permissions: [...d.permissions], branchAccess: d.branchAccess, description: d.description, active: true } });
  }
}

/** A test user with a custom role holding exactly these ticks, in Antipolo (101). */
async function userWith(name: string, perms: string[]): Promise<CurrentUser> {
  const roleId = await saveRole(admin, null, { name, branchAccess: "ASSIGNED", permissions: perms });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
  const email = `zz.${name.toLowerCase().replace(/[^a-z]+/g, ".")}@gdfi.ph`;
  await saveUser(admin, null, { name, email, roleId: String(roleId), active: true, access: { all: false, grants: [{ kind: "BRANCH", divisionId: null, areaId: null, branchId: branch.id, exclude: false }], homeBranchId: branch.id } });
  return asUser(email);
}

beforeAll(async () => {
  await restore();
  await cleanLoans();
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  await openLoanFile(la, { pn: PN }).catch(() => null);
}, 120_000);
afterAll(restore);

describe("the migration gives every role the new ticks for what it could already do", () => {
  it("built-in roles hold exactly their defaults: Refresh for LA, Admin, DP, Vault, DIG, QA; not Finance, Approvers, Operations Monitor", async () => {
    for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
      const r = await prisma.role.findUniqueOrThrow({ where: { key } });
      expect([...effectivePermissions(r)].sort(), key).toEqual([...d.permissions].sort());
    }
    const refresh = Object.entries(ROLE_DEFAULTS).filter(([, d]) => d.permissions.includes(P.LOANS_REFRESH)).map(([k]) => k).sort();
    expect(refresh).toEqual(["ADMIN", "DIG", "DP", "LA", "QA", "SUP", "VAULT"]);
  });

  it("backfills a custom role that still has the old keys (re-running the data steps is harmless)", async () => {
    const legacy = await prisma.role.create({
      data: {
        key: "C_Z_LEGACY", name: "Z Legacy", builtIn: false,
        permissions: ["loans:view", "source:review", "source:manage", "settings:branches", "users:view", "users:edit", "reports:tat", "loans:export", "email:manage", "settings:system"],
      },
    });
    const sql = readFileSync(path.join("prisma", "migrations", "20261119090004_permissions_pass", "migration.sql"), "utf8");
    const statements = sql.split(/;\s*\n/).map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(10);
    expect(sql).not.toMatch(/^\s*DROP INDEX/im);
    for (const s of statements) await prisma.$executeRawUnsafe(s);
    // Later migrations' role steps run after it, as on a real database (20261119090005_expense_kinds adds the expense-kind ticks).
    // (20261119090006_decisions_batch adds "Print liquidation report" and takes "Move a hold" from Finance.)
    for (const later of ["20261119090005_expense_kinds", "20261119090006_decisions_batch", "20261119090007_funds_per_type", "20261119090008_funds_edit_split"]) {
      const sqlLater = readFileSync(path.join("prisma", "migrations", later, "migration.sql"), "utf8");
      for (const s of sqlLater.split(/;\s*\n/).map((x) => x.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim()).filter((x) => x.startsWith('UPDATE "Role"'))) await prisma.$executeRawUnsafe(s);
    }
    const after = new Set((await prisma.role.findUniqueOrThrow({ where: { id: legacy.id } })).permissions);
    for (const k of ["myloans:review", "myloans:manage", "branches:manage", "myloans:view", "loans:refresh", "myloans:sync", "branches:view", "branches:import", "branches:review", "access:manage", "settings:pn_format", "reports:tat_export", "email:view"]) expect(after.has(k), k).toBe(true);
    for (const k of ["source:review", "source:manage", "settings:branches"]) expect(after.has(k), k).toBe(false);
    // Built-in roles are unchanged by a second run.
    for (const [key, d] of Object.entries(ROLE_DEFAULTS)) {
      expect([...effectivePermissions(await prisma.role.findUniqueOrThrow({ where: { key } }))].sort(), key).toEqual([...d.permissions].sort());
    }
    // Every Admin person has All branches stored (no code reads the Admin role's name for it any more).
    expect(await prisma.user.count({ where: { role: { key: "ADMIN" }, allBranches: false } })).toBe(0);
  });
});

describe("loans:refresh: Refresh a loan from MyLoans", () => {
  it("with the tick: the refresh runs", async () => {
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    expect((await refreshFromMyLoans(la, loan.id)).ok).toBe(true);
  });

  it("without the tick: refused on the server with a plain reason, even for someone who sees the loan", async () => {
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    const noRefresh = await userWith("Z No Refresh", ROLE_DEFAULTS.LA.permissions.filter((k) => k !== P.LOANS_REFRESH));
    expect(noRefresh.permissions.has(P.LOANS_VIEW)).toBe(true);
    expect(noRefresh.permissions.has(P.MYLOANS_VIEW)).toBe(true);
    await expect(refreshFromMyLoans(noRefresh, loan.id)).rejects.toThrow(NO_REFRESH);
    expect(NO_REFRESH).toBe("Ask an Admin to turn on \"Refresh a loan from MyLoans\" for your role.");
  });

  it("ticking it on the role turns it on at the person's next request", async () => {
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    const role = await prisma.role.findFirstOrThrow({ where: { name: "Z No Refresh" } });
    await saveRole(admin, role.id, { name: role.name, description: role.description, branchAccess: role.branchAccess, permissions: [...role.permissions, P.LOANS_REFRESH] });
    const again = await asUser("zz.z.no.refresh@gdfi.ph");
    expect((await refreshFromMyLoans(again, loan.id)).ok).toBe(true);
  });
});

describe("notifications follow ticks, not role names", () => {
  it("LTO advisories: told only with \"Be told about LTO advisories\"", async () => {
    const monitor = await asUser("test.monitor@gdfi.ph");
    const office = (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true } })).id;
    const count = () => prisma.notification.count({ where: { userId: monitor.id, title: { startsWith: "LTO advisory" } } });
    const before = await count();
    await fileAdvisory(monitor, { ltoOfficeId: office, type: "LONG_QUEUE", remarks: "Queue past the gate." });
    expect(await count()).toBe(before + 1);
    await prisma.role.update({ where: { key: "MONITOR" }, data: { permissions: ROLE_DEFAULTS.MONITOR.permissions.filter((k) => k !== P.LTO_REPORTS_NOTIFY) } });
    await fileAdvisory(monitor, { ltoOfficeId: office, type: "SYSTEM_DOWN", remarks: "System down since 9." });
    expect(await count()).toBe(before + 1);
    await prisma.role.update({ where: { key: "MONITOR" }, data: { permissions: [...ROLE_DEFAULTS.MONITOR.permissions] } });
  });

  it("problems, holds and overdue work: told to people with \"Resolve any problem\" at that branch", async () => {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    const ids = await overseerIds(prisma, branch.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(la.id);
    const overseer = await userWith("Z Overseer", [P.LOANS_VIEW, P.PROBLEMS_RESOLVE_ANY]);
    expect(await overseerIds(prisma, branch.id)).toContain(overseer.id);
    const other = await prisma.branch.findUniqueOrThrow({ where: { code: "390" } });
    expect(await overseerIds(prisma, other.id)).not.toContain(overseer.id);
  });
});

describe("lock-out protection", () => {
  it("the last role that can manage roles cannot lose that tick", async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const snap = await loadSnapshot();
    const why = lockoutRefusal(snap, { kind: "role", roleId: adminRole.id, permissions: [...adminRole.permissions].filter((k) => k !== P.ROLES_MANAGE) });
    expect(why).toBe("Admin is the last role that can manage roles. Keep \"Manage roles\" ticked, or tick it on another role first.");
    // Through the service: the editor's own role says so first.
    await expect(saveRole(admin, adminRole.id, { name: adminRole.name, description: adminRole.description, branchAccess: adminRole.branchAccess, permissions: adminRole.permissions.filter((k) => k !== P.ROLES_MANAGE) })).rejects.toBeInstanceOf(UserError);
    await expect(setRoleActive(admin, adminRole.id, false)).rejects.toBeInstanceOf(UserError);
  });

  it("the last active person who can change branch access cannot lose it", async () => {
    const snap = await loadSnapshot();
    const holders = [...snap.users.entries()].filter(([, u]) => u.active && snap.roles.get(u.roleId)?.active && snap.roles.get(u.roleId)!.permissions.has(P.ACCESS_MANAGE)).map(([id]) => id);
    // Make everyone but one inactive in the snapshot (nothing is written), then try the last one.
    let s = snap;
    for (const id of holders.slice(1)) s = applyChange(s, { kind: "user", userId: id, active: false });
    const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    expect(lockoutRefusal(s, { kind: "user", userId: holders[0], roleId: laRole.id })).toMatch(/^This is the last active person who can manage roles\.|^This is the last active person who can change branch access\./);
    expect(lockoutRefusal(s, { kind: "user", userId: holders[0], active: true })).toBeNull();
  });

  it("a role with Manage roles but no people does not count; another role with people does", async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const without = adminRole.permissions.filter((k) => k !== P.ACCESS_MANAGE);
    const spare = await prisma.role.create({ data: { key: "C_Z_SPARE", name: "Z Spare", builtIn: false, permissions: [P.USERS_VIEW, P.USERS_EDIT, P.ACCESS_MANAGE] } });
    const snap = await loadSnapshot();
    expect(lockoutRefusal(snap, { kind: "role", roleId: adminRole.id, permissions: without })).toMatch(/^Nobody active could change branch access after this change\./);
    const u = await prisma.user.create({ data: { email: "zz.spare@gdfi.ph", name: "Zz Spare", roleId: spare.id, isTestUser: true } });
    expect(lockoutRefusal(await loadSnapshot(), { kind: "role", roleId: adminRole.id, permissions: without })).toBeNull();
    await prisma.user.delete({ where: { id: u.id } });
  });

  it("making the last Admin person inactive is refused by the same rule (no role name involved)", async () => {
    const others = await prisma.user.findMany({ where: { active: true, role: { key: "ADMIN" }, id: { not: admin.id } } });
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: false } });
    try {
      expect(await inactiveRefusal("user", { id: admin.id }, { id: "someone-else" })).toMatch(/^This is the last active person who can (manage roles|change branch access)\./);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: true } });
    }
  });
});

describe("roles are just ticks", () => {
  it("every key in the catalogue is enforced somewhere in the app code (no decorative ticks)", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p); } };
    for (const d of ["app", "components", "lib"]) walk(d);
    const code = files.filter((f) => !f.endsWith(path.join("auth", "permissions.ts"))).map((f) => readFileSync(f, "utf8")).join("\n");
    const names = Object.entries(P);
    // An exact name: "See funds status" (funds:view) only looked enforced because "PERMISSIONS.FUNDS_VIEW" is
    // the start of "PERMISSIONS.FUNDS_VIEW_ALL"; it was removed (20261119090008_funds_edit_split).
    for (const k of ALL_PERMISSIONS) {
      const constName = names.find(([, v]) => v === k)![0];
      // Settings lists and areas are checked through LIST_PERMISSION / KIND_PERMISSION / AREA_PERMISSIONS.
      const viaList = Object.values(LIST_PERMISSION).includes(k) || Object.values(KIND_PERMISSION).includes(k) || Object.values(AREA_PERMISSIONS).flat().includes(k);
      expect(viaList || new RegExp(`(PERMISSIONS|P)[.]${constName}(?![A-Z_])`).test(code), k).toBe(true);
    }
  });

  it("no code decides access by a role's name or key (the kit and the seed only build data)", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p); } };
    for (const d of ["app", "components", "lib"]) walk(d);
    const bad = /role\.key\s*[!=]==|roleKey\s*[!=]==|\.key\s*===\s*"(ADMIN|LA|DP|FIN|MONITOR|APPR|VAULT|DIG|QA)"|key:\s*"(ADMIN|LA|DP|FIN|MONITOR|APPR|VAULT|DIG|QA)"\s*[,}]|isLockedAdminRole|ADMIN_ROLE_KEY|MONITOR_ROLE_KEY/;
    const hits = files.filter((f) => !f.includes(`${path.sep}kit${path.sep}`)).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => bad.test(l)).map(([f, n, l]) => `${f}:${n} ${l.trim()}`));
    expect(hits).toEqual([]);
  });
});
