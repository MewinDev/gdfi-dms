"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useEffect } from "react";
import { AlertIcon, ChevronDownIcon, PauseIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { OutsideControlToggle, ResolveProblemForm, ResumeHoldForm } from "@/components/jobs/forms";
import { SourceReviewSheet } from "@/components/loan/source-review";
import type { ReviewData } from "@/lib/services/source-review";

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
  kind: "problem" | "hold" | "missing" | "source";
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
  /** Problem: details and its actions (as before). */
  problem?: { raisedText: string; note: string; outside: boolean; canResolve: boolean; canOutside: boolean };
  /** MyLoans change under review: the review pop-up. */
  review?: ReviewData;
}

const KIND: Record<OpenRow["kind"], { word: string; cls: string; Icon: typeof AlertIcon }> = {
  missing: { word: "Missing paper", cls: "c-bad", Icon: AlertIcon },
  problem: { word: "Problem", cls: "c-bad", Icon: AlertIcon },
  hold: { word: "On hold", cls: "c-navy", Icon: PauseIcon },
  source: { word: "Needs review", cls: "c-bad", Icon: AlertIcon },
};
const GROUPS: { kind: OpenRow["kind"]; title: string }[] = [
  { kind: "source", title: "MyLoans changes" },
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
  const shownIds = useMemo(() => new Set((rows.length > 4 && !all ? rows.slice(0, 3) : rows).map((r) => r.id)), [rows, all]);
  if (!rows.length) return null;
  const select = (r: OpenRow, highlight = false) => {
    if (r.kind === "source") { setReview(r); return; }
    if (r.txnCode === selected) { if (highlight) flash(r.target); return; }
    router.push(highlight ? r.href : r.href.replace(/&focus=[^&]*/, ""), { scroll: false });
  };
  const body = (
    <div className="flex flex-col">
      <p className="px-3 pb-2 pt-1.5 text-[13px] text-ink-2">Things that need follow-up before this loan can move.</p>
      {GROUPS.map((g) => {
        const items = rows.filter((r) => r.kind === g.kind && shownIds.has(r.id));
        if (!items.length) return null;
        return (
          <div key={g.kind} data-open-group={g.kind}>
            <h3 className="border-t border-line bg-fill px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">{g.title}</h3>
            <ul>
              {items.map((r) => {
                const k = KIND[r.kind];
                return (
                  // The whole row selects the transaction; its one button does the action.
                  <li key={r.id} onClick={() => select(r)} data-open-row={r.kind} data-txn-code={r.txnCode}
                    className="flex cursor-pointer items-center gap-2 border-t border-line px-3 py-2 first:border-t-0 hover:bg-fill">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${k.cls} h-6 px-2 text-xs`}><span className={r.kind === "hold" ? "text-gold" : undefined}><k.Icon size={13} strokeWidth={2.4} /></span>{k.word}</span>
                        <a href={r.href.replace(/&focus=[^&]*/, "")} onClick={(e) => { e.preventDefault(); e.stopPropagation(); select(r); }}
                          className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline">{r.txnName}</a>
                      </span>
                      <span className="text-[13px] leading-snug text-ink">{r.reason}</span>
                      <span className="text-xs text-ink-2">{[r.who, r.since].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {r.kind === "missing" && (
                        <button type="button" onClick={() => select(r, true)} className="btn-ghost btn-sm min-h-9">Show paper</button>
                      )}
                      {r.kind === "hold" && r.canResume && <ResumeHoldForm holdId={r.id} reason={r.reason} days={r.days} buttonClass="btn-navy btn-sm min-h-9" />}
                      {r.kind === "problem" && <button type="button" onClick={() => setProblem(r)} className="btn-ghost btn-sm min-h-9">Open</button>}
                      {r.kind === "source" && <button type="button" onClick={() => setReview(r)} className="btn-ghost btn-sm min-h-9">Review</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {rows.length > 4 && !all && (
        <button type="button" onClick={() => setAll(true)} className="flex min-h-11 w-full items-center border-t border-line px-3 text-sm font-semibold text-navy underline underline-offset-2">Show all ({rows.length})</button>
      )}
      {review?.review && <SourceReviewSheet review={review.review} open={!!review} onClose={() => setReview(null)} />}
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
  if (collapsible) {
    return (
      <details className="group card overflow-hidden border-2 border-bad-fg/50" data-open-items="collapsible">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-[15px] font-bold text-bad-fg">
          <AlertIcon size={18} />
          <h2 className="flex-1">{rows.length} open item{rows.length === 1 ? "" : "s"}</h2>
          <span className="text-ink-2 transition-transform group-open:rotate-180"><ChevronDownIcon size={18} /></span>
        </summary>
        <div className="border-t border-line">{body}</div>
      </details>
    );
  }
  return (
    <section aria-labelledby="open-items-h" className="card shrink-0 overflow-hidden border-2 border-bad-fg/50" data-open-items="card">
      <h2 id="open-items-h" className="flex items-center gap-2 border-b border-line bg-bad-bg px-3 py-2 text-[15px] font-bold text-bad-fg">
        <AlertIcon size={18} /> Open items ({rows.length})
      </h2>
      {body}
    </section>
  );
}
