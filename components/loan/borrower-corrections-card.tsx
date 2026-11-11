import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import { borrowerToDo } from "@/lib/services/borrower-review";
import { AlertIcon } from "@/components/ui/icons";

/** Home, for the people who review borrower details corrections (their branches): count and the oldest five. */
export async function BorrowerCorrectionsCard({ user }: { user: CurrentUser }) {
  const { count, items } = await borrowerToDo(user);
  if (!count) return null;
  return (
    <section aria-labelledby="corr-h" className="card overflow-hidden border-2 border-wait-fg/40" data-borrower-corrections-card>
      <div className="flex items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
        <span className="text-wait-fg"><AlertIcon size={22} /></span>
        <h2 id="corr-h" className="flex-1 text-lg font-bold text-navy">MyLoans corrections to review</h2>
        <span className="text-[28px] font-bold leading-none text-wait-fg" data-borrower-count>{count}</span>
      </div>
      <p className="px-4 pb-2 text-[13px] text-ink-2 sm:px-6">MyLoans changed a borrower&apos;s details. Accept the correction or keep the DMS details. Nothing is blocked meanwhile.</p>
      <ul className="border-t border-line">
        {items.map((i) => (
          <li key={i.pn} className="border-b border-line-soft last:border-0">
            <Link href={`/loans/${i.pn}?tab=todo&correction=1`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 no-underline hover:bg-fill sm:px-6">
              <span className="mono text-[14px] font-bold text-navy">{i.pn}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{i.borrowerName}</span>
              <span className="chip c-wait h-6 text-xs">{i.fields}</span>
              <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{i.since}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
