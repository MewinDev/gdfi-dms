import Link from "next/link";
import { Avatar, ToneChip } from "@/components/ui/basics";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";
import type { LoanListCard } from "@/lib/ui/loan-cards";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * My loans (D-058): one card per loan, the same on every width, one column under 1024px and two from there.
 *   1  avatar, borrower name, the deadline chip on the right ("Late by 4 days"). The name's flex basis is its
 *      full width, so when name and chip do not fit on one line the chip moves to the next line (right-aligned)
 *      and the name keeps the whole width (it wraps only when longer than that)
 *   2  PN (monospace) and a Copy button
 *   3  branch · amount
 *   4  the next step in full (the stage map's Next step text, "Waiting for: …" on hover)
 *   5  small badges: loan type (New / Renewal), classification (Financing / Refinancing), the flags; released on
 * The whole card opens the loan file (a stretched link on the name); nothing important is cut with "…".
 */
export function MyLoansList({ cards }: { cards: LoanListCard[] }) {
  return (
    <section aria-label="Loan files" data-loan-list>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {cards.map((c) => <Row key={c.pn} c={c} />)}
      </ul>
    </section>
  );
}

function Due({ due }: { due: LoanListCard["due"] }) {
  if (!due) return null;
  // Amber or red only when due today or late; otherwise plain grey text.
  return due.hot ? <ToneChip tone={due.tone}>{due.text}</ToneChip> : <span className="inline-flex h-7 items-center text-sm text-ink-2">{due.text}</span>;
}

/** "Something is different" chips, each in full (they wrap onto another line rather than cut). */
export function Flags({ flags }: { flags: LoanListCard["flags"] }) {
  if (!flags.length) return null;
  return (
    <span className="contents" data-flags>
      {flags.map((f) => (
        <span key={f.text} className={`chip h-auto min-h-6 whitespace-normal px-2 py-0.5 text-[13px] ${f.tone === "bad" ? "c-bad" : f.tone === "wait" ? "c-wait" : "c-act"}`}>{f.text}</span>
      ))}
    </span>
  );
}

function Row({ c }: { c: LoanListCard }) {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-white px-4 py-3 hover:border-line-strong hover:bg-fill-soft" data-loan-row={c.pn}>
      {/* 1: avatar, name, deadline */}
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={c.borrowerName} size={40} />
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1 pt-1.5">
          <Link href={`/loans/${c.pn}`} className="min-w-0 flex-auto break-words text-base font-semibold leading-snug text-navy no-underline after:absolute after:inset-0 after:rounded-xl after:content-['']" data-loan-name>
            {c.borrowerName}
          </Link>
          <span className="ml-auto shrink-0" data-due><Due due={c.due} /></span>
        </div>
      </div>
      {/* 2: PN, copyable */}
      <div className="flex min-w-0 items-center gap-1 pl-[52px]">
        <span className="break-all font-mono text-[15px] text-ink" data-pn>{c.pn}</span>
        <CopyButton text={c.pn} label={`Copy PN ${c.pn}`} />
      </div>
      {/* 3: branch · amount */}
      <p className="pl-[52px] text-sm text-ink-2" data-branch-amount>{c.branch} · <span className="font-semibold tabular-nums text-ink">{c.amountText}</span></p>
      {/* 4: the next step in full */}
      <p className="pl-[52px] text-[15px] font-semibold leading-snug text-ink" title={c.nextTip} data-step data-next-text>{c.nextText}</p>
      {/* 5: badges */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[52px]" data-badges>
        {c.loanType && <span className="chip c-mute h-6 px-2 text-[13px]" data-badge="loan-type">{c.loanType}</span>}
        {c.classification && <span className="chip c-wait h-6 px-2 text-[13px]" data-badge="classification">{c.classification}</span>}
        <Flags flags={c.flags} />
        <span className="text-[13px] text-ink-2">{c.releasedText}</span>
      </div>
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
