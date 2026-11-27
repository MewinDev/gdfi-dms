import { db } from "./db";

/**
 * D-064: five jobs for the test processor (test.dp@gdfi.ph), one of each kind, on fake PNs (GD99920999770n):
 *   01 To review (Notary, sent today) · 02 In process, late, needs funds (Mortgage) · 03 In process, plenty of time (EDST)
 *   04 Forwarded (Notary) · 05 Done (Mortgage). Sent by the test Loan Associate. resetLoans() removes them.
 */
export const JOB_PN = (n: string) => `GD99920999770${n}`;
export const JOB_NAMES: Record<string, string> = { "1": "Ana Reyes", "2": "Ben Cruz", "3": "Carla Diaz", "4": "Dan Lopez", "5": "Ella Santos" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

export async function makeJobs() {
  const [la, dp, branch, types] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } }),
    db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } }),
    db.branch.findUniqueOrThrow({ where: { code: "165" } }),
    db.transactionType.findMany({ where: { code: { in: ["NOTARY", "MORTGAGE", "EDST"] } } }),
  ]);
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  const make = async (n: string, code: string, txnStatus: string, job: Record<string, unknown>, txn: Record<string, unknown> = {}) => {
    const loan = await db.loan.create({
      data: {
        pn: JOB_PN(n), borrowerName: JOB_NAMES[n], branchId: branch.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 350000, releasedAt: daysFromNow(-10),
        sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id, cin: `CIN-JOB-${n}`,
        classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "e2e", stage: "In process",
        transactions: { create: { typeId: type(code), status: txnStatus as never, ...txn } },
      },
      include: { transactions: true },
    });
    return db.dpAssignment.create({ data: { loanId: loan.id, transactionId: loan.transactions[0].id, dpBranchId: branch.id, dueBranchId: branch.id, dpUserId: dp.id, assignedById: la.id, ...job } as never });
  };
  return {
    review: await make("1", "NOTARY", "ASSIGNED", { status: "PENDING_ACCEPTANCE", endorsedAt: new Date() }),
    late: await make("2", "MORTGAGE", "IN_PROCESS", { status: "ACCEPTED", decidedAt: daysFromNow(-12), endorsedAt: daysFromNow(-13), dueDate: ymd(daysFromNow(-3)), targetDays: 5 }, { fundsNeeded: "YES" }),
    plenty: await make("3", "EDST", "IN_PROCESS", { status: "ACCEPTED", decidedAt: new Date(), endorsedAt: new Date(), dueDate: ymd(daysFromNow(14)), targetDays: 10 }),
    forwarded: await make("4", "NOTARY", "FORWARDED", { status: "ACCEPTED", decidedAt: daysFromNow(-6), endorsedAt: daysFromNow(-7), forwardedAt: daysFromNow(-1), dueDate: ymd(daysFromNow(-1)), targetDays: 5 }),
    done: await make("5", "MORTGAGE", "COMPLETED", { status: "CLOSED", decidedAt: daysFromNow(-9), endorsedAt: daysFromNow(-10), forwardedAt: daysFromNow(-3), closedAt: daysFromNow(-2), dueDate: ymd(daysFromNow(-2)), targetDays: 5 }),
  };
}
