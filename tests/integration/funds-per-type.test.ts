/**
 * Cash advances and fund transfers are handled by different people: per-type ticks (and the migration
 * that splits the old keys), per-type approval bands, every Funds query and action limited to the
 * person's types, notifications to the right people (Admins when nobody), the "Nobody can ..." lines.
 * TEST database only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS as P, dependentsOf, normalizePermissions, withRequirements } from "@/lib/auth/permissions";
import { roleImpact, tick } from "@/lib/roles/impact";
import { TYPE_ID, typeWhere, typesFor } from "@/lib/funds/access";
import { closeAdvance, decideAdvance, liquidationReportAccess, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { fundsGaps, fundsHandlers, roleManagerIds, typeBandApprovers } from "@/lib/services/funds-handlers";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { setSetting } from "@/lib/settings";
import { asUser, cleanLoans } from "./helpers";

let dp: CurrentUser, la: CurrentUser, caFin: CurrentUser, ftFin: CurrentUser, admin: CurrentUser;
let caRoleId: string, ftRoleId: string, branchId: string;
const CA_KEYS = [P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE, P.FUNDS_CA_PRINT];
const FT_KEYS = [P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_CHANGE_TYPE, P.FUNDS_FT_PRINT];
class Rollback extends Error {}
const rolledBack = (fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) =>
  prisma.$transaction(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });

async function restoreBands() {
  const fin = await prisma.role.findUniqueOrThrow({ where: { key: "FIN" } });
  await prisma.approvalBand.deleteMany({});
  for (const id of [TYPE_ID.CA, TYPE_ID.FT]) await prisma.approvalBand.create({ data: { fundsTypeId: id, fromCents: 0, roleId: fin.id } });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.pertype" } } });
  await prisma.role.deleteMany({ where: { key: { in: ["C_Z_CA_FIN", "C_Z_FT_FIN", "C_Z_OLD_KEYS"] } } });
  caRoleId = (await prisma.role.create({ data: { key: "C_Z_CA_FIN", name: "Z Finance cash", permissions: [P.LOANS_VIEW, ...CA_KEYS] } })).id;
  ftRoleId = (await prisma.role.create({ data: { key: "C_Z_FT_FIN", name: "Z Finance transfer", permissions: [P.LOANS_VIEW, ...FT_KEYS] } })).id;
  await prisma.user.create({ data: { email: "zz.pertype.ca@gdfi.ph", name: "Z Cash Person", roleId: caRoleId, isTestUser: true, allBranches: true } });
  await prisma.user.create({ data: { email: "zz.pertype.ft@gdfi.ph", name: "Z Transfer Person", roleId: ftRoleId, isTestUser: true, allBranches: true } });
  caFin = await asUser("zz.pertype.ca@gdfi.ph");
  ftFin = await asUser("zz.pertype.ft@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  branchId = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await restoreBands();
});
afterAll(async () => {
  await cleanLoans();
  await restoreBands();
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.pertype" } } });
  await prisma.role.deleteMany({ where: { key: { in: ["C_Z_CA_FIN", "C_Z_FT_FIN", "C_Z_OLD_KEYS"] } } });
  await prisma.$disconnect();
});

/** A request of a type straight in the database (one Transport line), in a status. */
const advance = (type: "CA" | "FT", number: string, data: Record<string, unknown> = {}) => prisma.cashAdvance.create({
  data: {
    number, requestedById: dp.id, branchId, requestedCents: 50_000, fundsTypeId: TYPE_ID[type], fundsTypeCode: type, fundsTypeName: type === "CA" ? "Cash advance" : "Fund transfer",
    lines: { create: [{ kind: "TRANSPORT", requestedCents: 50_000, note: "Tricycle to the LTO" }] }, ...data,
  },
});

