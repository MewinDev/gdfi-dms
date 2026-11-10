"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { confirmPapersBackAction } from "@/app/actions/loan";
import { HoldSummary } from "@/components/jobs/hold-summary";
import { OutsideControlToggle, ResolveProblemForm, type HoldBrief } from "@/components/jobs/forms";
import { AlertIcon, ArrowLeftIcon, CheckIcon } from "@/components/ui/icons";
import { flash } from "./open-items-client";
import type { StepKind, StepState } from "@/lib/workflow/next-steps";

const confirmAnnounced = announcing(confirmPapersBackAction);

export interface DoNowStep {
  kind: StepKind;
  state: StepState;
  n: number;
}

export interface DoThisNowProps {
  txnId: string;
  txnName: string;
  /** Card tint: soft grey-blue (hold), soft red (problem), soft amber (returned), white with a plain border (normal work). */
  tone: "hold" | "problem" | "returned" | "normal";
  /** One quiet line under the name: "Returned by DP 1 · Round 1 · The TAT clock keeps running". */
  context: string | null;
  /** "Sender {name} is inactive. Any Loan Associate of the branch can fix it and send it again." */
  inactiveSender?: string | null;
  steps: DoNowStep[];
  /** The Loan Associate (checklist:tick): the step buttons. Others read the steps. */
  canAct: boolean;
  hold?: { brief: HoldBrief; now: string; canResume: boolean; canAddDetails: boolean; transfer: { candidates: { id: string; name: string }[] } | null; id: string };
  problems?: { id: string; reason: string; raisedText: string; note: string; outside: boolean; canResolve: boolean; canOutside: boolean }[];
  papersBack?: { dpName: string; handedAt: string; papers: { id: string; label: string; code: string | null }[]; confirmedText: string | null };
  /**
   * The DP's findings, shown once. `reason` and `papers` when the return named papers (the paper names
   * in bold, with "Go to this paper"); otherwise `findings` as written.
   */
  fix?: { dpName: string; reason: string | null; papers: { lineId: string; label: string }[]; note: string; findings: string; forSender: boolean; senderName: string | null };
  missing?: { papers: string[]; lineIds: string[]; who: string };
  tick?: { done: number; total: number; lineIds: string[] };
  /** Where the Send panel (or EDST, Mark as done) is on the page. */
  finish?: { targetId: string; edst: boolean; markDone: boolean };
}

const TITLE: Record<StepKind, string> = {
  hold: "On hold",
  problem: "Problem to fix",
  confirm: "Confirm the papers you received",
  fix: "Fix and send again",
  resend: "Fix and send again",
  missing: "Waiting for a paper",
  tick: "Tick the required papers",
  send: "Send to DP",
  finish: "Finish it",
};

