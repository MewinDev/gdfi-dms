"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { LockIcon, PauseIcon } from "@/components/ui/icons";
import { CLOCK_NOTE, NO_DETAILS, NO_OWNER, holdSummaryText, needsResumeBy, onlyHolderMessage } from "@/lib/ui/holds";
import { AddHoldDetailsForm, ResumeHoldForm, TransferHoldForm, type HoldBrief } from "./forms";

export interface HoldSummaryProps {
  hold: HoldBrief;
  /** The moment the page was made (ISO), so the server and the browser print the same "ago". */
  now: string;
  /** The transaction's name, when several holds can show together (Loan File banner). */
  txnName?: string;
  /** The viewer may resume it: shows Resume and "To continue: press Resume and write what changed". */
  canResume: boolean;
  /** Older hold without remarks: the hold owner may add them. */
  canAddDetails: boolean;
  /** holds:transfer in scope: "Transfer hold" with the people who can receive it. */
  transfer?: { candidates: { id: string; name: string }[] } | null;
  /** "The TAT clock keeps running", once per screen (the Loan File banner, not every row). */
  clockNote?: boolean;
  resumeClass?: string;
  id?: string;
  /** Inside the "Do this now" card: no card frame of its own. */
  bare?: boolean;
  /**
   * D-062: a row of the Loan File's On hold card (the problems card's pattern): no frame, and the title is
   * "<transaction> · <reason>" (the card's heading already says "On hold").
   */
  inList?: boolean;
}

/**
 * The one hold summary, used wherever an open hold is explained (Loan File banner, Check documents,
 * the DP job):
 *   On hold: {reason}
 *   the remarks, in full, as typed (quote style, 3 lines then "Show more")
 *   Put on hold by {name} · {date and time PHT} · {n} ago
 *   To continue: press Resume and write what changed
 * Only the person who put it on hold can resume it: everyone else (Admin included) sees Resume
 * disabled with "Only {name} can resume this." The transaction is locked until then.
 * Older holds without remarks say "No details were written." with "Add details" for the holder only. A white card with one soft amber border (D-062), or a row of the Loan File's On hold card (inList).
 */
export function HoldSummary({ hold, now, txnName, canResume, canAddDetails, transfer = null, clockNote = false, resumeClass = "btn-ghost btn-sm", id, bare = false, inList = false }: HoldSummaryProps) {
  const owner = hold.owner;
  const t = holdSummaryText({ reason: hold.reason, note: hold.note, raisedBy: hold.raisedBy, raisedAt: new Date(hold.raisedAt) }, new Date(now));
  return (
    <section id={id} role="status" aria-label={txnName ? `${txnName}: on hold` : "On hold"} className={bare || inList ? "flex scroll-mt-28 flex-row items-start gap-2 sm:gap-4" : "hold-card flex scroll-mt-28 flex-row items-start gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4 sm:pr-4"}
      data-hold-summary data-hold-open data-open-item="hold">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {inList ? (
          // A row of the On hold card: "<transaction> · <reason>" (the card's heading says "On hold").
          <h3 className="text-sm font-semibold text-ink" data-hold-title>
            {txnName && <span data-hold-txn>{txnName}</span>}{txnName ? " · " : ""}{hold.reason}
          </h3>
        ) : (
          // One line: "On hold: <reason>" and, muted, the transaction it is on.
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink" data-hold-title>
              <span className="text-hold-fg"><PauseIcon size={14} strokeWidth={2.4} /></span>{t.title}
            </h3>
            {txnName && <span className="text-xs font-semibold text-ink-2" data-hold-txn>{txnName}</span>}
          </div>
        )}
        {t.remarks ? <Remarks text={t.remarks} /> : (
          // A div, not a p: "Add details" renders a <dialog> with a form, which cannot sit inside a <p>.
          <div className="flex flex-wrap items-center gap-x-3 text-[13px] italic text-ink-2" data-remarks="none">
            <span>{NO_DETAILS}</span>
            {canAddDetails && <div className="not-italic"><AddHoldDetailsForm holdId={hold.holdId} reason={hold.reason} /></div>}
          </div>
        )}
        <p className="text-xs text-ink-2" data-hold-by>{t.byLine}</p>
        {owner && owner !== hold.raisedBy && <p className="text-[13px] text-ink-2" data-hold-owner>Hold owner now: <strong className="font-semibold text-ink">{owner}</strong></p>}
        {canResume
          ? <p className="text-xs text-ink-2" data-to-continue>{t.toContinue}</p>
          : transfer
            ? <p className="text-[13px] text-ink-2" data-only-holder>{owner ? onlyHolderMessage(owner) : NO_OWNER}</p>
            : <p className="text-[13px] text-ink-2" data-needs-resume>{needsResumeBy(owner)}</p>}
        <p className="flex items-center gap-1.5 text-xs text-ink-2" data-locked-line><LockIcon size={12} strokeWidth={2.4} />Locked until it is resumed{clockNote ? <> · <span data-clock-note>{CLOCK_NOTE}</span></> : null}</p>
      </div>
      {/* D-062 review: at the top right at every width (not under the text on a phone), small. */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {canResume
          ? <ResumeHoldForm hold={hold} buttonClass={resumeClass} />
          : <button type="button" disabled className="btn-ghost btn-xs" title={owner ? onlyHolderMessage(owner) : NO_OWNER} aria-describedby={id ? `${id}-only` : undefined} data-resume-disabled>
              <LockIcon size={14} strokeWidth={2.4} /> Resume
            </button>}
        {!canResume && <span id={id ? `${id}-only` : undefined} className="sr-only">{owner ? onlyHolderMessage(owner) : NO_OWNER}</span>}
        {transfer && <TransferHoldForm hold={hold} candidates={transfer.candidates} />}
      </div>
    </section>
  );
}

/** The remarks as typed, in quote style: 3 lines, then "Show more" when there is more. */
function Remarks({ text }: { text: string }) {
  const ref = useRef<HTMLQuoteElement>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    // Measured after layout: is anything cut off by the 3-line clamp?
    const f = window.requestAnimationFrame(() => setMore(el.scrollHeight > el.clientHeight + 1));
    return () => window.cancelAnimationFrame(f);
  }, [text, open]);
  return (
    <div>
      {/* D-062 review: no orange bar; a quiet neutral line marks the quote. */}
      <blockquote ref={ref} className={`whitespace-pre-line break-words border-l-2 border-line pl-2.5 text-[13px] leading-snug text-ink ${open ? "" : "line-clamp-3"}`} data-remarks>
        {text}
      </blockquote>
      {(more || open) && (
        <button type="button" className="link ml-3 inline-flex min-h-9 items-center text-[13px]" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