describe("Permissions per type", () => {
  it("each old key maps to both types (built-in and custom roles); the old keys are removed (the migration)", async () => {
    // The per-type split (20261119090007), then Edit split into Edit lines and Change type (20261119090008).
    const steps = ["20261119090007_funds_per_type", "20261119090008_funds_edit_split"].flatMap((m) => readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8")
      .split(/;\s*\n/).map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim()).filter((s) => s.startsWith('UPDATE "Role"')));
    expect(steps.length).toBeGreaterThan(17);
    await rolledBack(async (tx) => {
      const old = ["loans:view", "funds:view_all", "funds:approve", "funds:release", "funds:print", "funds:exception", "funds:view"];
      const custom = await tx.role.create({ data: { key: "C_Z_OLD_KEYS", name: "Z Old keys", permissions: old } });
      const viewOnly = await tx.role.create({ data: { key: "C_Z_OLD_VIEW", name: "Z Old view", permissions: ["loans:view", "funds:view_all"] } });
      const approverOnly = await tx.role.create({ data: { key: "C_Z_OLD_APPROVER", name: "Z Old approver", permissions: ["loans:view", "funds:view_all", "funds:approve", "funds:view"] } });
      await tx.role.update({ where: { key: "FIN" }, data: { permissions: old } });
      for (const s of steps) await tx.$executeRawUnsafe(s);
      for (const id of [custom.id, (await tx.role.findUniqueOrThrow({ where: { key: "FIN" } })).id]) {
        const after = (await tx.role.findUniqueOrThrow({ where: { id } })).permissions;
        expect([...after].sort()).toEqual(["loans:view", "funds:exception", ...CA_KEYS, ...FT_KEYS].sort());
      }
      expect([...(await tx.role.findUniqueOrThrow({ where: { id: viewOnly.id } })).permissions].sort()).toEqual(["loans:view", P.FUNDS_CA_VIEW, P.FUNDS_FT_VIEW].sort());
      // Approve only: Edit lines of both types, no Change type (Release had it); "See funds status" is gone.
      expect([...(await tx.role.findUniqueOrThrow({ where: { id: approverOnly.id } })).permissions].sort()).toEqual(
        ["loans:view", P.FUNDS_CA_VIEW, P.FUNDS_FT_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_FT_APPROVE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_FT_EDIT_LINES].sort());
      // A second run changes nothing.
      for (const s of steps) await tx.$executeRawUnsafe(s);
      expect((await tx.role.findUniqueOrThrow({ where: { id: custom.id } })).permissions).toHaveLength(2 + CA_KEYS.length + FT_KEYS.length);
    });
    // The code reads old keys the same way (a role saved before the migration).
    expect(normalizePermissions(["loans:view", "funds:release"]).sort()).toEqual(["loans:view", P.FUNDS_CA_VIEW, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE, P.FUNDS_FT_VIEW, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_CHANGE_TYPE].sort());
    expect(normalizePermissions(["loans:view", "funds:approve"])).not.toContain(P.FUNDS_CA_CHANGE_TYPE);
  });

  it("inside a type: ticking Approve also ticks See; unticking See clears the rest of that type only, with the one-line note", () => {
    expect([...withRequirements([P.FUNDS_FT_APPROVE])]).toEqual(expect.arrayContaining([P.FUNDS_FT_VIEW, P.LOANS_VIEW]));
    expect([...withRequirements([P.FUNDS_FT_APPROVE])]).not.toContain(P.FUNDS_CA_VIEW);
    expect(dependentsOf(P.FUNDS_CA_VIEW).sort()).toEqual([P.FUNDS_CA_APPROVE, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE, P.FUNDS_CA_PRINT].sort());
    // Both new ticks need See of their type.
    expect(tick([P.LOANS_VIEW], P.FUNDS_FT_CHANGE_TYPE, true).note).toBe("Also ticked: See fund transfers (needed by Change type of fund transfers).");
    expect(tick([P.LOANS_VIEW], P.FUNDS_CA_EDIT_LINES, true).note).toBe("Also ticked: See cash advances (needed by Edit lines of cash advances).");
    const on = tick([P.LOANS_VIEW], P.FUNDS_FT_RELEASE, true);
    expect(on.note).toBe("Also ticked: See fund transfers (needed by Release fund transfers).");
    const off = tick([P.LOANS_VIEW, ...CA_KEYS, ...FT_KEYS], P.FUNDS_CA_VIEW, false);
    expect([...off.next].sort()).toEqual([P.LOANS_VIEW, ...FT_KEYS].sort());
    expect(off.note).toMatch(/^Also unticked: Approve cash advances, Release cash advances, Settle and close cash advances, Edit lines of cash advances, Change type of cash advances, Print liquidation report for cash advances/);
  });

  it("the role editor's impact preview says who loses what, in plain words", () => {
    expect(roleImpact([P.LOANS_VIEW, ...FT_KEYS], [P.LOANS_VIEW, ...FT_KEYS.filter((k) => k !== P.FUNDS_FT_RELEASE)], 3).text).toBe("0 users gain anything. 3 users lose: Release fund transfers.");
  });
});

