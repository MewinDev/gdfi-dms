import Link from "next/link";
import { Avatar, ToneChip } from "./basics";
import type { LoanCardData } from "./loan-card";

/**
 * One row of the Home "Do these next" card (UI v2). The whole row is a link.
 * Desktop: avatar, name and details, next step, deadline chip, Continue/Open.
 * Tablet and phone: avatar, name, PN and next step, chip.
 */
export function LoanRow({ d, urgent = false }: { d: LoanCardData; urgent?: boolean }) {
  return (
    <Link
      href={`/loans/${d.pn}`}
      className={`flex items-center gap-4 border-t border-[rgb(12_35_64/0.1)] px-4 py-4 text-inherit no-underline first:border-t-0 sm:px-6 lg:py-[18px] ${urgent ? "bg-gold-soft" : "hover:bg-fill"}`}
    >
      <Avatar name={d.borrowerName} />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block truncate text-base font-semibold sm:text-[17px]">{d.borrowerName}</span>
        <span className="block text-sm text-ink-2 lg:hidden">{d.pn} · {d.action}</span>
        <span className="hidden text-sm text-ink-2 lg:block">{d.pn} · {d.branch} · {d.amountText}</span>
      </span>
      <span className="hidden w-44 shrink-0 leading-snug lg:block">
        <span className="block text-sm text-ink-2">Next step</span>
        <span className="block text-[15px] font-semibold">{d.action}</span>
      </span>
      {d.chip && <span className="shrink-0"><ToneChip tone={d.chip.tone}>{d.chip.text}</ToneChip></span>}
      <span className={`hidden shrink-0 lg:inline-flex ${urgent ? "btn-navy" : "btn-ghost"}`}>{urgent ? "Continue" : "Open"}</span>
    </Link>
  );
}
