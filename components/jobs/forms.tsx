"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { Sheet } from "@/components/ui/sheet";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { PauseIcon, PlayIcon } from "@/components/ui/icons";
import { announcing, NowLine, useCloseWhenDone } from "@/components/ui/live-toast";

const raiseHoldAnnounced = announcing(raiseHoldAction);
const resumeHoldAnnounced = announcing(resumeHoldAction);
import {
  acceptJobAction, changeFundsFlagJobAction, completeJobAction, declineJobAction, forwardJobAction, logAttemptAction, outsideControlAction, passJobAction,
  raiseHoldAction, raiseProblemAction, receivePackageAction, resolveProblemAction, resumeHoldAction,
} from "@/app/actions/jobs";
import { setFundsFlagAction } from "@/app/actions/loan";
import { MissingAtAcceptSheet } from "./return-to-la-form";
import type { ActionState } from "@/lib/action";

type Act = (p: ActionState, fd: FormData) => Promise<ActionState>;
const FUND_KINDS: [string, string][] = [["NOTARY_FEE", "Notary fee"], ["PPSR_FEE", "PPSR fee"], ["LTO_FEE", "LTO fee"], ["TRANSPORT", "Transport"], ["OTHER", "Other"]];
export type Reason = { id: string; name: string; code?: string };

/** One-line example under the chosen hold reason (by its code; reasons added in Settings have none). */
const HOLD_EXAMPLE: Record<string, string> = {
  BORROWER: "For example: the borrower still has to sign or bring a paper.",
  "OTHER-TEAM": "For example: waiting for Credit or another branch to send something.",
  "LTO-SCHEDULE": "For example: the LTO set the appointment for next week.",
  OTHER: "Say in the note what it is waiting on.",
};

/** Closes a pop-up after a successful save. */
function useCloseOnOk(state: ActionState, close: () => void) {
  useEffect(() => { if (state?.ok) close(); }, [state, close]);
}