describe("Every Funds query and action follows the person's types", () => {
  it("lists, counts and totals: a cash-only person sees no fund transfer; both types see both", async () => {
    await advance("CA", "CA-2026-9101");
    await advance("FT", "FT-2026-9102");
    expect(typesFor(caFin)).toEqual(["CA"]);
    expect(typesFor(ftFin)).toEqual(["FT"]);
    const fin = await asUser("test.finance@gdfi.ph");
    const numbers = async (u: CurrentUser) => (await prisma.cashAdvance.findMany({ where: typeWhere(u), orderBy: { number: "asc" } })).map((a) => a.number);
    expect(await numbers(caFin)).toEqual(["CA-2026-9101"]);
    expect(await numbers(ftFin)).toEqual(["FT-2026-9102"]);
    expect(await numbers(fin)).toEqual(["CA-2026-9101", "FT-2026-9102"]);
    expect(await numbers(dp)).toEqual([]); // the DP sees their own requests on My funds, not here
    const total = await prisma.cashAdvance.aggregate({ where: typeWhere(caFin), _sum: { requestedCents: true }, _count: true });
    expect(total).toMatchObject({ _count: 1, _sum: { requestedCents: 50_000 } });
  });

  it("a cash-only person is refused a fund transfer's report and every action on it (the normal refusal)", async () => {
    const ft = await advance("FT", "FT-2026-9103", { status: "LIQUIDATED", approvedCents: 50_000, releasedCents: 50_000 });
    const ca = await advance("CA", "CA-2026-9104", { status: "LIQUIDATED", approvedCents: 50_000, releasedCents: 50_000 });
    expect(liquidationReportAccess(caFin, ft)).toBe("not-found");
    expect(liquidationReportAccess(caFin, ca)).toBe("ok");
    expect(liquidationReportAccess(ftFin, ft)).toBe("ok");
    await expect(closeAdvance(caFin, ft.id)).rejects.toThrow("Request not found.");
    await closeAdvance(caFin, ca.id);
    const req = await advance("FT", "FT-2026-9105", { status: "APPROVED", approvedCents: 50_000 });
    await expect(releaseAdvance(caFin, req.id, { ref: "V-1" })).rejects.toThrow("Request not found.");
    // Seeing a type without its step tick: refused with the type's words.
    const seesBoth = { ...caFin, permissions: new Set([...caFin.permissions, P.FUNDS_FT_VIEW]) };
    await expect(releaseAdvance(seesBoth, req.id, { ref: "V-1" })).rejects.toThrow("Your role does not allow releasing fund transfers.");
  });
});

describe("Approval bands per type", () => {
  it("a request uses its own type's bands; approving needs that type's Approve tick; never one's own request", async () => {
    await prisma.approvalBand.deleteMany({});
    await prisma.approvalBand.create({ data: { fundsTypeId: TYPE_ID.CA, fromCents: 0, roleId: caRoleId } });
    await prisma.approvalBand.create({ data: { fundsTypeId: TYPE_ID.FT, fromCents: 0, roleId: ftRoleId } });
    const ca = await advance("CA", "CA-2026-9201");
    const ft = await advance("FT", "FT-2026-9202");
    await expect(decideAdvance(ftFin, ca.id, { approve: true })).rejects.toThrow("Request not found.");
    // Both ticks but in the other type's band only: refused by the band.
    const both = { ...ftFin, permissions: new Set([...ftFin.permissions, ...CA_KEYS]) };
    await expect(decideAdvance(both, ca.id, { approve: true })).rejects.toThrow(/approved by another role \(approval bands\)/);
    expect((await decideAdvance(caFin, ca.id, { approve: true })).status).toBe("APPROVED");
    expect((await decideAdvance(ftFin, ft.id, { approve: true })).status).toBe("APPROVED");
    const own = await prisma.cashAdvance.create({ data: { number: "CA-2026-9203", requestedById: caFin.id, branchId, requestedCents: 100, fundsTypeId: TYPE_ID.CA, lines: { create: [{ kind: "TRANSPORT", requestedCents: 100, note: "x" }] } } });
    await expect(decideAdvance(caFin, own.id, { approve: true })).rejects.toThrow("You cannot approve your own request.");
  });

  it("the migration copied every band to Fund transfer (the same role and amount)", async () => {
    const bands = await prisma.approvalBand.findMany({ include: { role: true } });
    const pairs = (t: string) => bands.filter((b) => b.fundsTypeId === t).map((b) => `${b.fromCents}:${b.role.key}`).sort();
    expect(pairs(TYPE_ID.FT)).toEqual(pairs(TYPE_ID.CA));
  });
});

