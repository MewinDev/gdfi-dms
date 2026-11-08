import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { txnTat } from "@/lib/jobs/view";
import { txnName } from "@/lib/ui/plain";
import { TatChip } from "./chips";

/** Packages forwarded to this person and not yet received (the named LA, in the branch the DP chose). */
export async function packagesFor(user: CurrentUser) {
  if (!can(user, PERMISSIONS.RETURNS_ACCEPT)) return [];
  const [rows, tats, holidays] = await Promise.all([
    prisma.dpAssignment.findMany({
      where: { receivingLaId: user.id, status: "ACCEPTED", transaction: { status: "FORWARDED" } },
      orderBy: { forwardedAt: "asc" },
      include: {
        loan: { select: { pn: true, borrowerName: true, branchId: true, branch: { select: { name: true } } } },
        receivingBranch: { select: { name: true } }, dpUser: { select: { name: true } },
        transaction: { include: { type: true, problems: { include: { reason: true } }, holds: { include: { reason: true } }, advanceLines: { include: { advance: true } }, documents: { where: { stage: "IN_TRANSIT" }, select: { id: true } } } },
      },
    }),
    getTatMap(),
    getHolidaySet(),
  ]);
  return rows.map((a) => ({
    id: a.id, pn: a.loan.pn, borrower: a.loan.borrowerName, type: txnName(a.transaction.type.code, a.transaction.type.name), from: a.dpUser.name,
    branch: a.receivingBranch?.name ?? a.loan.branch.name, papers: a.transaction.documents.length,
    tat: txnTat(a.transaction, tats, holidays),
    href: inScope(user, a.loan.branchId) ? `/loans/${a.loan.pn}?tab=todo&work=${a.transactionId}` : `/receive/${a.id}`,
  }));
}

/** Home to-do for the receiving LA: "Package forwarded to you: receive it", until received. */
export async function PackagesToReceive({ user }: { user: CurrentUser }) {
  const rows = await packagesFor(user);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="receive-h" className="card overflow-hidden" data-packages-to-receive>
      <h2 id="receive-h" className="px-4 pb-3 pt-4 text-lg font-bold text-navy sm:px-6 sm:text-xl">Package forwarded to you: receive it</h2>
      <ul className="border-t border-[rgb(12_35_64/0.1)]">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-[rgb(12_35_64/0.1)] last:border-0">
            <Link href={r.href} className="flex flex-wrap items-center gap-2 px-4 py-3 text-inherit no-underline hover:bg-fill sm:px-6" data-package={r.pn}>
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block text-[15px] font-semibold">{r.borrower}</span>
                <span className="block text-[13px] text-ink-2">{r.pn} · {r.type} · from {r.from} · {r.papers} paper{r.papers === 1 ? "" : "s"} to {r.branch}</span>
              </span>
              <TatChip data={r.tat} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