const Hidden = ({ v }: { v: Record<string, string> }) => <>{Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>;

// ---------------------------------------------------------------------------
// Funds flag (LA until the DP accepts; DP after accepting)
// ---------------------------------------------------------------------------

export function FundsFlagForm({ transactionId, assignmentId, needed, kinds: k0, label = "Change funds flag" }: { transactionId?: string; assignmentId?: string; needed: "UNANSWERED" | "YES" | "NO"; kinds: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>((assignmentId ? changeFundsFlagJobAction : setFundsFlagAction) as Act, null);
  const [funds, setFunds] = useState<"YES" | "NO">(needed === "YES" ? "YES" : "NO");
  const [kinds, setKinds] = useState<string[]>(k0);
  const uid = useId();
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>{label}</button>
      <Sheet open={open} onClose={close} title="Does this transaction need funds?">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={assignmentId ? { assignmentId } : { transactionId: transactionId ?? "" }} />
          <fieldset className="flex gap-5">
            <legend className="sr-only">Needs funds</legend>
            {(["YES", "NO"] as const).map((v) => (
              <label key={v} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input type="radio" name="fundsNeeded" value={v} checked={funds === v} onChange={() => setFunds(v)} className="h-5 w-5 accent-[var(--navy)]" />
                {v === "YES" ? "Yes" : "No"}
              </label>
            ))}
          </fieldset>
          {funds === "YES" && (
            <fieldset aria-describedby={`${uid}-h`}>
              <legend className="label">What are the funds for?</legend>
              <div className="flex flex-wrap gap-x-5">
                {FUND_KINDS.map(([k, l]) => (
                  <label key={k} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                    <input type="checkbox" name="fundsKinds" value={k} checked={kinds.includes(k)} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} className="h-5 w-5 accent-[var(--navy)]" />
                    {l}
                  </label>
                ))}
              </div>
              <p id={`${uid}-h`} className="help">The processor will ask Finance for the amount.</p>
            </fieldset>
          )}
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton>Save</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export function RaiseProblemForm({ transactionId, reasons, label = "Raise a problem" }: { transactionId: string; reasons: Reason[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(raiseProblemAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>{label}</button>
      <Sheet open={open} onClose={close} title="Raise a problem">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ transactionId }} />
          <div>
            <label htmlFor={`${uid}-r`} className="label">Reason</label>
            <select id={`${uid}-r`} name="reasonId" required className="input" defaultValue="">
              <option value="" disabled>Pick a reason</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-n`} className="label">Note (optional)</label>
            <textarea id={`${uid}-n`} name="note" maxLength={500} rows={2} className="input" />
          </div>
          <p className="help">The turnaround time keeps counting. The problem time is shown beside it.</p>
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton>Raise problem</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}

export function ResolveProblemForm({ problemId, label = "Resume" }: { problemId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(resolveProblemAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>{label}</button>
      <Sheet open={open} onClose={close} title="Resume: resolve the problem">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ problemId }} />
          <div>
            <label htmlFor={`${uid}-n`} className="label">How was it resolved?</label>
            <textarea id={`${uid}-n`} name="note" required minLength={3} maxLength={500} rows={2} className="input" />
          </div>
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton>Resume</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}

export function OutsideControlToggle({ problemId, on }: { problemId: string; on: boolean }) {
  const [state, action] = useActionState(outsideControlAction, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <Hidden v={{ problemId, on: on ? "0" : "1" }} />
      <SubmitButton className="btn-ghost btn-sm" pendingText="Saving...">{on ? "Remove “Outside our control”" : "Tag “Outside our control”"}</SubmitButton>
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Holds (waiting on something that is not a fault). Pop-ups with the discard-confirm.
// ---------------------------------------------------------------------------


/**
 * Put on hold: Reason (required) and Note (optional). When it starts and who put it on hold are
 * recorded by the server; the form only shows "Starts now".
 */
export function PutOnHoldForm({ transactionId, reasons, buttonClass = "btn-ghost btn-sm" }: { transactionId: string; reasons: Reason[]; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(raiseHoldAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}><PauseIcon size={16} /> Put on hold</button>
      <GuardedSheet open={open} onClose={close} title="Put on hold">
        <HoldForm transactionId={transactionId} reasons={reasons} action={action} state={state} uid={uid} />
      </GuardedSheet>
    </>
  );
}

function HoldForm({ transactionId, reasons, action, state, uid }: { transactionId: string; reasons: Reason[]; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const missing = (tried && !reason) || (state && !state.ok && state.field === "reasonId");
  return (
    <form action={action} onSubmit={(e) => { if (!reason) { e.preventDefault(); setTried(true); } }} className="flex flex-col gap-3" noValidate>
      <Hidden v={{ transactionId }} />
      <p className="text-[15px] text-ink-2" data-purpose>Use this when the work is waiting on something outside your hands, for example the borrower or an LTO appointment. It is not a fault. The turnaround time keeps counting.</p>
      <div>
        <label htmlFor={`${uid}-r`} className="label">Reason</label>
        <select id={`${uid}-r`} name="reasonId" className="input" value={reason} onChange={(e) => setReason(e.target.value)}
          aria-invalid={missing || undefined} aria-describedby={missing ? `${uid}-re` : undefined}>
          <option value="" disabled>Pick a reason</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {missing && <p id={`${uid}-re`} className="mt-1 text-[13px] font-semibold text-bad-fg">Pick a reason</p>}
        {!missing && reason && <p className="help" data-reason-example>{HOLD_EXAMPLE[reasons.find((r) => r.id === reason)?.code ?? ""] ?? "Say in the note what it is waiting on."}</p>}
      </div>
      <div>
        <label htmlFor={`${uid}-n`} className="label">Note (optional)</label>
        <textarea id={`${uid}-n`} name="note" maxLength={500} rows={2} className="input" />
      </div>
      <NowLine label="Starts now" />
      {state && !state.ok && state.field !== "reasonId" && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!reason}>Put on hold</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Resume: shows what is being closed, asks for Resume remarks (required, at least 3 characters).
 * When it resumed and who resumed it are recorded by the server.
 */
export function ResumeHoldForm({ holdId, reason, days, buttonClass = "btn-primary btn-sm" }: { holdId: string; reason: string; days: number; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(resumeHoldAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}><PlayIcon size={16} /> Resume</button>
      <GuardedSheet open={open} onClose={close} title="Resume the work">
        <ResumeForm holdId={holdId} reason={reason} days={days} action={action} state={state} uid={uid} />
      </GuardedSheet>
    </>
  );
}

function ResumeForm({ holdId, reason, days, action, state, uid }: { holdId: string; reason: string; days: number; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [text, setText] = useState("");
  const ok = text.trim().length >= 3;
  const bad = state && !state.ok && state.field === "note";
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Hidden v={{ holdId }} />
      <p className="flex flex-wrap items-center gap-2 rounded-xl bg-navy px-3 py-2 text-[15px] font-semibold text-white" data-closing>
        <span className="text-gold"><PauseIcon size={16} /></span> On hold: {reason} · {days} day{days === 1 ? "" : "s"}
      </p>
      <div>
        <label htmlFor={`${uid}-n`} className="label">Resume remarks</label>
        <textarea id={`${uid}-n`} name="note" required minLength={3} maxLength={500} rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)}
          aria-invalid={bad || undefined} aria-describedby={`${uid}-h`} />
        <p id={`${uid}-h`} className={bad ? "mt-1 text-[13px] font-semibold text-bad-fg" : "help"}>{bad ? state.error : "What changed? At least 3 characters."}</p>
      </div>
      <NowLine label="Resumes now" />
      {state && !state.ok && !bad && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!ok}>Resume</SubmitButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Phase 5: the receiving LA checks the package
// ---------------------------------------------------------------------------

export function ReceivePackageForm({ assignmentId, from, papers }: { assignmentId: string; from: string; papers?: number }) {
  const [state, action] = useActionState(receivePackageAction, null);
  const [result, setResult] = useState<"complete" | "incomplete" | "other">("complete");
  const [blocking, setBlocking] = useState(false);
  const uid = useId();
  const back = result === "incomplete" || (result === "other" && blocking);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl bg-cream p-3" data-receive-form>
      <Hidden v={{ assignmentId }} />
      <p className="text-[15px] font-semibold text-navy">The package from {from}{papers ? ` (${papers} paper${papers === 1 ? "" : "s"})` : ""} is on its way to you. Check each paper when it arrives.</p>
      <fieldset className="flex flex-wrap gap-x-5">
        <legend className="sr-only">Result</legend>
        {([["complete", "Complete"], ["incomplete", "Incomplete"], ["other", "Other"]] as const).map(([v, l]) => (
          <label key={v} className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="result" value={v} checked={result === v} onChange={() => setResult(v)} className="h-5 w-5 accent-[var(--navy)]" />{l}</label>
        ))}
      </fieldset>
      {result !== "complete" && (
        <div>
          <label htmlFor={`${uid}-n`} className="label">{result === "other" ? "What is it?" : "What is missing or wrong?"}</label>
          <input id={`${uid}-n`} name="note" required minLength={3} maxLength={300} className="input" />
        </div>
      )}
      {result === "other" && (
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="blocking" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />
          This stops me receiving it (the processor must fix it)
        </label>
      )}
      {back && <p className="text-[13px] text-ink-2">The package goes back to {from}, who is told, corrects it and forwards it again.</p>}
      <FormMessage state={state} />
      <div><SubmitButton>{back ? "Record as incomplete" : "Received complete"}</SubmitButton></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// DP: review (accept / decline), return, attempt, complete, forward
// ---------------------------------------------------------------------------

const DECLINE_REASONS = ["Incomplete documents", "Wrong documents", "Unsigned pages", "Labels missing", "Wrong processor or branch", "Other"];

export interface ReceivedPaper { checkId: string | null; label: string; original: boolean; documentId: string | null; labelPrinted: boolean }

/**
 * Review: the processor confirms the papers received (one "Received by the processor" movement each
 * at Accept). A paper not received turns Accept into "Some papers are missing" (Return to LA with
 * those papers pre-selected).
 */
export function ReviewForm({ assignmentId, papers = [], laName = "the Loan Associate", returnReasons = [] }: {
  assignmentId: string; papers?: ReceivedPaper[]; laName?: string; returnReasons?: { id: string; name: string; code: string }[];
}) {
  const [state, accept] = useActionState(acceptJobAction, null);
  const [labels, setLabels] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const canMark = returnReasons.length > 0;
  const toggle = (id: string) => setMissing((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-3">
      {papers.length > 0 && (
        <fieldset className="flex flex-col rounded-xl border border-line" data-received-papers>
          <legend className="sr-only">Papers received</legend>
          {papers.map((p, i) => (
            <label key={p.checkId ?? i} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0">
              {canMark && p.checkId && (
                <input type="checkbox" checked={!missing.has(p.checkId)} onChange={() => toggle(p.checkId!)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" aria-label={`${p.label}: received`} />
              )}
              <span className="min-w-0 flex-1 text-[15px]">{p.label} <span className="tag">{p.original ? "Original" : "Copy"}</span></span>
              {p.documentId && <span className="mono text-xs text-ink-2">{p.documentId}</span>}
              <span className={`chip ${p.labelPrinted ? "c-ok" : "c-act"}`}>{p.labelPrinted ? "Label printed" : "Label not printed"}</span>
            </label>
          ))}
        </fieldset>
      )}
      {canMark && papers.length > 0 && <p className="help -mt-2">Untick a paper you did not receive.</p>}
      {missing.size === 0 ? (
        <form action={accept} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId }} />
          <label className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" name="labels" checked={labels} onChange={(e) => setLabels(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />
            Labels are on all papers
          </label>
          <FormMessage state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton disabled={!labels}>Accept</SubmitButton>
            <button type="button" className="btn-ghost" onClick={() => setDeclining(true)}>Decline</button>
          </div>
          {!labels && <p className="help">Tick “Labels are on all papers” to accept.</p>}
        </form>
      ) : (
        <div className="flex flex-col gap-2" data-some-missing>
          <p className="text-[15px] font-semibold text-act-fg">{missing.size} paper{missing.size === 1 ? "" : "s"} not received.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setMissingOpen(true)}>Some papers are missing</button>
            <button type="button" className="btn-ghost" onClick={() => setDeclining(true)}>Decline</button>
          </div>
        </div>
      )}
      <ReasonsSheet open={declining} onClose={() => setDeclining(false)} assignmentId={assignmentId} mode="decline" />
      {canMark && (
        <MissingAtAcceptSheet
          open={missingOpen} onClose={() => setMissingOpen(false)} assignmentId={assignmentId} laName={laName} reasons={returnReasons}
          papers={papers.filter((p) => p.checkId).map((p) => ({ id: p.checkId!, label: p.label }))} preselected={[...missing]}
        />
      )}
    </div>
  );
}

export function ReturnToLaButton({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Return to Loan Associate</button>
      <ReasonsSheet open={open} onClose={() => setOpen(false)} assignmentId={assignmentId} mode="return" />
    </>
  );
}

function ReasonsSheet({ open, onClose, assignmentId, mode }: { open: boolean; onClose: () => void; assignmentId: string; mode: "decline" | "return" }) {
  const [state, action] = useActionState(declineJobAction, null);
  useCloseOnOk(state, onClose);
  const uid = useId();
  return (
    <Sheet open={open} onClose={onClose} title={mode === "decline" ? "Decline the job" : "Return to the Loan Associate"}>
      <form action={action} className="flex flex-col gap-3">
        <Hidden v={{ assignmentId, mode }} />
        <fieldset>
          <legend className="label">Reasons (pick at least one)</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {DECLINE_REASONS.map((r) => (
              <label key={r} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" name="reasons" value={r} className="h-5 w-5 accent-[var(--navy)]" />{r}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`${uid}-r`} className="label">Remarks</label>
          <textarea id={`${uid}-r`} name="remarks" required minLength={3} maxLength={500} rows={2} className="input" />
        </div>
        <FormMessage state={state} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton>{mode === "decline" ? "Decline" : "Return"}</SubmitButton>
        </div>
      </form>
    </Sheet>
  );
}

export interface SpendLine { lineId: string; label: string; balanceCents: number }

/** "Log today's attempt": spends per line, receipt hint, Done / Not processed, then carry over or return the rest. */
export function AttemptForm({ assignmentId, today, reasons, lines, blocked }: { assignmentId: string; today: string; reasons: Reason[]; lines: SpendLine[]; blocked?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(logAttemptAction, null);
  const [result, setResult] = useState<"DONE" | "NOT_PROCESSED">("DONE");
  const [date, setDate] = useState(today);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [rest, setRest] = useState<"NONE" | "CARRY_OVER" | "RETURN">("NONE");
  const [spends, setSpends] = useState<Record<string, string>>({});
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  const toC = (t: string) => Math.round(Number((t || "0").replace(/,/g, "")) * 100);
  const payload = JSON.stringify({
    date, result, reasonId: result === "NOT_PROCESSED" ? reasonId : null, note, rest,
    spends: lines.map((l) => ({ lineId: l.lineId, cents: toC(spends[l.lineId] ?? "") })).filter((s) => Number.isFinite(s.cents) && s.cents > 0),
  });
  const left = lines.reduce((s, l) => s + l.balanceCents - (toC(spends[l.lineId] ?? "") || 0), 0);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)} disabled={!!blocked} aria-describedby={blocked ? `${uid}-b` : undefined}>Log today&rsquo;s attempt</button>
      {blocked && <p id={`${uid}-b`} role="status" className="text-sm font-semibold text-bad-fg">{blocked}</p>}
      <Sheet open={open} onClose={close} title="Log today's attempt">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId, json: payload }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-d`} className="label">Date</label>
              <input id={`${uid}-d`} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="input" required />
            </div>
          </div>
          {lines.length > 0 && (
            <fieldset>
              <legend className="label">What did you spend? (PHP)</legend>
              <div className="flex flex-col gap-2">
                {lines.map((l) => (
                  <div key={l.lineId} className="grid grid-cols-[1fr_8rem] items-center gap-2">
                    <label htmlFor={`${uid}-s-${l.lineId}`} className="text-[15px]">{l.label} <span className="text-[13px] text-ink-2">· left ₱{(l.balanceCents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span></label>
                    <input id={`${uid}-s-${l.lineId}`} inputMode="decimal" value={spends[l.lineId] ?? ""} onChange={(e) => setSpends((x) => ({ ...x, [l.lineId]: e.target.value }))} className="input" placeholder="0.00" />
                  </div>
                ))}
              </div>
              <p className="help">Add the receipt under My funds → Liquidation.</p>
            </fieldset>
          )}
          <fieldset className="flex flex-wrap gap-x-5">
            <legend className="label">Result</legend>
            <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={result === "DONE"} onChange={() => setResult("DONE")} className="h-5 w-5 accent-[var(--navy)]" />Done</label>
            <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={result === "NOT_PROCESSED"} onChange={() => setResult("NOT_PROCESSED")} className="h-5 w-5 accent-[var(--navy)]" />Not processed</label>
          </fieldset>
          {result === "NOT_PROCESSED" && (
            <div>
              <label htmlFor={`${uid}-r`} className="label">Why not?</label>
              <select id={`${uid}-r`} value={reasonId} onChange={(e) => setReasonId(e.target.value)} required className="input">
                <option value="" disabled>Pick a reason</option>
                {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="help">This opens a problem. The turnaround time keeps counting.</p>
            </div>
          )}
          <div>
            <label htmlFor={`${uid}-n`} className="label">Note (optional)</label>
            <input id={`${uid}-n`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="input" />
          </div>
          {lines.length > 0 && left > 0 && (
            <fieldset className="flex flex-wrap gap-x-5">
              <legend className="label">The rest of the cash (₱{(left / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })})</legend>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={rest === "NONE"} onChange={() => setRest("NONE")} className="h-5 w-5 accent-[var(--navy)]" />Decide later</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={rest === "CARRY_OVER"} onChange={() => setRest("CARRY_OVER")} className="h-5 w-5 accent-[var(--navy)]" />Carry over</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={rest === "RETURN"} onChange={() => setRest("RETURN")} className="h-5 w-5 accent-[var(--navy)]" />Return to Finance</label>
            </fieldset>
          )}
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton>Save attempt</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}

/** Complete: the stage reference by transaction type. */
export function CompleteForm({ assignmentId, code, today }: { assignmentId: string; code: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(completeJobAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  const f = (name: string, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <div key={name}>
      <label htmlFor={`${uid}-${name}`} className="label">{label}</label>
      <input id={`${uid}-${name}`} name={name} type={type} required className="input" aria-invalid={state?.field === name} {...extra} />
    </div>
  );
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Complete</button>
      <Sheet open={open} onClose={close} title="Complete the job">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId }} />
          <div className="grid gap-3 sm:grid-cols-2">
            {code === "NOTARY" && [f("name", "Notary public"), f("docNo", "Doc. no."), f("pageNo", "Page no."), f("bookNo", "Book no."), f("series", "Series (year)", "text", { defaultValue: today.slice(0, 4) })]}
            {code === "PPSR" && [f("registrationNo", "PPSR registration no."), f("registrationDate", "Registration date", "date", { max: today }), f("certificate", "Certificate reference")]}
            {code === "MORTGAGE" && [f("droppedAt", "Dropped at the LTO", "date", { max: today }), f("pickedUpAt", "Annotated OR/CR picked up", "date", { max: today })]}
            {!["NOTARY", "PPSR", "MORTGAGE"].includes(code) && f("note", "What was done")}
          </div>
          {code === "MORTGAGE" && (
            <label className="inline-flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" name="annotatedOrCr" required className="h-5 w-5 accent-[var(--navy)]" />I have the annotated OR/CR</label>
          )}
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton>Save and complete</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}

export function ForwardForm({ assignmentId, las, defaultId }: { assignmentId: string; las: { id: string; name: string }[]; defaultId?: string }) {
  const [state, action] = useActionState(forwardJobAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Hidden v={{ assignmentId }} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`${uid}-la`} className="label">Forward the package to</label>
        <select id={`${uid}-la`} name="receivingLaId" required defaultValue={defaultId ?? las[0]?.id} className="input">
          {las.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <SubmitButton>Forward</SubmitButton>
      {state && <div className="sm:basis-full"><FormMessage state={state} /></div>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Pasuyo: pass the job to a second processor
// ---------------------------------------------------------------------------

export interface PasuyoProcessor { id: string; name: string; branchIds: string[] }

/** "Pasuyo: pass to another processor". Asks what happens to cash held for the job before it can be sent. */
export function PasuyoForm({ assignmentId, branches, processors, defaultBranchId, heldText }: {
  assignmentId: string;
  branches: { id: string; name: string }[];
  /** Active processors other than the current ones. */
  processors: PasuyoProcessor[];
  defaultBranchId: string;
  /** "₱500.00" when the person holds released, unliquidated cash for this job. */
  heldText: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(passJobAction, null);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [funds, setFunds] = useState<"" | "RETURN" | "HAND">("");
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  const here = processors.filter((p) => p.branchIds.includes(branchId));
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Pasuyo: pass to another processor</button>
      <Sheet open={open} onClose={close} title="Pass to a second processor (Pasuyo)">
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId }} />
          {heldText && (
            <fieldset className="rounded-xl border-2 border-gold bg-gold-soft p-3">
              <legend className="px-1 text-[15px] font-semibold text-navy">You hold {heldText} for this job. What happens to it?</legend>
              <label className="flex min-h-11 items-start gap-2 py-1 text-[15px]">
                <input type="radio" name="funds" value="RETURN" required checked={funds === "RETURN"} onChange={() => setFunds("RETURN")} className="mt-1 h-5 w-5 accent-[var(--navy)]" />
                <span><strong>Return the cash</strong> to Finance. Finance confirms it when they get it.</span>
              </label>
              <label className="flex min-h-11 items-start gap-2 py-1 text-[15px]">
                <input type="radio" name="funds" value="HAND" required checked={funds === "HAND"} onChange={() => setFunds("HAND")} className="mt-1 h-5 w-5 accent-[var(--navy)]" />
                <span><strong>Hand the balance to the second processor.</strong> They liquidate it; Finance is told.</span>
              </label>
            </fieldset>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-b`} className="label">Branch</label>
              <select id={`${uid}-b`} value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-p`} className="label">Second processor</label>
              <select id={`${uid}-p`} name="toUserId" required defaultValue="" key={branchId} className="input" aria-invalid={state?.field === "toUserId"}>
                <option value="" disabled>{here.length ? "Pick a processor" : "No processor in this branch"}</option>
                {here.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-r`} className="label">Why is a second processor needed?</label>
            <input id={`${uid}-r`} name="reason" required minLength={3} maxLength={300} className="input" aria-invalid={state?.field === "reason"} />
          </div>
          <div>
            <label htmlFor={`${uid}-n`} className="label">Note (optional)</label>
            <input id={`${uid}-n`} name="note" maxLength={500} className="input" />
          </div>
          <p className="help">The turnaround time keeps counting. You and the second processor both see the job.</p>
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton disabled={!!heldText && !funds}>Pass the job</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}
