"use client";

import { FundsTypePill } from "@/components/funds/funds-type-pill";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useEffect } from "react";
import { AlertIcon, ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, FileTextIcon, PauseIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { OutsideControlToggle, ResolveProblemForm, ResumeHoldForm, type HoldBrief } from "@/components/jobs/forms";
import { SourceReviewSheet } from "@/components/loan/source-review";
import type { ReviewData } from "@/lib/services/source-review";
import { BorrowerReviewSheet } from "@/components/loan/borrower-review";
import type { BorrowerReviewData } from "@/lib/services/borrower-review";

/** Scrolls to an element and highlights it for a moment (the paper row or the title chip). */
export function flash(id: string) {
  // The title chip has a phone copy ("-m"); use whichever is on screen.
  const el = [document.getElementById(id), document.getElementById(`${id}-m`)].find((e) => e && e.getClientRects().length > 0);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.setAttribute("data-flash", "true");
  window.setTimeout(() => el.removeAttribute("data-flash"), 2500);
  return true;
}

/** After an Open items row opened a transaction (?focus=...), highlight the paper or the title chip. */
export function FocusFromUrl() {
  const focus = useSearchParams().get("focus");
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    const id = window.setInterval(() => { if (flash(focus) || ++tries > 20) window.clearInterval(id); }, 100);
    return () => window.clearInterval(id);
  }, [focus]);
  return null;
}

export interface OpenRow {
  id: string;
  kind: "problem" | "hold" | "missing" | "source" | "correction" | "returned";
  /** Overrides the kind's word on the pill ("Declined by the DP", "Returned by the DP"). */
  badge?: string;
  txnCode: string;
  txnName: string;
  /** One short reason line: the papers, or the hold or problem reason. */
  reason: string;
  /** Second short line: "Asked by Ana · from Borrower", "Raised by Joy". */
  who: string;
  /** "since 2 minutes ago", "since 1 day". */
  since: string;
  days: number;
  href: string;
  target: string;
  /** Hold: Resume is shown only to people who can resolve it. */
  canResume: boolean;
  /** Hold: the first line of the remarks ("No details were written." when there are none). */
  remarks?: string;
  /** Hold: what the Resume form shows (original reason, remarks, who and when). */
  hold?: HoldBrief;
  /** Problem: details and its actions (as before). */
  problem?: { raisedText: string; note: string; outside: boolean; canResolve: boolean; canOutside: boolean };
  /** The transaction's live funds record type (Cash advance, Fund transfer), when it has one. */
  funds?: { code: string; name: string } | null;
  /** MyLoans change under review: the review pop-up. */
  review?: ReviewData;
  /** MyLoans correction of the borrower's details: its review pop-up. */
  correction?: BorrowerReviewData;
}

const KIND: Record<OpenRow["kind"], { word: string; cls: string; Icon: typeof AlertIcon }> = {
  missing: { word: "Missing paper", cls: "c-act", Icon: FileTextIcon },
  problem: { word: "Problem", cls: "c-bad", Icon: AlertIcon },
  hold: { word: "On hold", cls: "c-hold", Icon: PauseIcon },
  source: { word: "Needs review", cls: "c-bad", Icon: AlertIcon },
  correction: { word: "Borrower details", cls: "c-wait", Icon: AlertIcon },
  returned: { word: "Returned by the DP", cls: "c-act", Icon: ArrowLeftIcon },
};
const GROUPS: { kind: OpenRow["kind"]; title: string }[] = [
  { kind: "source", title: "MyLoans changes" },
  { kind: "correction", title: "MyLoans corrections" },
  { kind: "returned", title: "Sent back to you" },
  { kind: "missing", title: "Waiting for papers" },
  { kind: "hold", title: "On hold" },
  { kind: "problem", title: "Problems" },
];

/**
 * "Open items (n)": the one place for alerts on Check documents. Grouped (Waiting for papers, On hold,
 * Problems), one row per item with one button: Resume (hold), Show paper (missing paper), Open
 * (problem: its details and actions). Pressing a row selects its transaction (?tx=). Desktop: a card at
 * the top of the sticky right column; tablet and phone (`collapsible`): one line that expands.
 * More than 4 items: 3 and "Show all (n)".
 */
