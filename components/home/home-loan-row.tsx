import Link from "next/link";
import { Avatar, ToneChip } from "@/components/ui/basics";
import type { LoanCardData } from "@/components/ui/loan-card";
import { IconTile } from "./home-ui";

/**
 * One row of Home "Do these next" (about 56px): avatar, name, then PN · branch · amount muted; on the
 * right the next step in words, the due chip and the one action. The whole row is the link. A light amber
 * background only when the loan is due today or late. On a phone the chip stays on the name line and the
 * action moves under the text.
 */
export function HomeLoanRow({ d, primary = false, due = false }: { d: LoanCardData; primary?: boolean; due?: boolean }) {
  const chip = d.chip && <ToneChip tone={d.chip.tone}>{d.chip.text}</ToneChip>;
  // Phone: a short chip ("Due today", "2 days left") stays beside the name; a long one goes on the step line,
  // so the name is never pushed out.
  const short = !!d.chip && d.chip.text.length <= 16;
  return (
    <Link
      href={`/loans/${d.pn}`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-2.5 text-inherit no-underline first:border-t-0 sm:min-h-14 sm:flex-nowrap sm:px-4 sm:py-2 ${due ? "bg-act-bg/60 hover:bg-act-bg" : "hover:bg-fill"}`}
      data-home-row={d.pn}
      data-due={due || undefined}
    >
      <Avatar name={d.borrowerName} size={32} />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold text-navy">{d.borrowerName}</span>
          {short && <span className="shrink-0 sm:hidden">{chip}</span>}
        </span>
        <span className="block truncate text-[13px] text-ink-2">{d.pn} · {d.branch} · {d.amountText}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-ink sm:hidden">
          {d.action}
          {!short && chip}
        </span>
      </span>
      <span className="hidden w-36 shrink-0 text-sm font-semibold text-ink sm:block" data-step>{d.action}</span>
      <span className="hidden w-28 shrink-0 justify-end sm:flex [&_.chip]:max-w-full [&_.chip]:truncate">{chip}</span>
      {/* Phone: the action under the text. */}
      <span aria-hidden="true" className="basis-full sm:hidden" />
      <span className={`ml-11 w-24 shrink-0 sm:ml-0 ${primary ? "btn-navy" : "btn-ghost"} min-h-9 px-3 text-sm`}>{primary ? "Continue" : "Open"}</span>
    </Link>
  );
}

/** "Waiting on others · 2" or "Problems to fix · 1": one collapsed row under Do these next that opens a compact list. */
export function CollapsedLoans({ id, title, rows, href, icon, tone = "mute", limit = 6 }: { id: string; title: string; rows: LoanCardData[]; href: string; icon?: React.ReactNode; tone?: "mute" | "bad"; limit?: number }) {
  if (!rows.length) return null;
  return (
    <details className="group rounded-lg border border-line bg-white" data-collapsed={id}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 text-[15px] font-semibold text-navy sm:px-4 [&::-webkit-details-marker]:hidden">
        {icon && <IconTile tone={tone} size="sm">{icon}</IconTile>}
        <span className="flex-1">{title} · {rows.length}</span>
        <span aria-hidden="true" className="text-ink-2 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-line">
        {rows.slice(0, limit).map((d) => <HomeLoanRow key={d.pn} d={d} />)}
      </div>
      {rows.length > limit && (
        <Link href={href} className="flex min-h-11 items-center border-t border-line px-3 text-sm font-semibold text-navy no-underline hover:bg-fill sm:px-4">See all ({rows.length})</Link>
      )}
    </details>
  );
}
