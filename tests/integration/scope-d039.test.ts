// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setUserBranches } from "@/lib/services/access";
import { decideAdvance, decideCarryOver, decideTopUp, exceptionTargets, grantException } from "@/lib/services/funds";
import { canSeeJob, raiseProblem, resolveProblem } from "@/lib/services/jobs";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { mayOpenStageFile } from "@/lib/services/file-access";
import { asUser } from "./helpers";

/**
 * D-039 and the scope-first rule (D-019) in piece 3:
 *  - Funds: an "already approved" answer is given only after the scope check (no hint that a record exists).
 *  - Funds exception: only to processors who work in the Finance person's branches.
 *  - Job pages: own job anywhere; anyone else's only when the LOAN's branch is theirs.
 *  - Holds and problems: allowed on the processor's own job wherever the loan is.
 * Test database only; fake borrowers and PNs.
 */
const P = "GD9992099939";
const E = (k: string) => `zz.d039.${k}@gdfi.ph`;
let angono: string, pasig: string;
let finAngono: CurrentUser, dpAngono: CurrentUser, dpAngono2: CurrentUser, dpPasig: CurrentUser;
const ids: Record<string, string> = {};

async function make(key: string, role: string, branchIds: string[], extra: Record<string, unknown> = {}) {
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const u = await prisma.user.create({ data: { email: E(key), name: `Zz D039 ${key}`, roleId: r.id, isTestUser: true, ...extra } });
  await setUserBranches(u.id, branchIds);
  return asUser(u.email);
}
async function clean() {
  const lines = { line: { advance: { number: { startsWith: "CA-2099-39" } } } };
  await prisma.carryOver.deleteMany({ where: lines });
  await prisma.cashAdvanceTopUp.deleteMany({ where: lines });
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-39" } } });
  const people = (await prisma.user.findMany({ where: { email: { startsWith: "zz.d039." } }, select: { id: true } })).map((u) => u.id);
  await prisma.fundsException.deleteMany({ where: { OR: [{ dpUserId: { in: people } }, { grantedById: { in: people } }] } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.d039." } } });
}

beforeAll(async () => {
  await clean();
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  finAngono = await make("fin", "FIN", [angono], { handlesCa: true, handlesFt: true });
  dpAngono = await make("dp", "DP", [angono]);
  dpAngono2 = await make("dp2", "DP", [angono]);
  dpPasig = await make("dppasig", "DP", [pasig]);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const mk = (n: string, branchId: string) => prisma.loan.create({
    data: {
      pn: `${P}${n}`, borrowerName: `Zz D039 Borrower ${n}`, branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist", transactions: { create: { typeId: mortgage.id, status: "IN_PROCESS" } },
    },
    include: { transactions: true },
  });
  const [la, lp] = [await mk("01", angono), await mk("02", pasig)];
  ids.txnAngono = la.transactions[0].id;
  ids.txnPasig = lp.transactions[0].id;

  // Funds: one approved request in each branch, an approved top-up and an approved carry-over on the Pasig one.
  const adv = async (n: string, branchId: string, txn: string) => prisma.cashAdvance.create({
    data: { number: `CA-2099-39${n}`, requestedById: dpPasig.id, branchId, requestedCents: 100_000, status: "APPROVED", approvedCents: 100_000, approvedAt: new Date(), approvedById: admin.id, lines: { create: [{ transactionId: txn, kind: "TRANSPORT", requestedCents: 100_000, approvedCents: 100_000 }] } },
    include: { lines: true },
  });
  const aP = await adv("01", pasig, ids.txnPasig);
  const aA = await adv("02", angono, ids.txnAngono);
  ids.advPasig = aP.id;
  ids.advAngono = aA.id;
  ids.topUpPasig = (await prisma.cashAdvanceTopUp.create({ data: { lineId: aP.lines[0].id, extraCents: 5_000, reason: "Test", status: "APPROVED", approvedCents: 5_000, requestedById: dpPasig.id } })).id;
  ids.carryPasig = (await prisma.carryOver.create({ data: { lineId: aP.lines[0].id, cents: 5_000, status: "APPROVED" } })).id;
  await prisma.cashAdvance.update({ where: { id: aA.id }, data: { requestedById: dpAngono.id } });

  // Jobs on the Pasig loan: dpAngono's own job, sent from the Angono processor branch (the old rule's case).
  ids.jobPasig = (await prisma.dpAssignment.create({ data: { loanId: lp.id, transactionId: ids.txnPasig, dpBranchId: angono, dpUserId: dpAngono.id, assignedById: admin.id, status: "ACCEPTED" } })).id;
});
afterAll(clean);

describe("funds: scope before the 'already approved' answer (D-019)", () => {
  it("someone outside the branch gets 'not found', not 'already approved'", async () => {
    await expect(decideAdvance(finAngono, ids.advPasig, { approve: true })).rejects.toThrow("Request not found.");
    await expect(decideTopUp(finAngono, ids.topUpPasig, true, null, "")).rejects.toThrow("Request not found.");
    await expect(decideCarryOver(finAngono, ids.carryPasig, true)).rejects.toThrow("Request not found.");
  });

  it("someone in the branch still gets the idempotent answer", async () => {
    expect(await decideAdvance(finAngono, ids.advAngono, { approve: true })).toMatchObject({ status: "APPROVED", already: true });
  });
});

describe("funds exception only for processors in the Finance person's branches (D-039)", () => {
  it("offers and grants only processors who work in one of their branches", async () => {
    const t = await exceptionTargets(finAngono, [dpAngono.id, dpPasig.id]);
    expect([...t]).toEqual([dpAngono.id]);
    await expect(grantException(finAngono, dpPasig.id, "")).rejects.toThrow("Pick a processor.");
    await expect(grantException(finAngono, dpAngono.id, "Weekend trip")).resolves.toBeTruthy();
  });

  it("All branches reaches any processor", async () => {
    const all = await asUser("test.finance@gdfi.ph");
    expect((await exceptionTargets(all, [dpPasig.id])).has(dpPasig.id)).toBe(true);
  });
});

describe("job pages follow the loan's branch; own job anywhere (D-039)", () => {
  it("the processor's own job on another branch's loan is visible, with its files", async () => {
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.jobPasig }, include: { loan: true } });
    expect(canSeeJob(dpAngono, a)).toBe(true);
    expect(mayOpenStageFile(dpAngono, a)).toBe(true);
  });

  it("someone else in the processor's branch does not see it (the loan is in Pasig)", async () => {
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.jobPasig }, include: { loan: true } });
    expect(canSeeJob(dpAngono2, a)).toBe(false);
    expect(mayOpenStageFile(dpAngono2, a)).toBe(false);
    // A processor of the loan's branch does.
    expect(canSeeJob(dpPasig, a)).toBe(true);
  });
});

describe("holds and problems on the processor's own job, wherever the loan is (D-039)", () => {
  it("the own processor raises and resumes a hold, and raises and resolves a problem", async () => {
    const hr = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
    const holdId = await raiseHold(dpAngono, { transactionId: ids.txnPasig, reasonId: hr.id, note: "Waiting for the borrower" });
    await resumeHold(dpAngono, holdId, "Borrower came back");
    const pr = await prisma.problemReason.findFirstOrThrow({ where: { active: true } });
    const problemId = await raiseProblem(dpAngono, { transactionId: ids.txnPasig, reasonId: pr.id, note: "Test problem" });
    await resolveProblem(dpAngono, problemId, "Fixed");
  });

  it("another processor of the same branch gets 'not found'", async () => {
    const hr = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
    await expect(raiseHold(dpAngono2, { transactionId: ids.txnPasig, reasonId: hr.id, note: "Waiting for the borrower" })).rejects.toThrow(/not found/i);
    const pr = await prisma.problemReason.findFirstOrThrow({ where: { active: true } });
    await expect(raiseProblem(dpAngono2, { transactionId: ids.txnPasig, reasonId: pr.id, note: "Test problem" })).rejects.toThrow(/not found/i);
  });
});
