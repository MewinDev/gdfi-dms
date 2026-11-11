"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { Sheet } from "@/components/ui/sheet";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { PauseIcon, PlayIcon } from "@/components/ui/icons";
import { announcing, NowLine, useCloseWhenDone } from "@/components/ui/live-toast";
import { DECLINE_REASONS } from "@/lib/ui/rounds";
import { NO_DETAILS, REMARKS_HELP, REMARKS_LIMIT_MESSAGE, REMARKS_MAX, durationText, holdSummaryText, remarksCounter } from "@/lib/ui/holds";

const raiseHoldAnnounced = announcing(raiseHoldAction);
const resumeHoldAnnounced = announcing(resumeHoldAction);
const addHoldDetailsAnnounced = announcing(addHoldDetailsAction);
const transferHoldAnnounced = announcing(transferHoldAction);
import {
  acceptJobAction, changeFundsFlagJobAction, completeJobAction, declineJobAction, forwardJobAction, logAttemptAction, outsideControlAction, passJobAction,
  addHoldDetailsAction, transferHoldAction, raiseHoldAction, raiseProblemAction, receivePackageAction, resolveProblemAction, resumeHoldAction,
} from "@/app/actions/jobs";
import { setFundsFlagAction } from "@/app/actions/loan";
import { MissingAtAcceptSheet } from "./return-to-la-form";
import { MISSING_NOTE, MissingPaperRow, paperCountText, type MissingPaperLine } from "./missing-paper-row";
import type { ActionState } from "@/lib/action";

type Act = (p: ActionState, fd: FormData) => Promise<ActionState>;
const FUND_KINDS: [string, string][] = [["NOTARY_FEE", "Notary fee"], ["PPSR_FEE", "PPSR fee"], ["LTO_FEE", "LTO fee"], ["TRANSPORT", "Transport"], ["OTHER", "Other"]];
export type Reason = { id: string; name: string; code?: string };

/** One-line example under the chosen hold reason (by its code; reasons added in Settings have none). */
const HOLD_EXAMPLE: Record<string, string> = {
  "NO-DP": "For example: no processor is free in the branch until Monday.",
  "CLIENT-PAPERS": "For example: the client still has to bring or sign a paper.",
  "CLIENT-DECISION": "For example: the client is deciding whether to transfer the OR/CR.",
  "BRANCH-HEAD": "For example: the branch head has to approve a correction first.",
  FUNDS: "For example: the LTO fee is not released yet.",
  "CLIENT-CORRECTIONS": "For example: the client has to correct a name on the deed.",
  "MYLOANS-UPDATE": "For example: the loan details in MyLoans have to be corrected first.",
  OTHER: "Say in the remarks what it is waiting on.",
};

/** Closes a pop-up after a successful save. */
function useCloseOnOk(state: ActionState, close: () => void) {
  useEffect(() => { if (state?.ok) close(); }, [state, close]);
}

