import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { branchDeciderIds } from "@/lib/services/borrower-review";
import { AlertCard, AlertRow } from "@/components/home/home-ui";
import { RefreshIcon } from "@/components/ui/icons";

const WHAT = { MATERIAL: "Changed", STATUS: "Cancelled or not released", REPLACEMENT: "Replacement PN", BORROWER: "Borrower details" } as const;

/** Admin Home: MyLoans changes waiting for review (count and the oldest five). */
export async function sourceChangesToDo() {
  // The Admin items, plus the borrower details corrections of branches with no supervisor or approver.
  const all = await prisma.sourceChange.findMany({ where: { state: "OPEN" }, orderBy: { firstSeenAt: "asc" }, include: { loan: { select: { pn: true, borrowerName: true, branchId: true } } } });
  const empty = new Map<string, boolean>();
  for (const b of new Set(all.filter((i) => i.category === "BORROWER").map((i) => i.loan.branchId))) empty.set(b, (await branchDeciderIds(prisma, b)).length === 0);
  const mine = all.filter((i) => i.category !== "BORROWER" || empty.get(i.loan.branchId));
  return { count: mine.length, items: mine.slice(0, 5) };
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