describe("Notifications go to the people of the type", () => {
  /** The sample loan's Mortgage, accepted by the test DP and needing funds. */
  async function accepted() {
    await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
    const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "MORTGAGE" } }, include: { checks: true } });
    await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
    const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto.id, fundsNeeded: "YES", fundsKinds: ["LTO_FEE"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
    await acceptJob(dp, job.id);
    return txn;
  }

  it("a fund transfer to approve is told only to the fund-transfer band's approvers; the release step only to who releases fund transfers", async () => {
    await prisma.approvalBand.deleteMany({});
    await prisma.approvalBand.create({ data: { fundsTypeId: TYPE_ID.CA, fromCents: 0, roleId: caRoleId } });
    await prisma.approvalBand.create({ data: { fundsTypeId: TYPE_ID.FT, fromCents: 0, roleId: ftRoleId } });
    const txn = await accepted();
    const started = new Date();
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 250_000 }], fundsTypeId: TYPE_ID.FT });
    const told = async (title: string) => (await prisma.notification.findMany({ where: { title }, select: { userId: true } })).map((n) => n.userId).sort();
    expect(await told(`${r.number}: Fund transfer to approve`)).toEqual([ftFin.id]);
    await decideAdvance(ftFin, r.id, { approve: true });
    const releasers = (await prisma.user.findMany({ where: { active: true, role: { active: true, permissions: { has: P.FUNDS_FT_RELEASE } } } })).map((u) => u.id);
    expect(releasers).not.toContain(caFin.id);
    // Only this test's rows (numbers are reused after a reset; the outbox keeps older rows).
    const emails = await prisma.emailOutbox.findMany({ where: { subject: { contains: r.number }, event: "advance_decided", createdAt: { gte: started } }, select: { userId: true } });
    for (const e of emails) expect([dp.id, ...releasers]).toContain(e.userId);
  });

  it("nobody in the type's band: the Admins are told", async () => {
    await prisma.approvalBand.deleteMany({});
    await prisma.approvalBand.create({ data: { fundsTypeId: TYPE_ID.FT, fromCents: 0, roleId: caRoleId } }); // a role without Approve fund transfers
    const admins = (await roleManagerIds(prisma)).sort();
    expect(admins).toContain(admin.id);
    expect((await typeBandApprovers(prisma, 10_000, { fundsTypeId: TYPE_ID.FT })).sort()).toEqual(admins);
    expect((await typeBandApprovers(prisma, 10_000, { fundsTypeId: TYPE_ID.CA })).sort()).toEqual(admins); // no Cash advance band at all
  });
});

describe("Who handles it, and what nobody can do", () => {
  it("lists active people per type and step; 'Nobody can release fund transfers.' when nobody has the tick", async () => {
    const all = await fundsHandlers();
    const ft = all.find((h) => h.type === "FT")!;
    expect(ft.steps.find((s) => s.step === "release")!.people.map((p) => p.name)).toContain("Z Transfer Person");
    expect(all.find((h) => h.type === "CA")!.steps.find((s) => s.step === "release")!.people.map((p) => p.name)).not.toContain("Z Transfer Person");
    await rolledBack(async (tx) => {
      for (const r of await tx.role.findMany({ where: { permissions: { has: P.FUNDS_FT_RELEASE } } })) {
        await tx.role.update({ where: { id: r.id }, data: { permissions: r.permissions.filter((k) => k !== P.FUNDS_FT_RELEASE) } });
      }
      expect(await fundsGaps(tx)).toEqual(["Nobody can release fund transfers."]);
      // An inactive person does not count either way.
      await tx.user.updateMany({ where: { role: { permissions: { has: P.FUNDS_CA_SETTLE } } }, data: { active: false } });
      expect(await fundsGaps(tx)).toEqual(expect.arrayContaining(["Nobody can settle and close cash advances.", "Nobody can release fund transfers."]));
    });
    expect(await fundsGaps()).toEqual([]);
  });
});
