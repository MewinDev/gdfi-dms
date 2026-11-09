/**
 * Branch access per user (LOCAL test database only): grants on a Division, an Area (Division + Area) or a
 * Branch, minus exceptions; the derived table user_branch_access; All branches; the home branch; copy
 * access; inactive branches; what the access filters (loan files, Find loan, branch notifications);
 * permissions; and the speed with 1,000 branches and 200 users. Everything made here starts with "ZT"
 * (branches, areas, divisions) or "zz.ba." (users) and is removed at the end (test clean-up only).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { accessImpact, rebuildAccess, type GrantLike } from "@/lib/branches/access";
import { copyAccess, describeAccess, saveUserAccess } from "@/lib/services/access";
import { saveUser } from "@/lib/services/admin";
import { getLoanForUser } from "@/lib/services/queries";
import { lookupPn } from "@/lib/services/loan-file";
import { branchLaUserIds } from "@/lib/notify";
import { UserError } from "@/lib/services/errors";
import { currentDataRows as exportRows, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { asUser, cleanLoans } from "./helpers";

let admin: CurrentUser;
let la: CurrentUser;
let laRoleId: string;
const D = { id: "" };
const A: Record<string, string> = {};
const Bx: Record<string, string> = {};

const area = (a: string, d = D.id): GrantLike => ({ kind: "AREA", divisionId: d, areaId: A[a], branchId: null, exclude: false });
const br = (b: string, exclude = false): GrantLike => ({ kind: "BRANCH", divisionId: null, areaId: null, branchId: Bx[b], exclude });
const rows = async (userId: string) => (await prisma.userBranch.findMany({ where: { userId }, select: { branchId: true } })).map((r) => r.branchId).sort();
const named = (...bs: string[]) => bs.map((b) => Bx[b]).sort();

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.ba." } } });
  await prisma.branchReview.deleteMany({ where: { branch: { name: { startsWith: "ZT" } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: "ZT" } } });
  await prisma.area.deleteMany({ where: { name: { startsWith: "ZT" } } });
  await prisma.division.deleteMany({ where: { name: { startsWith: "ZT" } } });
}

async function zzUser(name: string, access: Parameters<typeof saveUserAccess>[2], roleId = laRoleId) {
  const email = `zz.ba.${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@gdfi.ph`;
  await saveUser(admin, null, { name: `Zz ${name}`, email, roleId, active: true, access });
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

beforeAll(async () => {
  await cleanup();
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  laRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: "LA" } })).id;
  D.id = (await prisma.division.create({ data: { name: "ZT Division" } })).id;
  for (const a of ["one", "two"]) A[a] = (await prisma.area.create({ data: { name: `ZT Area ${a}` } })).id;
  const mk = async (k: string, code: string, a: string, active = true) => {
    Bx[k] = (await prisma.branch.create({ data: { code, name: `ZT ${k}`, divisionId: D.id, areaId: A[a], active } })).id;
  };
  await mk("b1", "951", "one");
  await mk("b2", "952", "one");
  await mk("b3", "953", "two");
  await mk("b4", "954", "two");
  await mk("off", "955", "two", false);
});
beforeEach(async () => { process.env.TEST_MODE = "true"; });
afterAll(async () => {
  await cleanLoans();
  await cleanup();
  await prisma.$disconnect();
});

describe("Grants, exceptions and the derived table", () => {
  it("union of an Area and a Branch minus an exception; rebuilt on save; audited", async () => {
    const u = await zzUser("Union", { all: false, grants: [area("one"), br("b4"), br("b2", true)], homeBranchId: null });
    expect(await rows(u.id)).toEqual(named("b1", "b4"));
    expect(u.homeBranchId).toBe(Bx.b1); // the first workable branch of the access, by name
    const d = await describeAccess(prisma, u.id);
    expect(d.summary).toBe("1 area + 1 branch except 1 branch, 2 branches in total");
    // Changing the grants rebuilds the rows.
    await saveUserAccess(admin, u.id, { all: false, grants: [area("one"), area("two")], homeBranchId: Bx.b3 });
    expect(await rows(u.id)).toEqual(named("b1", "b2", "b3", "b4", "off"));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "access_changed", entityId: u.id }, orderBy: { at: "desc" } });
    expect(audit.actorLabel).toBe(admin.name);
    expect(audit.summary).toContain("1 area + 1 branch except 1 branch, 2 branches in total -> 2 areas, 5 branches in total");
    expect(audit.before).toBeTruthy();
  });

  it("a Division grant covers both of its areas; an Area grant is the Division + Area pair", async () => {
    const other = await prisma.division.create({ data: { name: "ZT Other Division" } });
    const twin = await prisma.branch.create({ data: { code: "956", name: "ZT twin", divisionId: other.id, areaId: A.one } });
    const u = await zzUser("Pair", { all: false, grants: [area("one")], homeBranchId: null });
    expect(await rows(u.id)).toEqual(named("b1", "b2")); // not the twin under the other division
    await saveUserAccess(admin, u.id, { all: false, grants: [{ kind: "DIVISION", divisionId: D.id, areaId: null, branchId: null, exclude: false }], homeBranchId: null });
    expect(await rows(u.id)).toEqual(named("b1", "b2", "b3", "b4", "off"));
    await prisma.branch.delete({ where: { id: twin.id } });
  });

  it("a new branch under a ticked Area is included after the rebuild", async () => {
    const u = await zzUser("Dynamic", { all: false, grants: [area("one")], homeBranchId: null });
    Bx.b5 = (await prisma.branch.create({ data: { code: "957", name: "ZT b5", divisionId: D.id, areaId: A.one } })).id;
    expect(await rows(u.id)).not.toContain(Bx.b5);
    const changed = await rebuildAccess(prisma, "groups");
    expect(changed.find((c) => c.userId === u.id)?.gained).toEqual([Bx.b5]);
    expect(await rows(u.id)).toContain(Bx.b5);
  });

  it("a branch moved to another Area changes access; the impact preview names the users first", async () => {
    const u = await zzUser("Mover", { all: false, grants: [area("one")], homeBranchId: null });
    const v = await zzUser("Watcher", { all: false, grants: [area("two")], homeBranchId: null });
    const impact = await accessImpact(prisma, [{ id: Bx.b2, divisionId: D.id, areaId: A.two }]);
    expect(impact.find((x) => x.userId === u.id)).toMatchObject({ name: "Zz Mover", lost: [Bx.b2], gained: [] });
    expect(impact.find((x) => x.userId === v.id)).toMatchObject({ name: "Zz Watcher", gained: [Bx.b2], lost: [] });
    // Nothing changed yet.
    expect(await rows(u.id)).toContain(Bx.b2);
    await prisma.branch.update({ where: { id: Bx.b2 }, data: { areaId: A.two } });
    await rebuildAccess(prisma, "groups");
    expect(await rows(u.id)).not.toContain(Bx.b2);
    expect(await rows(v.id)).toContain(Bx.b2);
    await prisma.branch.update({ where: { id: Bx.b2 }, data: { areaId: A.one } });
    await rebuildAccess(prisma, "groups");
  });
});

describe("All branches, home branch, inactive branches, copy", () => {
  it("All branches is a flag with no rows, and scope null", async () => {
    const u = await zzUser("Everywhere", { all: true, grants: [], homeBranchId: null });
    expect(await rows(u.id)).toEqual([]);
    const cu = await asUser(u.email);
    expect(cu.scopeBranchIds).toBeNull();
    expect(cu.branchIds).toEqual([]);
  });

  it("the home branch must be inside the access, active and shown", async () => {
    const u = await zzUser("Home", { all: false, grants: [br("b1")], homeBranchId: Bx.b1 });
    await expect(saveUserAccess(admin, u.id, { all: false, grants: [br("b1")], homeBranchId: Bx.b3 })).rejects.toThrow("The home branch must be one of the branches in the access.");
    await expect(saveUserAccess(admin, u.id, { all: false, grants: [area("two")], homeBranchId: Bx.off })).rejects.toThrow(/ZT off is inactive: pick another home branch/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).homeBranchId).toBe(Bx.b1);
  });

  it("a loan worker needs at least one branch", async () => {
    await expect(zzUser("Nowhere", { all: false, grants: [], homeBranchId: null })).rejects.toThrow(/Pick at least one branch: .* works on loan files/);
  });

  it("an inactive branch cannot be newly granted; one already granted stays", async () => {
    await expect(zzUser("Closed", { all: false, grants: [br("off")], homeBranchId: null })).rejects.toThrow("ZT off is inactive: it cannot be chosen for new work.");
    const u = await zzUser("Kept", { all: false, grants: [br("b1"), br("b3")], homeBranchId: null });
    await prisma.branch.update({ where: { id: Bx.b3 }, data: { active: false } });
    await saveUserAccess(admin, u.id, { all: false, grants: [br("b1"), br("b3")], homeBranchId: Bx.b1 }); // re-saved: kept
    expect(await rows(u.id)).toEqual(named("b1", "b3"));
    await prisma.branch.update({ where: { id: Bx.b3 }, data: { active: true } });
  });

  it("copy access from another user", async () => {
    const from = await zzUser("Source", { all: false, grants: [area("two"), br("b1"), br("b4", true)], homeBranchId: Bx.b3 });
    const to = await zzUser("Target", { all: false, grants: [br("b2")], homeBranchId: Bx.b2 });
    await copyAccess(admin, from.id, to.id);
    expect(await rows(to.id)).toEqual(await rows(from.id));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: to.id } })).homeBranchId).toBe(Bx.b3);
    expect((await describeAccess(prisma, to.id)).grants).toHaveLength(3);
  });
});

describe("Where the access applies", () => {
  it("loan files, Find loan and branch notifications follow an Area grant", async () => {
    await cleanLoans();
    const angono = await prisma.branch.findUniqueOrThrow({ where: { code: "165" }, include: { area: true, division: true } });
    const alaminos = await prisma.branch.findUniqueOrThrow({ where: { code: "390" } });
    const loan = (pn: string, branchId: string) => prisma.loan.create({
      data: { pn, borrowerName: `Zz ${pn}`, branchId, loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 400_000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id, classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist" },
    });
    await loan("GD1652026909501", angono.id);
    await loan("GD3902026909502", alaminos.id);
    const u = await zzUser("Luzon One", { all: false, grants: [{ kind: "AREA", divisionId: angono.divisionId, areaId: angono.areaId, branchId: null, exclude: false }], homeBranchId: angono.id });
    const cu = await asUser(u.email);
    expect(await getLoanForUser(cu, "GD1652026909501")).not.toBeNull();
    expect(await getLoanForUser(cu, "GD3902026909502")).toBeNull();
    // Find loan: a MyLoans loan of Alaminos (another area) is refused; one of Antipolo (same area) is not.
    expect(await lookupPn(cu, "GD3902026901007")).toMatchObject({ kind: "refused", field: "branch" });
    expect((await lookupPn(cu, "GD1012026901001")).kind).toBe("preview");
    // Branch updates: the LA of the area, and an LA with All branches; not at another area's branch.
    const all = await zzUser("All LA", { all: true, grants: [], homeBranchId: null });
    expect(await branchLaUserIds(prisma, angono.id)).toEqual(expect.arrayContaining([u.id, all.id]));
    expect(await branchLaUserIds(prisma, alaminos.id)).not.toContain(u.id);
    expect(await branchLaUserIds(prisma, alaminos.id)).toContain(all.id);
  });
});

describe("Users Import / Export", () => {
  it("branches as codes or ALL, home_branch, and Area grants kept when the codes change", async () => {
    const u = await zzUser("Importer", { all: false, grants: [area("one"), br("b3")], homeBranchId: Bx.b1 });
    const csv = toCsv(["name", "email", "role", "branches", "home_branch", "status"], [
      { name: "Zz Importer", email: u.email, role: "Loan Associate", branches: "954", home_branch: "954", status: "Active" },
      { name: "Zz Imported All", email: "zz.ba.imported.all@gdfi.ph", role: "Loan Associate", branches: "ALL", home_branch: "", status: "Active" },
      { name: "Zz Bad Home", email: "zz.ba.bad.home@gdfi.ph", role: "Loan Associate", branches: "951", home_branch: "954", status: "Active" },
    ]);
    const plan = await runImport(admin, "users", "u.csv", csv);
    if (!plan.ok) throw new Error(plan.error);
    // A home branch outside the access: that row is skipped, the others are imported.
    expect(plan.rows.find((r) => r.line === 4)?.problems.join(" ")).toMatch(/home branch must be one of the branches in the access/);
    expect(await prisma.user.count({ where: { email: "zz.ba.bad.home@gdfi.ph" } })).toBe(0);
    expect(await rows(u.id)).toEqual(named("b1", "b2", "b4", ...(Bx.b5 ? ["b5"] : []))); // the area stays; b3 replaced by b4
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).homeBranchId).toBe(Bx.b4);
    expect((await asUser("zz.ba.imported.all@gdfi.ph")).scopeBranchIds).toBeNull();
    const out = await exportRows("users");
    expect(out.find((r) => r.email === u.email)).toMatchObject({ branches: "954", home_branch: "954", notes: expect.stringContaining("area ZT Area one") });
  });
});

describe("Permissions and refusals", () => {
  it("only users:edit changes access; Admin stays All", async () => {
    const u = await zzUser("Guarded", { all: false, grants: [br("b1")], homeBranchId: null });
    await expect(saveUserAccess(la, u.id, { all: true, grants: [], homeBranchId: null })).rejects.toBeInstanceOf(UserError);
    await expect(copyAccess(la, u.id, la.id)).rejects.toThrow(/does not allow changing users' branch access/);
    await saveUserAccess(admin, admin.id, { all: false, grants: [br("b1")], homeBranchId: null });
    expect(await asUser(admin.email).then((a) => a.scopeBranchIds)).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).allBranches).toBe(true);
    await expect(saveUserAccess(admin, u.id, "not json")).rejects.toThrow("The branch access could not be read.");
  });
});

describe("Speed: 1,000 branches in 20 areas, 200 users", () => {
  it("rebuilds every user's access and filters by it quickly", async () => {
    const div = await prisma.division.create({ data: { name: "ZT Perf Division" } });
    const areas: string[] = [];
    for (let i = 0; i < 20; i++) areas.push((await prisma.area.create({ data: { name: `ZT Perf Area ${i}` } })).id);
    await prisma.branch.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ name: `ZT Perf Branch ${i}`, divisionId: div.id, areaId: areas[i % 20] })) });
    const branches = await prisma.branch.findMany({ where: { name: { startsWith: "ZT Perf Branch" } }, select: { id: true } });
    await prisma.user.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ email: `zz.ba.perf${i}@gdfi.ph`, name: `Zz Perf ${i}`, roleId: laRoleId, isTestUser: true })) });
    const users = await prisma.user.findMany({ where: { email: { startsWith: "zz.ba.perf" } }, select: { id: true } });
    // Mixed grants: two areas, a few single branches, an exception; every 10th a whole division.
    await prisma.userAccessGrant.createMany({
      data: users.flatMap((u, i): Prisma.UserAccessGrantCreateManyInput[] => i % 10 === 0
        ? [{ userId: u.id, kind: "DIVISION" as const, divisionId: div.id }]
        : [
            { userId: u.id, kind: "AREA" as const, divisionId: div.id, areaId: areas[i % 20] },
            { userId: u.id, kind: "AREA" as const, divisionId: div.id, areaId: areas[(i + 7) % 20] },
            { userId: u.id, kind: "BRANCH" as const, branchId: branches[(i * 13) % 1000].id },
            { userId: u.id, kind: "BRANCH" as const, branchId: branches[(i * 31) % 1000].id },
            { userId: u.id, kind: "BRANCH" as const, branchId: branches[i % 1000].id, exclude: true },
          ]),
    });
    let t = Date.now();
    await rebuildAccess(prisma, users.map((u) => u.id));
    const rebuildMs = Date.now() - t;
    const total = await prisma.userBranch.count({ where: { userId: { in: users.map((u) => u.id) } } });
    t = Date.now();
    const one = await asUser("zz.ba.perf1@gdfi.ph");
    const loans = await prisma.loan.findMany({ where: { branchId: { in: one.scopeBranchIds! } }, take: 50, select: { id: true } });
    const queryMs = Date.now() - t;
    t = Date.now();
    await rebuildAccess(prisma, "groups"); // nothing to change: a no-op pass over every group user
    const noopMs = Date.now() - t;
    console.log(`[perf] 1,000 branches, 200 users: rebuild ${rebuildMs} ms (${total} access rows), sign-in user + scoped loan query ${queryMs} ms (${one.scopeBranchIds!.length} branches), no-op rebuild of all group users ${noopMs} ms`);
    expect(total).toBeGreaterThan(200 * 50);
    expect(one.scopeBranchIds!.length).toBe(101); // 2 areas (100) + 2 branches - 1 exception
    expect(loans).toEqual([]);
    expect(rebuildMs).toBeLessThan(60_000);
    expect(queryMs).toBeLessThan(3_000);
  }, 180_000);
});
