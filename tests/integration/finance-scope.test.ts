// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { advanceScope, type CurrentUser } from "@/lib/auth/current-user";
import { setUserBranches } from "@/lib/services/access";
import { decideAdvance, financeIds, liquidationReportAccess } from "@/lib/services/funds";
import { branchesWithoutHandler, noHandlerText } from "@/lib/services/funds-handlers";
import { mayOpenReceipt } from "@/lib/services/file-access";
import { ROLE_DEFAULTS, PERMISSIONS } from "@/lib/auth/permissions";
import { asUser } from "./helpers";

/**
 * D-035 Finance branch scope: a Finance person handles only the fund types AND branches ticked for them.
 * An Angono-only Finance user cannot see or act on Pasig funds, receipts, liquidations or counts; a CA-only
 * user cannot act on fund transfers. Test database only; fake borrowers.
 */
const P = "GD9992099990";
const E = (k: string) => `zz.finscope.${k}@gdfi.ph`;
let angono: string, pasig: string;
let finAngono: CurrentUser, finCaOnly: CurrentUser;
const ids: Record<string, string> = {};

async function makeFin(key: string, branchIds: string[], ticks: { handlesCa: boolean; handlesFt: boolean }) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "FIN" } });
  const u = await prisma.user.create({ data: { email: E(key), name: `Zz Fin ${key}`, roleId: role.id, isTestUser: true, ...ticks } });
  await setUserBranches(u.id, branchIds);
  return asUser(u.email);
}
async function clean() {
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-99" } } });
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "FT-2099-99" } } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.finscope." } } });
}

beforeAll(async () => {
  await clean();
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  finAngono = await makeFin("angono", [angono], { handlesCa: true, handlesFt: true });
  finCaOnly = await makeFin("caonly", [angono], { handlesCa: true, handlesFt: false });
  const opener = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const dp = await prisma.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const mk = (n: string, branchId: string) => prisma.loan.create({
    data: {
      pn: `${P}${n}`, borrowerName: `Zz Fin Borrower ${n}`, branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: opener.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist", transactions: { create: { typeId: mortgage.id } },
    },
    include: { transactions: true },
  });
  const [la, lp] = [await mk("01", angono), await mk("02", pasig)];
  const line = (t: string) => ({ create: [{ transactionId: t, kind: "TRANSPORT", requestedCents: 100_000 }] });
  const base = (branchId: string) => ({ requestedById: dp.id, branchId, requestedCents: 100_000 });
  ids.caAngono = (await prisma.cashAdvance.create({ data: { ...base(angono), number: "CA-2099-9901", lines: line(la.transactions[0].id) } })).id;
  ids.caPasig = (await prisma.cashAdvance.create({ data: { ...base(pasig), number: "CA-2099-9902", lines: line(lp.transactions[0].id) } })).id;
  ids.ftAngono = (await prisma.cashAdvance.create({ data: { ...base(angono), number: "FT-2099-9903", fundsTypeId: "fundstype_ft", fundsTypeCode: "FT", fundsTypeName: "Fund transfer", lines: line(la.transactions[0].id) } })).id;
  const done = await prisma.cashAdvance.create({ data: { ...base(pasig), number: "CA-2099-9904", status: "LIQUIDATED", approvedCents: 100_000, releasedCents: 100_000, releasedAt: new Date(), lines: line(lp.transactions[0].id) }, include: { lines: true } });
  ids.donePasig = done.id;
});
afterAll(clean);

describe("Finance branch scope (D-035)", () => {
  it("the Finance role is branch-scoped by default, without borrower corrections", () => {
    expect(ROLE_DEFAULTS.FIN.branchAccess).toBe("ASSIGNED");
    expect(ROLE_DEFAULTS.FIN.permissions).not.toContain(PERMISSIONS.SOURCE_REVIEW_BORROWER);
  });

  it("an Angono-only Finance user: no Pasig request in the lists or counts", async () => {
    const n = (await prisma.cashAdvance.findMany({ where: { ...advanceScope(finAngono), number: { startsWith: "CA-2099-99" } }, select: { number: true } })).map((a) => a.number);
    expect(n).toEqual(["CA-2099-9901"]);
    expect(await prisma.cashAdvance.count({ where: { ...advanceScope(finAngono), status: "LIQUIDATED", number: { startsWith: "CA-2099-99" } } })).toBe(0);
  });

  it("cannot act on a Pasig request, open its receipt or its liquidation report", async () => {
    await expect(decideAdvance(finAngono, ids.caPasig, { approve: true })).rejects.toThrow("Request not found.");
    const done = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: ids.donePasig }, include: { lines: { include: { transaction: { include: { loan: true } } } } } });
    expect(liquidationReportAccess(finAngono, { ...done, lineBranchIds: done.lines.map((l) => l.transaction?.loan.branchId) })).toBe("not-found");
    expect(mayOpenReceipt(finAngono, { ...done, lineBranchIds: done.lines.map((l) => l.transaction?.loan.branchId) })).toBe(false);
    // Not told about it either.
    expect(await financeIds(prisma, { number: "CA-2099-9902" }, "approve")).not.toContain(finAngono.id);
    expect(await financeIds(prisma, { number: "CA-2099-9901" }, "approve")).toContain(finAngono.id);
    // Its own branch works.
    expect(await decideAdvance(finAngono, ids.caAngono, { approve: true })).toMatchObject({ status: "APPROVED" });
  });

  it("a CA-only Finance user cannot act on a fund transfer of their own branch", async () => {
    await expect(decideAdvance(finCaOnly, ids.ftAngono, { approve: true })).rejects.toThrow("Request not found.");
    expect(await financeIds(prisma, { fundsTypeId: "fundstype_ft", number: "FT-2099-9903" }, "approve")).not.toContain(finCaOnly.id);
  });

  it("branches with no CA / FT handler (Settings, Branches and the Superadmin's Home)", async () => {
    // With an All-branches CA+FT handler (the seeded Test Finance), every branch is covered.
    expect(await branchesWithoutHandler("CA")).toEqual([]);
    // Park every active All-branches FT handler (exactly those, restored by id after).
    const parked = (await prisma.user.findMany({ where: { active: true, allBranches: true, handlesFt: true }, select: { id: true } })).map((u) => u.id);
    await prisma.user.updateMany({ where: { id: { in: parked } }, data: { active: false } });
    try {
      const noFt = (await branchesWithoutHandler("FT")).map((b) => b.id);
      expect(noFt).toContain(pasig);
      expect(noFt).not.toContain(angono); // the Angono-only Finance user handles FT
      expect(noHandlerText("FT", 2)).toBe("2 active branches have no FT handler.");
    } finally {
      await prisma.user.updateMany({ where: { id: { in: parked } }, data: { active: true } });
    }
  });
});
