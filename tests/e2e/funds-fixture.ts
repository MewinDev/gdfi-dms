import { db } from "./db";

/**
 * D-065: My funds for the test processor (test.dp@gdfi.ph), on fake PNs (GD99920999780n) and numbers (CA/FT-2099-61nn):
 *   01 Fe Reyes, Notary, needs funds · 02 Gil Cruz, Mortgage, needs funds (both: Transport, Notary fee, Other)
 *   03 Hana Diaz, EDST: requested · 04 Ivan Lopez, Notary: released, liquidation due in 2 days (₱1,500, ₱900 spent)
 *   05 Kim Ramos, Mortgage: liquidated · 06 Lea Tan, PPSR: a fund transfer released to the account ending 4821
 *   07 Jun Santos, Notary: released, liquidation overdue (only with `overdue`: it blocks new requests)
 */
export const FPN = (n: string) => `GD99920999780${n}`;
export const FNUM = (k: "CA" | "FT", n: string) => `${k}-2099-61${n}`;

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export async function cleanFunds() {
  const mine = { OR: [{ number: { startsWith: "CA-2099-61" } }, { number: { startsWith: "FT-2099-61" } }] };
  await db.receipt.deleteMany({ where: { line: { advance: mine } } });
  await db.cashReturn.deleteMany({ where: { advance: mine } });
  await db.cashAdvance.deleteMany({ where: { OR: [{ number: { startsWith: "CA-2099-61" } }, { number: { startsWith: "FT-2099-61" } }] } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  await db.fundsException.deleteMany({ where: { dpUserId: dp.id } });
}

export async function makeFunds(opts: { overdue?: boolean } = {}) {
  await cleanFunds();
  const [la, dp, branch, types, ca, ft, office] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } }),
    db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } }),
    db.branch.findUniqueOrThrow({ where: { code: "165" } }),
    db.transactionType.findMany({ where: { code: { in: ["NOTARY", "MORTGAGE", "EDST", "PPSR"] } } }),
    db.fundsType.findUniqueOrThrow({ where: { code: "CA" } }),
    db.fundsType.findUniqueOrThrow({ where: { code: "FT" } }),
    db.ltoOffice.findFirst({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  const job = async (n: string, name: string, code: string, funds: boolean) => {
    const loan = await db.loan.create({
      data: {
        pn: FPN(n), borrowerName: name, branchId: branch.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 350000, releasedAt: days(-10),
        sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id, classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "e2e", stage: "In process",
        transactions: { create: { typeId: type(code), status: "IN_PROCESS", ...(funds ? { fundsNeeded: "YES" as const, fundsKinds: ["TRANSPORT", "NOTARY_FEE", "OTHER"] } : {}) } },
      },
      include: { transactions: true },
    });
    const t = loan.transactions[0];
    await db.dpAssignment.create({ data: { loanId: loan.id, transactionId: t.id, dpBranchId: branch.id, dueBranchId: branch.id, dpUserId: dp.id, assignedById: la.id, status: "ACCEPTED", decidedAt: days(-2), dueDate: days(5).toISOString().slice(0, 10), targetDays: 5, ltoOfficeId: office?.id ?? null } });
    return t;
  };
  const advance = (n: string, k: "CA" | "FT", t: { id: string }, data: Record<string, unknown>, cents = 150_000) => db.cashAdvance.create({ data: {
    number: FNUM(k, n), requestedById: dp.id, branchId: branch.id, fundsTypeId: (k === "FT" ? ft : ca).id, fundsTypeCode: k, fundsTypeName: k === "FT" ? "Fund transfer" : "Cash advance",
    requestedCents: cents, ...data,
    lines: { create: [{ transactionId: t.id, kind: "TRANSPORT", requestedCents: cents, approvedCents: data.status === "REQUESTED" ? null : cents, releasedCents: data.releasedCents ?? 0 }] },
  } as never });

  const needA = await job("1", "Fe Reyes", "NOTARY", true);
  const needB = await job("2", "Gil Cruz", "MORTGAGE", true);
  const t3 = await job("3", "Hana Diaz", "EDST", false);
  const t4 = await job("4", "Ivan Lopez", "NOTARY", false);
  const t5 = await job("5", "Kim Ramos", "MORTGAGE", false);
  const t6 = await job("6", "Lea Tan", "PPSR", false);
  const requested = await advance("03", "CA", t3, { status: "REQUESTED" });
  const released = await advance("04", "CA", t4, { status: "RELEASED", approvedCents: 150_000, approvedAt: days(-3), approvedById: la.id, releasedCents: 150_000, releasedAt: days(-3), liquidationDueAt: days(2), liquidationBasis: "LTO" });
  const liquidated = await advance("05", "CA", t5, { status: "LIQUIDATED", approvedCents: 150_000, approvedAt: days(-9), releasedCents: 150_000, releasedAt: days(-9), liquidationDueAt: days(-5), liquidatedAt: days(-6), daysLate: 0 });
  const transfer = await advance("06", "FT", t6, { status: "RELEASED", approvedCents: 250_000, approvedAt: days(-1), releasedCents: 250_000, releasedAt: days(-1), releaseRef: "FT-889101", transferDate: days(-1).toISOString().slice(0, 10), accountProvider: "BPI", accountName: "Test DP", accountLast4: "4821" }, 250_000);
  // Ivan's line: ₱900 already spent (a receipt), so ₱600 is left.
  const line4 = await db.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: released.id } });
  await db.receipt.create({ data: { lineId: line4.id, date: days(-1).toISOString().slice(0, 10), cents: 90_000, number: "OR-E2E-1", uploadedById: dp.id } });
  let overdue = null;
  if (opts.overdue) {
    const t7 = await job("7", "Jun Santos", "NOTARY", false);
    overdue = await advance("07", "CA", t7, { status: "RELEASED", approvedCents: 150_000, approvedAt: days(-12), releasedCents: 150_000, releasedAt: days(-12), liquidationDueAt: days(-4), liquidationBasis: "LTO" });
  }
  return { needA, needB, requested, released, liquidated, transfer, overdue, dpId: dp.id };
}