const Hidden = ({ v }: { v: Record<string, string> }) => <>{Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>;

// ---------------------------------------------------------------------------
// Funds flag (LA until the DP accepts; DP after accepting)
// ---------------------------------------------------------------------------

export function FundsFlagForm({ transactionId, assignmentId, needed, kinds: k0, label = "Change funds flag", choices = FUND_KINDS }: { transactionId?: string; assignmentId?: string; needed: "UNANSWERED" | "YES" | "NO"; kinds: string[]; label?: string; choices?: [string, string][] }) {
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
                {choices.map(([k, l]) => (
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
 * Put on hold: Reason category (required) and Remarks (always required, at least 5 characters, with a
 * counter). There is no expected resume date. When it starts and who put it on hold are recorded by
 * the server in Philippine time; the form only shows "Starts now" and the summary shows it after saving.
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

/**
 * A remarks box with the shared limits (lib/ui/holds.ts REMARKS_MIN / REMARKS_MAX): helper text
 * "At least 5 characters, up to 500.", a counter "12 / 500" that turns amber from 450 (red above
 * 500). The form's Save stays disabled unless remarksCounter(value).ok. Used for Put on hold, Resume,
 * Add details, Decline and Return to LA.
 */
export function RemarksField({ id, label, value, onChange, error, name = "note", rows = 3 }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string | null; name?: string; rows?: number;
  /** Older callers passed these; the shared limits apply. */
  min?: number; help?: string;
}) {
  const c = remarksCounter(value);
  const tone = c.over || error ? "text-bad-fg font-semibold" : c.warn ? "text-hold-fg font-semibold" : "text-ink-2";
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <textarea id={id} name={name} required rows={rows} className="input" value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || c.over || undefined} aria-describedby={`${id}-c`} />
      <p id={`${id}-c`} className="mt-1 flex flex-wrap justify-between gap-x-3 text-[13px]" data-remarks-counter>
        <span className={error || c.over ? "font-semibold text-bad-fg" : "text-ink-2"} data-remarks-help>{error ?? (c.over ? REMARKS_LIMIT_MESSAGE : REMARKS_HELP)}</span>
        <span className={tone} data-count data-warn={c.warn || undefined}>{c.count} / {REMARKS_MAX}</span>
      </p>
    </div>
  );
}

function HoldForm({ transactionId, reasons, action, state, uid }: { transactionId: string; reasons: Reason[]; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const noteOk = remarksCounter(note).ok;
  const missing = (tried && !reason) || (state && !state.ok && state.field === "reasonId");
  const noteError = state && !state.ok && state.field === "note" ? state.error ?? null : tried && !noteOk ? REMARKS_LIMIT_MESSAGE : null;
  return (
    <form action={action} onSubmit={(e) => { if (!reason || !noteOk) { e.preventDefault(); setTried(true); } }} className="flex flex-col gap-3" noValidate>
      <Hidden v={{ transactionId }} />
      <p className="text-[15px] text-ink-2" data-purpose>Use this when the work is waiting on something outside your hands, for example the borrower or an LTO appointment. It is not a fault. The turnaround time keeps counting.</p>
      <div>
        <label htmlFor={`${uid}-r`} className="label">Reason category (required)</label>
        <select id={`${uid}-r`} name="reasonId" className="input" value={reason} onChange={(e) => setReason(e.target.value)}
          aria-invalid={missing || undefined} aria-describedby={missing ? `${uid}-re` : undefined}>
          <option value="" disabled>Pick a reason</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {missing && <p id={`${uid}-re`} className="mt-1 text-[13px] font-semibold text-bad-fg">Pick a reason</p>}
        {!missing && reason && <p className="help" data-reason-example>{HOLD_EXAMPLE[reasons.find((r) => r.id === reason)?.code ?? ""] ?? "Say in the remarks what it is waiting on."}</p>}
      </div>
      <RemarksField id={`${uid}-n`} label="Remarks (required): what is it waiting on?" value={note} onChange={setNote} error={noteError} />
      <NowLine label="Starts now" />
      <p className="-mt-1 text-[13px] text-ink-2">No expected resume date. The date and time are recorded by the system (PHT).</p>
      {state && !state.ok && state.field !== "reasonId" && state.field !== "note" && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!reason || !noteOk}>Put on hold</SubmitButton>
      </div>
    </form>
  );
}

/** What a hold is, for the Resume form: the original reason, the remarks, who and when (ISO date: serializable). */
export interface HoldBrief {
  holdId: string;
  reason: string;
  note: string;
  raisedBy: string;
  raisedAt: string;
  /** The hold owner (the only person who can resume it); null for an old hold saved without one. */
  owner: string | null;
}

/**
 * Resume: shows the original reason, the remarks and how long it has been on hold, then asks for the
 * resume remarks (required, at least 3 characters). When it resumed and who resumed it are recorded
 * by the server.
 */
export function ResumeHoldForm({ hold, buttonClass = "btn-ghost btn-sm" }: { hold: HoldBrief; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(resumeHoldAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)} data-resume><PlayIcon size={16} /> Resume</button>
      <GuardedSheet open={open} onClose={close} title="Resume the work">
        <ResumeForm hold={hold} action={action} state={state} uid={uid} />
      </GuardedSheet>
    </>
  );
}

function ResumeForm({ hold, action, state, uid }: { hold: HoldBrief; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [text, setText] = useState("");
  // The moment the pop-up opened: fixed, so "on hold for" does not change while typing.
  const [opened] = useState(() => Date.now());
  const ok = remarksCounter(text).ok;
  const bad = state && !state.ok && state.field === "note";
  const raisedAt = new Date(hold.raisedAt);
  const t = holdSummaryText({ reason: hold.reason, note: hold.note, raisedBy: hold.raisedBy, raisedAt }, new Date(opened));
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Hidden v={{ holdId: hold.holdId }} />
      <div className="hold-card flex flex-col gap-1 py-2.5 pl-5 pr-3" data-closing>
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink"><span className="text-hold-fg"><PauseIcon size={16} /></span>{t.title}</p>
        {t.remarks
          ? <blockquote className="whitespace-pre-line break-words border-l-2 border-hold-line pl-3 text-[15px] text-ink" data-remarks>{t.remarks}</blockquote>
          : <p className="text-[15px] italic text-ink-2" data-remarks>{NO_DETAILS}</p>}
        <p className="text-[13px] text-ink-2" data-on-hold-for>Put on hold by {hold.raisedBy} · on hold for {durationText(opened - raisedAt.getTime())}</p>
      </div>
      <RemarksField id={`${uid}-n`} label="Resume remarks (required): what changed?" value={text} onChange={setText} error={bad ? state.error ?? null : null} />
      <NowLine label="Resumes now" />
      {state && !state.ok && !bad && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!ok}>Resume</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Transfer hold (holds:transfer): choose the new owner (same work role as the holder) and write why.
 * Shows the reason, remarks and current owner first. It never resumes the hold.
 */
export function TransferHoldForm({ hold, candidates }: { hold: HoldBrief; candidates: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(transferHoldAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)} data-transfer-hold>Transfer hold</button>
      <GuardedSheet open={open} onClose={close} title="Transfer hold">
        <TransferBody hold={hold} candidates={candidates} action={action} state={state} uid={uid} />
      </GuardedSheet>
    </>
  );
}

function TransferBody({ hold, candidates, action, state, uid }: { hold: HoldBrief; candidates: { id: string; name: string }[]; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const ok = !!to && remarksCounter(note).ok;
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error ?? null : null);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-transfer-form>
      <Hidden v={{ holdId: hold.holdId }} />
      <div className="hold-card flex flex-col gap-1 py-2.5 pl-5 pr-3" data-transfer-current>
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink"><span className="text-hold-fg"><PauseIcon size={16} /></span>On hold: {hold.reason}</p>
        {hold.note.trim()
          ? <blockquote className="whitespace-pre-line break-words border-l-2 border-hold-line pl-3 text-[15px] text-ink">{hold.note}</blockquote>
          : <p className="text-[15px] italic text-ink-2">{NO_DETAILS}</p>}
        <p className="text-[13px] text-ink-2">Put on hold by {hold.raisedBy} · Hold owner now: <strong className="font-semibold text-ink" data-current-owner>{hold.owner ?? "nobody"}</strong></p>
      </div>
      <p className="text-[13px] text-ink-2">The new owner becomes the only person who can resume it. The reason, remarks and start stay as they are; it stays locked and the TAT clock keeps running.</p>
      <div>
        <label htmlFor={`${uid}-to`} className="label">New owner (required)</label>
        <select id={`${uid}-to`} name="toUserId" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!err("toUserId") || undefined}>
          <option value="" disabled>{candidates.length ? "Choose a person" : "Nobody can receive it (same role, active)"}</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {err("toUserId") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("toUserId")}</p>}
      </div>
      <RemarksField id={`${uid}-n`} label="Remarks (required): why it is transferred" value={note} onChange={setNote} error={err("note")} />
      <NowLine label="Transfers now" />
      {state && !state.ok && !["toUserId", "note"].includes(state.field ?? "") && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!ok}>Transfer hold</SubmitButton>
      </div>
    </form>
  );
}