const TONE: Record<DoThisNowProps["tone"], string> = {
  hold: "border-wait-line bg-wait-bg",
  problem: "border-bad-line bg-bad-bg",
  returned: "border-act-line bg-act-bg",
  normal: "border-line-soft bg-white",
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Scroll to an element, highlight it a moment, and put the keyboard on its first control. */
function goTo(id: string, focusSel = "input:not([type=hidden]):not(:disabled), select, button:not(:disabled), textarea") {
  if (!flash(id)) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const el = document.getElementById(id);
  const f = el?.matches(focusSel) ? el : el?.querySelector<HTMLElement>(focusSel);
  f?.focus({ preventScroll: true });
}

/**
 * "Do this now": the one card at the top of Check documents. The ordered steps of the open
 * transaction (lib/workflow/next-steps.ts); only the step that can be done now is open, with its
 * content and its button. Later steps are one grey line ("After step 2"); finished ones a green tick.
 * Each fact is said once here, and nowhere else on the screen.
 */
export function DoThisNow(p: DoThisNowProps) {
  const now = p.steps.find((s) => s.state === "now") ?? null;
  const total = p.steps.length;
  const headingId = `do-now-h-${p.txnId}`;
  const listRef = useRef<HTMLOListElement>(null);
  const [said, setSaid] = useState("");
  // When a step is done (the page refreshes with a new "now" step), move the keyboard to the new step's button and say it.
  const prevNow = useRef<string | null>(now ? `${now.kind}` : null);
  useEffect(() => {
    const key = now ? now.kind : null;
    const before = prevNow.current;
    prevNow.current = key;
    if (before === null || key === before) return;
    const li = listRef.current?.querySelector<HTMLElement>("[data-step-state='now']");
    const btn = li?.querySelector<HTMLElement>("[data-step-action]") ?? li?.querySelector<HTMLElement>("h3");
    if (btn && btn.tagName === "H3") btn.setAttribute("tabindex", "-1");
    btn?.focus({ preventScroll: false });
    const t = window.setTimeout(() => setSaid(now ? `Step ${now.n} of ${total}, now: ${TITLE[now.kind]}` : "All steps done"), 50);
    return () => window.clearTimeout(t);
  }, [now, total]);

  return (
    <section aria-labelledby={headingId} id={`do-now-${p.txnId}`} className={`do-now flex min-w-0 scroll-mt-28 flex-col gap-1.5 rounded-xl border px-3 py-2.5 sm:px-3.5 ${TONE[p.tone]}`} data-do-now data-tone={p.tone}>
      {/* One header line: "DO THIS NOW · Notary", then the one quiet context line. */}
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2 id={headingId} className="shrink-0 text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Do this now</h2>
          <span aria-hidden="true" className="text-ink-2">·</span>
          <span className="min-w-0 truncate text-[15px] font-bold text-navy" data-do-now-txn>{p.txnName}</span>
        </div>
        {p.context && <p className="text-xs text-ink-2" data-do-now-context>{p.context}</p>}
        {p.inactiveSender && <p className="text-xs font-semibold text-act-fg" data-inactive-sender>{p.inactiveSender}</p>}
      </div>
      <ol ref={listRef} className="flex flex-col gap-1" aria-label={`Steps for ${p.txnName}`}>
        {p.steps.map((s) => (
          <li key={s.kind} data-step={s.kind} data-step-state={s.state} aria-current={s.state === "now" ? "step" : undefined}
            className={s.state === "now" ? "rounded-lg border border-line-soft bg-white px-3 py-2" : "flex min-h-6 items-center gap-2 px-1"}>
            {s.state === "now" ? (
              <>
                <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
                  <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[11px] font-bold text-navy">{s.n}</span>
                  <span className="sr-only">Step {s.n} of {total}, now: </span>
                  {TITLE[s.kind]}
                </h3>
                <div className="mt-1.5 flex flex-col gap-1.5 text-sm text-ink">{<NowContent step={s} p={p} />}</div>
              </>
            ) : (
              <>
                <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.state === "done" ? "bg-ok-bg text-ok-fg" : "bg-fill-strong text-ink-2"}`}>
                  {s.state === "done" ? <CheckIcon size={11} strokeWidth={3} /> : s.n}
                </span>
                {/* One line: long text is cut with "…" (the full text is in the tooltip and read out). */}
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2" title={[TITLE[s.kind], lineOf(s, p)].filter(Boolean).join(" · ")}>
                  <span className="sr-only">Step {s.n} of {total}, {s.state === "done" ? "done" : "next"}: </span>
                  <span className={`font-semibold ${s.state === "done" ? "text-ok-fg" : "text-ink"}`}>{TITLE[s.kind]}</span>
                  {lineOf(s, p) && <span data-step-line> · {lineOf(s, p)}</span>}
                </span>
                {s.state === "next" && s.n > 1 && <span className="shrink-0 whitespace-nowrap text-xs text-ink-2">After step {s.n - 1}</span>}
              </>
            )}
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </section>
  );
}

/** The one grey line of a step that is not open now (null: the title says it all). */
function lineOf(s: DoNowStep, p: DoThisNowProps): string | null {
  const done = s.state === "done";
  switch (s.kind) {
    case "hold": return p.hold?.brief.reason ?? null;
    case "problem": return p.problems?.map((x) => x.reason).join(", ") ?? null;
    case "confirm":
      if (!p.papersBack) return null;
      return done ? p.papersBack.confirmedText ?? "Papers confirmed" : `${p.papersBack.dpName} handed back ${plural(p.papersBack.papers.length, "paper")}`;
    case "fix":
    case "resend":
      // Not open now: the findings are said here, once (the open step says them otherwise).
      if (!p.fix) return null;
      if (done) return `${p.fix.papers.map((x) => x.label).join(", ")} ticked again`;
      return fixText(p.fix);
    case "missing": return p.missing?.papers.join(", ") ?? null;
    case "tick": return p.tick ? (done ? `All ${plural(p.tick.total, "required paper")} ticked` : `${p.tick.done} of ${p.tick.total} required`) : null;
    case "send": return null;
    case "finish": return p.finish?.edst ? "Enter it in EDST" : p.finish?.markDone ? "Mark it as done" : null;
  }
}

const fixText = (f: NonNullable<DoThisNowProps["fix"]>) =>
  f.reason && f.papers.length ? `${f.reason}: ${f.papers.map((x) => x.label).join(", ")}${f.note ? `: ${f.note}` : ""}` : f.findings || "No findings were written.";

function ActionButton({ children, onClick, primary = true }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} data-step-action className={`${primary ? "btn-gold" : "btn-ghost"} min-h-11 w-full px-4 text-sm sm:min-h-9 sm:w-auto`}>
      {children}
    </button>
  );
}

/**
 * Every open step has the same compact shape: the text on the left (one main line, one small grey
 * line), the step's buttons on the right, centred on the text. On phone the buttons go under it.
 */
function StepRow({ main, sub, actions, ...rest }: { main: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode } & { [k: `data-${string}`]: boolean | string | undefined }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" {...rest}>
      <div className="min-w-0 flex-1">
        <div className="break-words leading-snug">{main}</div>
        {sub && <div className="text-xs leading-snug text-ink-2">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">{actions}</div>}
    </div>
  );
}

function NowContent({ step, p }: { step: DoNowStep; p: DoThisNowProps }) {
  switch (step.kind) {
    case "hold":
      return p.hold ? (
        <HoldSummary bare id={p.hold.id} hold={p.hold.brief} now={p.hold.now} canResume={p.hold.canResume} canAddDetails={p.hold.canAddDetails}
          transfer={p.hold.transfer} clockNote resumeClass="btn-gold btn-sm" />
      ) : null;
    case "problem":
      return (
        <ul className="flex flex-col gap-2">
          {(p.problems ?? []).map((x) => (
            <li key={x.id} id={`open-${x.id}`} className="scroll-mt-28" data-open-item="problem">
              <StepRow
                main={<p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-bad-fg"><AlertIcon size={13} strokeWidth={2.4} />{x.reason}{x.outside && <span className="chip c-wait h-5 px-2 text-[11px]">Outside our control</span>}</p>}
                sub={<>{x.raisedText}{x.note ? ` · ${x.note}` : ""}. The TAT clock keeps running.</>}
                actions={(x.canResolve || x.canOutside) ? (
                  <div className="flex flex-wrap gap-2 [&_button]:min-h-11 sm:[&_button]:min-h-9">
                    {x.canResolve && <ResolveProblemForm problemId={x.id} />}
                    {x.canOutside && <OutsideControlToggle problemId={x.id} on={x.outside} />}
                  </div>
                ) : null}
              />
            </li>
          ))}
        </ul>
      );
    case "confirm":
      return p.papersBack ? <ConfirmPapers txnId={p.txnId} canAct={p.canAct} {...p.papersBack} /> : null;
    case "fix":
    case "resend": {
      const f = p.fix;
      if (!f) return null;
      return (
        <StepRow data-fix-row
          main={
            <p className="flex items-start gap-1.5" data-findings>
              <span className="mt-[3px] shrink-0 text-act-fg"><ArrowLeftIcon size={12} strokeWidth={2.6} /></span>
              <span>
                {f.reason && f.papers.length ? (
                  <>{f.reason}: {f.papers.map((x, i) => <span key={x.lineId}>{i > 0 && ", "}<strong>{x.label}</strong></span>)}{f.note ? <>: {f.note}</> : null}</>
                ) : (f.findings || "No findings were written.")}
              </span>
            </p>
          }
          sub={<span className="block pl-[18px]">{f.forSender
            ? (step.kind === "fix" ? "Get the paper, tick it again, then send it again." : "Fix it, then send it again. You choose the processor again.")
            : <>It went back to {f.senderName ?? "the Loan Associate who sent it"}, who fixes it and sends it again.</>}</span>}
          actions={p.canAct && f.forSender ? (
            step.kind === "fix" && f.papers[0] ? <ActionButton onClick={() => goTo(`line-${f.papers[0].lineId}`, "input")}>Go to this paper</ActionButton>
              : step.kind === "resend" && p.finish ? <ActionButton onClick={() => goTo(p.finish!.targetId)}>Choose a processor</ActionButton> : null
          ) : null}
        />
      );
    }
    case "missing":
      return p.missing ? (
        <StepRow data-missing-row
          main={<p>Asked for: <strong>{p.missing.papers.join(", ")}</strong></p>}
          sub={<>{p.missing.who} · closes by itself when ticked</>}
          actions={p.missing.lineIds[0] ? <ActionButton onClick={() => goTo(`line-${p.missing!.lineIds[0]}`, "input")}>Show paper</ActionButton> : null}
        />
      ) : null;
    case "tick":
      return p.tick ? (
        <StepRow
          main={
            <p className="flex items-center gap-2" data-tick-progress>
              <span className="whitespace-nowrap">{p.tick.done} of {p.tick.total} required</span>
              <span className="block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-fill-strong" aria-hidden="true">
                <span className="block h-full rounded-full bg-ok-fg" style={{ width: `${p.tick.total ? Math.round((p.tick.done / p.tick.total) * 100) : 0}%` }} />
              </span>
            </p>
          }
          actions={p.canAct && p.tick.lineIds[0] ? <ActionButton onClick={() => goTo(`line-${p.tick!.lineIds[0]}`, "input")}>Go to the papers</ActionButton> : null}
        />
      ) : null;
    case "send":
      return (
        <StepRow
          main={<p>All required papers are ticked. Choose a processor and send it.</p>}
          actions={p.canAct && p.finish ? <ActionButton onClick={() => goTo(p.finish!.targetId)}>Choose a processor</ActionButton> : null}
        />
      );
    case "finish":
      return (
        <StepRow
          main={<p>{p.finish?.edst ? "Enter it in EDST, then record the reference." : "All required papers are ticked. Mark it as done."}</p>}
          actions={p.canAct && p.finish && (p.finish.edst || p.finish.markDone) ? <ActionButton onClick={() => goTo(p.finish!.targetId)}>{p.finish.edst ? "Record EDST" : "Mark as done"}</ActionButton> : null}
        />
      );
  }
}

/**
 * The papers the DP handed back with a return. One click when everything arrived ("All 7 received");
 * "Check each paper" opens the list, every paper Received unless changed. A paper marked Not
 * received raises a problem for it (the same action as before).
 */
function ConfirmPapers({ txnId, canAct, dpName, handedAt, papers }: { txnId: string; canAct: boolean; dpName: string; handedAt: string; papers: { id: string; label: string; code: string | null }[] }) {
  const [state, action] = useActionState(confirmAnnounced, null);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const uid = useId();
  const set = (id: string, lost: boolean) => setMissing((s) => { const n = new Set(s); if (lost) n.add(id); else n.delete(id); return n; });
  const n = papers.length;
  return (
    <div id="papers-back" className="scroll-mt-28" data-papers-back>
      {!canAct ? <p>{dpName} handed back {plural(n, "paper")} on {handedAt}.</p> : (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="transactionId" value={txnId} />
          {open && [...missing].map((id) => <input key={id} type="hidden" name="notReceived" value={id} />)}
          {!open ? (
            <StepRow
              main={<p>{dpName} handed back {plural(n, "paper")} on {handedAt}.</p>}
              actions={<>
                <SubmitButton className="btn-gold min-h-11 w-full px-4 text-sm sm:min-h-9 sm:w-auto" data-step-action>{n === 1 ? "Received" : `All ${n} received`}</SubmitButton>
                <button type="button" onClick={() => setOpen(true)} className="link inline-flex min-h-11 items-center justify-center text-sm sm:min-h-9" aria-expanded={false} aria-controls={`${uid}-list`} data-check-each-paper>
                  Check each paper
                </button>
              </>}
            />
          ) : (
            <>
              <StepRow main={<p>{dpName} handed back {plural(n, "paper")} on {handedAt}.</p>} sub="Mark a paper Not received if it did not arrive: a problem is raised for it." />
              <ul id={`${uid}-list`} className="flex flex-col divide-y divide-line rounded-lg border border-line bg-white" data-papers-list>
                {papers.map((x) => {
                  const lost = missing.has(x.id);
                  return (
                    <li key={x.id} className="flex flex-col gap-1 px-2.5 py-1 sm:flex-row sm:items-center sm:gap-3" data-paper-back={lost ? "missing" : "received"}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{x.label}</span>
                        {x.code && <span className="mono block text-xs text-ink-2">{x.code}</span>}
                      </span>
                      <fieldset className="flex shrink-0 gap-1">
                        <legend className="sr-only">{x.label}</legend>
                        {([["received", "Received"], ["missing", "Not received"]] as const).map(([v, label]) => (
                          <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold sm:min-h-8 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold ${(v === "missing") === lost ? (lost ? "border-act-line bg-act-bg text-act-fg" : "border-ok-line bg-ok-bg text-ok-fg") : "border-line bg-white text-ink"}`}>
                            <input type="radio" name={`paper-${x.id}`} value={v} checked={(v === "missing") === lost} onChange={() => set(x.id, v === "missing")} className="h-4 w-4 accent-[var(--navy)]" />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                <SubmitButton className="btn-gold min-h-11 w-full px-4 text-sm sm:min-h-9 sm:w-auto" data-step-action>{missing.size ? `Confirm (${missing.size} not received)` : "Confirm"}</SubmitButton>
                <button type="button" onClick={() => { setOpen(false); setMissing(new Set()); }} className="link inline-flex min-h-11 items-center justify-center text-sm sm:min-h-9">Cancel</button>
              </div>
            </>
          )}
          <FormMessage state={state} />
        </form>
      )}
    </div>
  );
}