export function OpenItemsCard({ rows, selected, collapsible = false }: { rows: OpenRow[]; selected: string; collapsible?: boolean }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [problem, setProblem] = useState<OpenRow | null>(null);
  const [review, setReview] = useState<OpenRow | null>(null);
  // Hold reasons: one chip per reason with its count; pressing one shows only those holds.
  const [holdReason, setHoldReason] = useState<string | null>(null);
  const holdCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.kind === "hold") m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const shownIds = useMemo(() => new Set((rows.length > 4 && !all ? rows.slice(0, 3) : rows).map((r) => r.id)), [rows, all]);
  if (!rows.length) return null;
  const select = (r: OpenRow, highlight = false) => {
    if (r.kind === "source" || r.kind === "correction") { setReview(r); return; }
    if (r.txnCode === selected) { if (highlight) flash(r.target); return; }
    router.push(highlight ? r.href : r.href.replace(/&focus=[^&]*/, ""), { scroll: false });
  };
  const body = (
    <div className="flex flex-col">
      <p className="pl-4 pr-3 pb-2 pt-1.5 text-[13px] text-ink-2">Things that need follow-up before this loan can move.</p>
      {GROUPS.map((g) => {
        const items = rows.filter((r) => r.kind === g.kind && shownIds.has(r.id) && (g.kind !== "hold" || !holdReason || r.reason === holdReason));
        if (!items.length && !(g.kind === "hold" && holdReason)) return null;
        return (
          <div key={g.kind} data-open-group={g.kind}>
            <h3 className="border-t border-line bg-fill pl-4 pr-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">{g.title}</h3>
            {g.kind === "hold" && holdCounts.length > 0 && (
              <div role="group" aria-label="Hold reasons" className="flex flex-wrap gap-1.5 border-t border-line pl-4 pr-3 py-1.5" data-hold-reason-chips>
                {holdCounts.map(([name, n]) => (
                  <button key={name} type="button" aria-pressed={holdReason === name} onClick={(e) => { e.stopPropagation(); setHoldReason(holdReason === name ? null : name); }}
                    className={`chip c-hold h-6 px-2 text-xs ${holdReason === name ? "ring-2 ring-[var(--hold-stripe)]" : ""}`} data-hold-reason={name}>
                    {name} ({n})
                  </button>
                ))}
              </div>
            )}
            <ul>
              {items.map((r) => {
                const k = KIND[r.kind];
                // Sent back to you and Waiting for papers: the whole row is the button (Open / Show paper), stacked:
                // badge, transaction, what was found or asked, then who and the date and time (PHT).
                if (r.kind === "returned" || r.kind === "missing") {
                  const action = r.kind === "missing" ? "Show paper" : "Open";
                  return (
                    <li key={r.id} data-open-row={r.kind} data-txn-code={r.txnCode} className="border-t border-line first:border-t-0">
                      <button type="button" onClick={() => select(r, r.kind === "missing")} data-open-action={action}
                        className="flex w-full items-center gap-2 py-2 pl-4 pr-3 text-left hover:bg-fill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy">
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`chip ${k.cls} h-6 px-2 text-xs`}><k.Icon size={13} strokeWidth={2.4} />{r.badge ?? k.word}</span>
                            {r.funds && <FundsTypePill code={r.funds.code} name={r.funds.name} />}
                          </span>
                          <span className="text-[14px] font-semibold text-ink">{r.txnName}</span>
                          <span className="break-words text-[13px] leading-snug text-ink" data-open-reason>{r.reason}</span>
                          <span className="text-xs text-ink-2" data-open-who>{[r.who, r.since].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="sr-only">. {action}</span>
                        <span aria-hidden="true" className="shrink-0 text-ink-2"><ChevronRightIcon size={16} /></span>
                      </button>
                    </li>
                  );
                }
                return (
                  // The whole row selects the transaction; its one button does the action.
                  <li key={r.id} onClick={() => select(r)} data-open-row={r.kind} data-txn-code={r.txnCode}
                    className="flex cursor-pointer items-center gap-2 border-t border-line pl-4 pr-3 py-2 first:border-t-0 hover:bg-fill">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${k.cls} h-6 px-2 text-xs`}><k.Icon size={13} strokeWidth={2.4} />{r.badge ?? k.word}</span>
                        <a href={r.href.replace(/&focus=[^&]*/, "")} onClick={(e) => { e.preventDefault(); e.stopPropagation(); select(r); }}
                          className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline">{r.txnName}</a>
                        {r.funds && <FundsTypePill code={r.funds.code} name={r.funds.name} />}
                      </span>
                      <span className="text-[13px] font-semibold leading-snug text-ink" data-open-reason>{r.reason}</span>
                      {r.kind === "hold" && r.remarks && <span className="line-clamp-1 break-words text-[13px] leading-snug text-ink" title={r.remarks} data-open-remarks>“{r.remarks}”</span>}
                      <span className="text-xs text-ink-2">{[r.who, r.since].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {r.kind === "hold" && r.canResume && r.hold && <ResumeHoldForm hold={r.hold} buttonClass="btn-ghost btn-sm min-h-9" />}
                      {r.kind === "problem" && <button type="button" onClick={() => setProblem(r)} className="btn-ghost btn-sm min-h-9">Open</button>}
                      {(r.kind === "source" || r.kind === "correction") && <button type="button" onClick={() => setReview(r)} className="btn-ghost btn-sm min-h-9">{r.kind === "correction" && !r.correction?.canDecide ? "See" : "Review"}</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {rows.length > 4 && !all && (
        <button type="button" onClick={() => setAll(true)} className="flex min-h-11 w-full items-center border-t border-line pl-4 pr-3 text-sm font-semibold text-navy underline underline-offset-2">Show all ({rows.length})</button>
      )}
      {review?.review && <SourceReviewSheet review={review.review} open={!!review} onClose={() => setReview(null)} />}
      {review?.correction && <BorrowerReviewSheet review={review.correction} open={!!review} onClose={() => setReview(null)} />}
      <Sheet open={!!problem} onClose={() => setProblem(null)} title={problem ? `Problem: ${problem.txnName}` : "Problem"}>
        {problem?.problem && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-bad-fg"><AlertIcon size={18} /> {problem.reason} · {problem.days} day{problem.days === 1 ? "" : "s"}</p>
            <p className="text-[15px] text-ink-2">{problem.problem.raisedText}{problem.problem.note ? ` · ${problem.problem.note}` : ""}. The turnaround time keeps counting.</p>
            {problem.problem.outside && <p><span className="chip c-wait">Outside our control</span></p>}
            <div className="flex flex-wrap gap-2">
              {problem.problem.canResolve && <ResolveProblemForm problemId={problem.id} />}
              {problem.problem.canOutside && <OutsideControlToggle problemId={problem.id} on={problem.problem.outside} />}
              {problem.txnCode !== selected && <button type="button" className="btn-ghost btn-sm" onClick={() => { setProblem(null); select(problem); }}>Go to {problem.txnName}</button>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
  // Calm frame: white card, thin light border only (the icon and each row's pill say how urgent it is).
  const urgent = rows.some((r) => r.kind === "problem" || r.kind === "source");
  const frame = "overflow-hidden rounded-[14px] border border-line-soft bg-white";
  const mark = <span className={urgent ? "text-bad-fg" : "text-hold-fg"}>{rows.every((r) => r.kind === "hold") ? <PauseIcon size={18} /> : <AlertIcon size={18} />}</span>;
  if (collapsible) {
    return (
      <details className={`group ${frame}`} data-open-items="collapsible" data-urgent={urgent || undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 pl-4 pr-3 text-[15px] font-bold text-ink">
          {mark}
          <h2 className="flex-1">{rows.length} open item{rows.length === 1 ? "" : "s"}</h2>
          <span className="text-ink-2 transition-transform group-open:rotate-180"><ChevronDownIcon size={18} /></span>
        </summary>
        <div className="border-t border-line">{body}</div>
      </details>
    );
  }
  return (
    <section aria-labelledby="open-items-h" className={`shrink-0 ${frame}`} data-open-items="card" data-urgent={urgent || undefined}>
      <h2 id="open-items-h" className="flex items-center gap-2 border-b border-line pl-4 pr-3 py-2 text-[15px] font-bold text-ink">
        {mark} Open items ({rows.length})
      </h2>
      {body}
    </section>
  );
}
