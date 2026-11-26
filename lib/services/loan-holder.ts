import { prisma } from "@/lib/db";

/**
 * D-062: "Assigned to" in the loan details on Check documents: who has the loan now. The same rule as the Loans
 * table's Assigned to (lib/services/loan-list.ts, D-059): the person holding its latest open work item (a transaction
 * or a processor job, in their Inbox or held), else "Branch pool" when work waits in a pool, else the Loan Associate
 * who opened the loan file.
 */
export async function loanHolder(loan: { id: string; openedBy: { name: string } }): Promise<string> {
  const kinds = ["TRANSACTION", "DP_JOB"];
  const [held, pool] = await Promise.all([
    prisma.workItem.findFirst({
      where: { loanId: loan.id, state: { in: ["INBOX", "HELD"] }, holderUserId: { not: null }, kind: { in: kinds } },
      orderBy: { arrivedAt: "desc" },
      select: { holder: { select: { name: true } } },
    }),
    prisma.workItem.findFirst({ where: { loanId: loan.id, state: "POOL", kind: { in: kinds } }, select: { id: true } }),
  ]);
  return held?.holder?.name ?? (pool ? "Branch pool" : loan.openedBy.name);
}
