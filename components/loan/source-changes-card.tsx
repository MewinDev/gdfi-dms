import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { AlertIcon } from "@/components/ui/icons";

const WHAT = { MATERIAL: "Changed", STATUS: "Cancelled or not released", REPLACEMENT: "Replacement PN" } as const;

/** Admin Home: MyLoans changes waiting for review (count and the oldest five). */
export async function SourceChangesCard() {
  const [count, items] = await Promise.all([
    prisma.sourceChange.count({ where: { state: "OPEN" } }),
    prisma.sourceChange.findMany({ where: { state: "OPEN" }, orderBy: { firstSeenAt: "asc" }, take: 5, include: { loan: { select: { pn: true, borrowerName: true } } } }),
  ]);
  return (
    <section aria-labelledby="src-h" className={`card overflow-hidden ${count ? "border-2 border-bad-fg/50" : ""}`} data-source-changes-card>
      <div className="flex items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
        <span className={count ? "text-bad-fg" : "text-ink-2"}><AlertIcon size={22} /></span>
        <h2 id="src-h" className="flex-1 text-lg font-bold text-navy">MyLoans changes to review</h2>
        <span className={`text-[28px] font-bold leading-none ${count ? "text-bad-fg" : "text-navy"}`} data-source-count>{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-4 pb-4 text-[15px] text-ink-2 sm:px-6">Nothing to review. MyLoans changes that matter show up here.</p>
      ) : (
        <ul className="border-t border-line">
          {items.map((i) => (
            <li key={i.id} className="border-b border-line-soft last:border-0">
              <Link href={`/loans/${i.loan.pn}?tab=todo&review=1`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 no-underline hover:bg-fill sm:px-6">
                <span className="mono text-[14px] font-bold text-navy">{i.loan.pn}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{i.loan.borrowerName}</span>
                <span className="chip c-bad h-6 text-xs">{WHAT[i.category]}</span>
                <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{fmtShort(i.detectedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
