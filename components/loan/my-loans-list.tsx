import Link from "next/link";
import { Avatar, ToneChip } from "@/components/ui/basics";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";
import type { LoanListCard } from "@/lib/ui/loan-cards";

/**
 * Columns (from 640px): Borrower, Loan, Next step, Due, the action. The header row and every row use the
 * same grid, so the columns line up from row to row.
 */
const GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_9rem_6.5rem] sm:items-center sm:gap-x-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_10rem_8rem_4.5rem] lg:gap-x-4";

/**
 * My loans (Loan Associate): one block, a hairline between rows, about 56px a row, two lines in each column:
 * Borrower (avatar, name, PN · branch), Loan (amount; loan type · product), Next step (the stage map's Next
 * step text, "Waiting for: …" on hover; released on), Due, Open. A small header row only from five rows. On a phone the amount joins the PN line and the
 * loan type, product and release date go on one grey line; the whole row is the touch target (Open stays
 * for screen readers).
 */
export function MyLoansList({ cards }: { cards: LoanListCard[] }) {
  return (
    <section aria-label="Loan files" className="overflow-hidden rounded-lg border border-line bg-white" data-loan-list>
      {cards.length >= 5 && (
        <div className={`hidden border-b border-line px-4 py-2 text-[12px] text-ink-2 ${GRID}`} aria-hidden="true" data-list-head>
          <span>Borrower</span><span>Loan</span><span>Next step</span><span>Due</span><span className="hidden lg:block" />
        </div>
      )}
      <ul>
        {cards.map((c) => <Row key={c.pn} c={c} />)}
      </ul>
    </section>
  );
}

function Due({ due }: { due: LoanListCard["due"] }) {
  if (!due) return <span className="text-[13px] text-ink-2">-</span>;
  // Amber or red only when due today or late; otherwise plain grey text.
  return due.hot ? <ToneChip tone={due.tone}>{due.text}</ToneChip> : <span className="text-[13px] text-ink-2">{due.text}</span>;
}

/** "Something is different" chips: two at most, the rest as "+N" (My loans and the Loans table). */
export function Flags({ flags }: { flags: LoanListCard["flags"] }) {
  if (!flags.length) return null;
  const shown = flags.slice(0, 2);
  const rest = flags.slice(2);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" data-flags>
      {shown.map((f) => (
        <span key={f.text} title={f.text} className={`chip h-5 max-w-[14rem] truncate px-2 text-[11px] ${f.tone === "bad" ? "c-bad" : f.tone === "wait" ? "c-wait" : "c-act"}`}>{f.text}</span>
      ))}
      {rest.length > 0 && <span className="chip c-mute h-5 px-2 text-[11px]" title={rest.map((f) => f.text).join(", ")}>+{rest.length}</span>}
    </span>
  );
}

function Row({ c }: { c: LoanListCard }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link href={`/loans/${c.pn}`} className={`block px-3 py-2.5 text-inherit no-underline hover:bg-fill sm:min-h-14 sm:px-4 sm:py-2 ${GRID}`} data-loan-row={c.pn}>
        {/* Borrower: avatar, name (and on a phone the due chip), then PN · branch (· amount on a phone) and any flags. */}
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={c.borrowerName} size={32} />
          <span className="min-w-0 flex-1 leading-snug">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[15px] font-semibold text-navy">{c.borrowerName}</span>
              <span className="ml-auto shrink-0 sm:hidden"><Due due={c.due} /></span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="min-w-0 truncate text-[13px] text-ink-2">{c.pn} · {c.branch}<span className="sm:hidden"> · {c.amountText}</span></span>
              <Flags flags={c.flags} />
            </span>
            {/* Phone: the step, then the account details, on one line. */}
            <span className="block truncate text-[12px] text-ink-2 sm:hidden" data-loan-details>
              <span className="text-[13px] font-semibold text-ink" title={c.nextTip}>{c.nextText}</span>{[c.loanText, c.releasedText].filter(Boolean).map((t) => ` · ${t}`).join("")}
            </span>
          </span>
        </span>
        {/* From 640px: the amount, then loan type · product. */}
        <span className="hidden min-w-0 leading-snug sm:block" data-loan-col>
          <span className="block text-sm font-semibold tabular-nums text-ink">{c.amountText}</span>
          <span className="block truncate text-[12px] text-ink-2" title={c.loanText}>{c.loanText || "-"}</span>
        </span>
        <span className="hidden min-w-0 leading-snug sm:block" data-step>
          <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={c.nextTip} data-next-text>{c.nextText}</span>
          <span className="block truncate text-[12px] text-ink-2">{c.releasedText}</span>
        </span>
        <span className="hidden sm:block" data-due><Due due={c.due} /></span>
        {/* Under 1024px the whole row is the link; "Open" stays for keyboard and screen readers only. */}
        <span className="sr-only lg:not-sr-only lg:justify-self-end"><span className="btn-ghost min-h-8 px-3 text-[13px]">Open</span></span>
      </Link>
    </li>
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

/** The active filters as removable chips in one line, with Clear all at the end. Nothing when none is on. */
export function FilterChips({ chips, clearHref }: { chips: { text: string; removeHref: string }[]; clearHref: string }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-filter-chips>
      {chips.map((c) => (
        <Link key={c.text} href={c.removeHref} className="chip c-mute h-7 gap-1.5 text-[13px] no-underline hover:bg-fill-strong" aria-label={`Remove filter ${c.text}`}>
          {c.text} <span aria-hidden="true">×</span>
        </Link>
      ))}
      <Link href={clearHref} className="ml-1 text-[13px] font-semibold text-navy underline underline-offset-2">Clear all</Link>
    </div>
  );
}
