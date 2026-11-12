import type { borrowerToDo } from "@/lib/services/borrower-review";
import { AlertCard, AlertRow } from "@/components/home/home-ui";
import { UsersIcon } from "@/components/ui/icons";

/** Home, for the people who review borrower details corrections (their branches): count and the oldest five. */
export function BorrowerCorrectionsCard({ data }: { data: Awaited<ReturnType<typeof borrowerToDo>> }) {
  if (!data.count) return null;
  return (
    <AlertCard id="corr-h" title="MyLoans corrections to review" count={data.count} tone="wait" icon={<UsersIcon size={15} />}
      reason="MyLoans changed a borrower's details. Accept the correction or keep the DMS details. Nothing is blocked meanwhile."
      data={{ "data-borrower-corrections-card": "" }} countData={{ "data-borrower-count": "" }}>
      <ul>
        {data.items.map((i) => (
          <AlertRow key={i.pn} href={`/loans/${i.pn}?tab=todo&correction=1`}>
            <span className="mono font-semibold text-navy">{i.pn}</span>
            <span className="min-w-0 flex-1 truncate">{i.borrowerName}</span>
            <span className="chip c-wait h-6 text-xs">{i.fields}</span>
            <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{i.since}</span>
          </AlertRow>
        ))}
      </ul>
    </AlertCard>
  );
}
