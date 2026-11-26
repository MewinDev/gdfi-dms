import Link from "next/link";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";
import type { LoanListCard } from "@/lib/ui/loan-cards";

/** Small pieces of the Loans list (D-059): the "something is different" chips and the one-line empty state. */

/** "Something is different" chips, each in full (they wrap onto another line rather than cut). */
export function Flags({ flags }: { flags: LoanListCard["flags"] }) {
  if (!flags.length) return null;
  return (
    <span className="contents" data-flags>
      {flags.map((f) => (
        <span key={f.text} className={`chip h-auto min-h-5 whitespace-normal px-1.5 py-0 text-xs font-semibold ${f.tone === "bad" ? "c-bad" : f.tone === "wait" ? "c-wait" : "c-act"}`}>{f.text}</span>
      ))}
    </span>
  );
}

/** An empty tab or no match: one calm line with a small icon, no card frame. */
export function EmptyLine({ text, clearHref, note, done = false }: { text: string; clearHref?: string; note?: string; done?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-1 py-2" data-empty-line>
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-ok-bg text-ok-fg" : "bg-fill text-ink-2"}`}>
          {done ? <CheckIcon size={13} strokeWidth={2.6} /> : <InfoIcon size={13} />}
        </span>
        <span>{text}</span>
        {clearHref && <Link href={clearHref} className="font-semibold text-navy underline underline-offset-2">Clear filters</Link>}
      </p>
      {note && <p className="pl-7 text-[13px] text-ink-2">{note}</p>}
    </div>
  );
}
