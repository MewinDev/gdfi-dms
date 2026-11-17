import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { loanRelationScope, type CurrentUser } from "@/lib/auth/current-user";
import { AlertCard, AlertRow } from "@/components/home/home-ui";
import { RefreshIcon } from "@/components/ui/icons";

const WHAT = { MATERIAL: "Changed", STATUS: "Cancelled or not released", REPLACEMENT: "Replacement PN", BORROWER: "Borrower details" } as const;

/**
 * Home: MyLoans changes waiting for review (count and the oldest five), only for loans in the person's
 * branches (D-019; "All branches" sees every branch). Borrower details corrections have their own card.
 */
export async function sourceChangesToDo(user: CurrentUser) {
  const where = { state: "OPEN" as const, category: { not: "BORROWER" as const }, ...loanRelationScope(user) };
  const [count, items] = await Promise.all([
    prisma.sourceChange.count({ where }),
    prisma.sourceChange.findMany({ where, orderBy: { firstSeenAt: "asc" }, take: 5, include: { loan: { select: { pn: true, borrowerName: true, branchId: true } } } }),
  ]);
  return { count, items };
}

/** Shown only when something waits (Home renders nothing for zero). */
export function SourceChangesCard({ data }: { data: Awaited<ReturnType<typeof sourceChangesToDo>> }) {
  if (!data.count) return null;
  return (
    <AlertCard id="src-h" title="MyLoans changes to review" count={data.count} tone="bad" icon={<RefreshIcon size={15} />} reason="MyLoans changed loans that are open here. Review each one on its loan file."
      data={{ "data-source-changes-card": "" }} countData={{ "data-source-count": "" }}>
      <ul>
        {data.items.map((i) => (
          <AlertRow key={i.id} href={`/loans/${i.loan.pn}?tab=todo&${i.category === "BORROWER" ? "correction" : "review"}=1`}>
            <span className="mono font-semibold text-navy">{i.loan.pn}</span>
            <span className="min-w-0 flex-1 truncate">{i.loan.borrowerName}</span>
            <span className="chip c-bad h-6 text-xs">{WHAT[i.category]}</span>
            <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{fmtShort(i.detectedAt)}</span>
          </AlertRow>
        ))}
      </ul>
    </AlertCard>
  );
}
