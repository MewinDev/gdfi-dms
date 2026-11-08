import Link from "next/link";
import { Avatar, ToneChip } from "./basics";
import { ChevronRightIcon } from "./icons";
import type { Tone } from "@/lib/ui/plain";

export interface LoanCardData {
  pn: string;
  borrowerName: string;
  branch: string;
  amountText: string;
  action: string;
  chip: { text: string; tone: Tone } | null;
}

/**
 * Loan card (Home "Do these next" and My loans). The whole card is one link.
 * `urgent` = the most urgent loan: highlighted, with a navy "Continue" button.
 */
export function LoanCard({ d, urgent = false }: { d: LoanCardData; urgent?: boolean }) {
  return (
    <Link
      href={`/loans/${d.pn}`}
      className={`group block rounded-2xl border px-4 py-4 text-inherit no-underline sm:px-5 ${urgent ? "border-hl-border bg-hover" : "border-line bg-white hover:bg-hover"}`}
    >
      <span className="flex items-center gap-4">
        <Avatar name={d.borrowerName} />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-base font-bold">{d.borrowerName}</span>
          <span className="block text-sm text-ink-2">
            {d.pn}
            <span className="hidden min-[400px]:inline"> · {d.branch}</span> · {d.amountText}
          </span>
          {/* Tablet: action under the name */}
          <span className="mt-0.5 hidden text-[15px] font-semibold sm:block lg:hidden">{d.action}</span>
        </span>
        {/* Desktop: action and chip to the right */}
        <span className="hidden flex-col items-end gap-1 text-right lg:flex">
          <span className="text-sm font-semibold">{d.action}</span>
          {d.chip && <ToneChip tone={d.chip.tone}>{d.chip.text}</ToneChip>}
        </span>
        {/* Tablet: chip above the button */}
        <span className="hidden flex-col items-end gap-2 sm:flex lg:flex-row lg:items-center">
          <span className="lg:hidden">{d.chip && <ToneChip tone={d.chip.tone}>{d.chip.text}</ToneChip>}</span>
          <span className={`${urgent ? "btn-navy" : "btn-ghost"} min-w-[132px]`}>{urgent ? "Continue" : "Open"}</span>
        </span>
        {/* Phone: chip only */}
        <span className="self-start sm:hidden">{d.chip && <ToneChip tone={d.chip.tone}>{d.chip.text}</ToneChip>}</span>
      </span>
      {/* Phone: action and Continue/Open */}
      <span className="mt-3 flex items-center justify-between gap-2 sm:hidden">
        <span className="text-[15px] font-semibold">{d.action}</span>
        <span className="flex min-h-11 items-center gap-0.5 text-base font-bold text-navy">
          {urgent ? "Continue" : "Open"} <ChevronRightIcon size={18} strokeWidth={2.6} />
        </span>
      </span>
    </Link>
  );
}
