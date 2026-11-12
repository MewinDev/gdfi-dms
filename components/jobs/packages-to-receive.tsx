import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { txnTat } from "@/lib/jobs/view";
import { txnName } from "@/lib/ui/plain";
import { TatChip } from "./chips";
import { AlertCard } from "@/components/home/home-ui";
import { FileTextIcon } from "@/components/ui/icons";

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

/** Home to-do for the receiving LA: "Package forwarded to you: receive it", until received. Hidden when none. */
export function PackagesToReceive({ rows }: { rows: Awaited<ReturnType<typeof packagesFor>> }) {
  if (!rows.length) return null;
  return (
    <AlertCard id="receive-h" title="Package forwarded to you: receive it" count={rows.length} tone="act" icon={<FileTextIcon size={15} />} reason="The processor sent these back to you. Receive each one when it arrives." data={{ "data-packages-to-receive": "" }}>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line-soft last:border-0">
            <Link href={r.href} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 text-inherit no-underline hover:bg-fill sm:px-4" data-package={r.pn}>
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block text-[14px] font-semibold">{r.borrower}</span>
                <span className="block text-[12px] text-ink-2">{r.pn} · {r.type} · from {r.from} · {r.papers} paper{r.papers === 1 ? "" : "s"} to {r.branch}</span>
              </span>
              <TatChip data={r.tat} />
            </Link>
          </li>
        ))}
      </ul>
    </AlertCard>
  );
}