/** "Add details" on an older hold without remarks (the person who put it on hold, or Admin). */
export function AddHoldDetailsForm({ holdId, reason }: { holdId: string; reason: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addHoldDetailsAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setOpen(true)} data-add-details>Add details</button>
      <GuardedSheet open={open} onClose={close} title="Add the hold details">
        <AddDetailsBody holdId={holdId} reason={reason} action={action} state={state} uid={uid} />
      </GuardedSheet>
    </>
  );
}

function AddDetailsBody({ holdId, reason, action, state, uid }: { holdId: string; reason: string; action: (fd: FormData) => void; state: ActionState; uid: string }) {
  const [note, setNote] = useState("");
  const ok = remarksCounter(note).ok;
  const bad = state && !state.ok && state.field === "note";
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Hidden v={{ holdId }} />
      <p className="text-[15px] text-ink-2">On hold: {reason}. Write what it is waiting on, so everyone can see why.</p>
      <RemarksField id={`${uid}-n`} label="Remarks (required)" value={note} onChange={setNote} error={bad ? state.error ?? null : null} />
      {state && !state.ok && !bad && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!ok}>Save the details</SubmitButton>
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


/** A paper in Review the papers. missing: the LA marked it Missing with remarks (an exception: no tick, never a reason to return). */
export interface ReceivedPaper { checkId: string | null; label: string; original: boolean; documentId: string | null; missing?: MissingPaperLine | null }

/**
 * Review: the processor confirms the papers received (one "Received by the processor" movement each
 * at Accept). A paper not received turns Accept into "Some papers are missing" (Return to LA with
 * those papers pre-selected).
 */
export function ReviewForm({ assignmentId, papers = [], laName = "the Loan Associate", returnReasons = [] }: {
  assignmentId: string; papers?: ReceivedPaper[]; laName?: string; returnReasons?: { id: string; name: string; code: string }[];
}) {
  const [state, accept] = useActionState(acceptJobAction, null);
  const [declining, setDeclining] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const canMark = returnReasons.length > 0;
  // Missing with remarks: shown in the list, never ticked, never counted as "not received".
  const present = papers.filter((p) => !p.missing);
  const missingCount = papers.length - present.length;
  const toggle = (id: string) => setMissing((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-3">
      {missingCount > 0 && <p className="text-[13px] text-ink-2" data-paper-count>{paperCountText(present.length, missingCount)}</p>}
      {papers.length > 0 && (
        <fieldset className="flex flex-col overflow-hidden rounded-xl border border-line" data-received-papers>
          <legend className="sr-only">Papers received</legend>
          {papers.map((p, i) => p.missing ? (
            <MissingPaperRow key={p.checkId ?? `m${i}`} as="div" p={p.missing} />
          ) : (
            <label key={p.checkId ?? i} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0" data-received-paper>
              {canMark && p.checkId && (
                <input type="checkbox" checked={!missing.has(p.checkId)} onChange={() => toggle(p.checkId!)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" aria-label={`${p.label}: received`} />
              )}
              <span className="min-w-0 flex-1 text-[15px]">{p.label} <span className="tag">{p.original ? "Original" : "Copy"}</span></span>
              {p.documentId && <span className="mono text-xs text-ink-2">{p.documentId}</span>}
            </label>
          ))}
        </fieldset>
      )}
      {(canMark && present.length > 0 || missingCount > 0) && (
        <div className="-mt-2 flex flex-col gap-0.5">
          {canMark && present.length > 0 && <p className="help mt-0">Untick a paper you did not receive.</p>}
          {missingCount > 0 && <p className="help mt-0" data-missing-note>{MISSING_NOTE}</p>}
        </div>
      )}
      {missing.size === 0 ? (
        <form action={accept} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId }} />
          <FormMessage state={state} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton>Accept</SubmitButton>
            <button type="button" className="btn-ghost" onClick={() => setDeclining(true)}>Decline</button>
          </div>
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
          papers={present.filter((p) => p.checkId).map((p) => ({ id: p.checkId!, label: p.label }))} preselected={[...missing]}
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
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const ok = !!reason && remarksCounter(remarks).ok;
  const bad = (f: string) => (state && !state.ok && state.field === f ? state.error ?? null : null);
  return (
    <Sheet open={open} onClose={onClose} title={mode === "decline" ? "Decline the job" : "Return to the Loan Associate"}>
      <form action={action} className="flex flex-col gap-3" noValidate data-decline-form>
        <Hidden v={{ assignmentId, mode }} />
        <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>
          It goes back to the Loan Associate who sent it, with your reason and remarks, to fix and send again. After this you will not see this job any more. The turnaround time keeps counting.
        </p>
        <fieldset>
          <legend className="label">Reason (required)</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {DECLINE_REASONS.map((r) => (
              <label key={r} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input type="radio" name="reasons" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-5 w-5 accent-[var(--navy)]" />{r}
              </label>
            ))}
          </div>
          {bad("reasons") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{bad("reasons")}</p>}
        </fieldset>
        <RemarksField id={`${uid}-r`} name="remarks" label="Remarks (required)" value={remarks} onChange={setRemarks} error={bad("remarks")} />
        <NowLine label={mode === "decline" ? "Declined now" : "Returned now"} />
        {state && !state.ok && !["reasons", "remarks"].includes(state.field ?? "") && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton disabled={!ok}>{mode === "decline" ? "Decline" : "Return"}</SubmitButton>
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
