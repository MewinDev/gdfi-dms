"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { announcing, NowLine, useCloseWhenDone } from "@/components/ui/live-toast";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { useSearchParams } from "next/navigation";

const requestMissingAnnounced = announcing(requestMissingAction);
import { SendPanel, type SendOptions } from "./send-panel";
import {
  recordEdstAction, reportProblemAction, requestMissingAction,
  resolveExceptionAction, saveChecklistAction,
} from "@/app/actions/loan";
import { Sheet } from "@/components/ui/sheet";
import { ToneChip } from "@/components/ui/basics";
import { AlertIcon, CheckIcon, PauseIcon, PlusIcon, InfoIcon } from "@/components/ui/icons";
import { plainMessage } from "@/lib/ui/plain";
import { checklistStatus, type ChecklistStatus } from "@/lib/workflow/checklist";

type Result = { ok: boolean; message?: string; error?: string; field?: string; missing?: string[] } | null;

// ===========================================================================
// Checklist rows
// ===========================================================================

export interface Line {
  id: string;
  label: string;
  kind: "REQUIRED" | "ONE_OF" | "OPTIONAL" | "OTHER";
  group: string | null;
  originality: "ORIGINAL" | "COPY" | string;
  checked: boolean;
  documentId: string | null;
  /** Copied onto this loan file's line when it was opened. */
  required: boolean;
  /** False when the rule was switched off in Settings (then it never counts). */
  active: boolean;
  /** Asked for in an open missing-paper request and still not ticked. */
  requested?: boolean;
  /** "Asked by Ana Cruz · 2 minutes ago · from Borrower" (shown on hover or focus of the tag). */
  requestedInfo?: string;
}

/** Same rule as the server (lib/workflow/checklist.ts), on the ticks as they are on screen. */
export function statusFor(lines: Line[], checked: Set<string>): ChecklistStatus {
  return checklistStatus(
    lines.map((l) => ({
      id: l.id, label: l.label, checked: checked.has(l.id), required: l.required, active: l.active,
      group: l.kind === "ONE_OF" ? l.group ?? l.label : null,
    })),
  );
}

function ChecklistRow({ l, on, disabled, onToggle, highlight }: { l: Line; on: boolean; disabled: boolean; onToggle: () => void; highlight: boolean }) {
  return (
    <label
      id={`line-${l.id}`}
      data-highlight={highlight ? "true" : undefined}
      title={l.documentId ?? undefined}
      className={`flex min-h-12 scroll-mt-28 cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-1.5 transition-[box-shadow,border-color] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${highlight ? "border-gold shadow-[0_0_0_3px_var(--act-bg)]" : "border-line"} ${on ? "bg-fill-soft" : "bg-white"} ${disabled ? "cursor-default" : "hover:border-navy/40"}`}
    >
      <span className={`relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.3)] bg-white"}`}>
        {on && <CheckIcon size={14} strokeWidth={3} />}
        {/* Real checkbox, transparent, exactly over the drawn box */}
        <input type="checkbox" className="absolute -inset-0.5 m-0 cursor-pointer opacity-0 disabled:cursor-default" checked={on} disabled={disabled} onChange={onToggle} />
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className={`text-[15px] ${on ? "font-semibold text-ink" : l.required ? "font-semibold text-ink" : "font-medium text-ink-2"}`}>{l.label}</span>
        {l.documentId && <span className="mono ml-2 text-xs text-ink-2">{l.documentId}</span>}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {l.requested && !on && (
          <span tabIndex={0} title={l.requestedInfo} aria-label={`Requested. ${l.requestedInfo ?? ""}`} data-requested
            className="group/req relative rounded-md bg-bad-bg px-1.5 py-0.5 text-xs font-semibold text-bad-fg outline-none focus-visible:outline-2 focus-visible:outline-navy">
            Requested
            {l.requestedInfo && (
              <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 hidden w-max max-w-[240px] whitespace-normal rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover/req:block group-focus/req:block">
                {l.requestedInfo}
              </span>
            )}
          </span>
        )}
        {l.required
          ? <span className="rounded-md bg-act-bg px-1.5 py-0.5 text-xs font-semibold text-act-fg">Required</span>
          : <span className="rounded-md bg-fill-strong px-1.5 py-0.5 text-xs font-semibold text-ink-2">Optional</span>}
        <span className="text-xs text-ink-2">{l.originality === "ORIGINAL" ? "Original" : "Copy"}</span>
      </span>
    </label>
  );
}

// ===========================================================================
// Transaction work card: checklist (auto-save) + action area
// ===========================================================================

export type { SendOptions } from "./send-panel";

export interface WorkCardProps {
  txnId: string;
  /** Position in the loan file (1, 2, 3...) and how many transactions it has. */
  index: number;
  total?: number;
  code: string;
  name: string;
  borrower: string;
  status: string;
  requiresDp: boolean;
  lines: Line[];
  editable: boolean;
  canAct: boolean; // LA
  openMissingRequest: boolean;
  /** Small chips next to the title for this transaction's open items ("On hold · 1 day"). */
  titleChips?: { id: string; text: string; tone: "bad" | "navy" }[];
  /** May also put it on hold from the missing-paper pop-up. */
  canHold?: boolean;
  assignmentText: string | null;
  edstReference: string | null;
  send: SendOptions | null;
}

export function WorkCard(p: WorkCardProps) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(p.lines.filter((l) => l.checked).map((l) => l.id)));
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({ state: "idle" });
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const latest = useRef(checked);
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState("");

  const status = statusFor(p.lines, checked);
  const complete = status.complete;
  // The send area shows for every DP transaction not yet sent; it stays locked until all required papers are ticked.
  const sendVisible = p.requiresDp && p.canAct && !!p.send && (p.status === "READY" || p.status === "RETURNED" || p.status === "FOR_CHECKLIST");
  const [highlight, setHighlight] = useState<string[]>([]);
  const goToLines = (ids: string[]) => {
    if (ids.length === 0) return;
    document.getElementById(`line-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(ids);
    window.setTimeout(() => setHighlight([]), 2500);
  };

  const run = (newOther?: string) => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    setSave({ state: "saving" });
    const fd = new FormData();
    fd.set("transactionId", p.txnId);
    for (const id of latest.current) fd.append("checked", id);
    if (newOther) fd.append("newOther", newOther);
    startTransition(async () => {
      const r = (await saveChecklistAction(null, fd)) as Result;
      busy.current = false;
      if (r?.ok) setSave({ state: "saved" });
      else setSave({ state: "error", msg: plainMessage(r?.error) });
      if (again.current) { again.current = false; run(); }
    });
  };
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(), 450);
  };

  // Required first (single papers, then pick-one groups), then Optional under its own heading.
  const required = p.lines.filter((l) => l.required && l.kind !== "ONE_OF");
  const groups = [...new Set(p.lines.filter((l) => l.required && l.kind === "ONE_OF").map((l) => l.group ?? l.label))];
  const optional = p.lines.filter((l) => !l.required);
  const row = (l: Line) => (
    <ChecklistRow key={l.id} l={l} on={checked.has(l.id)} disabled={!p.editable} onToggle={() => toggle(l.id)} highlight={highlight.includes(l.id)} />
  );

  const hint = p.code === "EDST" && p.status === "FOR_CHECKLIST" ? "You do this one. Tick the papers first, then enter it in EDST and record the reference here." : null;

  const savedText =
    save.state === "saving" ? "Saving..." : save.state === "saved" ? "Saved just now" : save.state === "error" ? null : p.lines.some((l) => l.checked) ? "All changes saved" : null;

  return (
    <section aria-labelledby={`w-${p.txnId}`} className="flex flex-col overflow-hidden sm:rounded-[14px] sm:border sm:border-line-soft sm:bg-white sm:shadow-[var(--shadow-soft)]">
      {/* Header row: number, name, counts on the same line, status chip (the phone page header shows the name) */}
      <div className="flex min-h-14 items-center gap-3 bg-fill px-4 py-2 max-sm:sr-only sm:px-5">
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-navy">{p.index}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
          <h2 id={`w-${p.txnId}`} className="text-[17px] font-bold text-navy">{p.name}</h2>
          {(p.titleChips ?? []).map((c) => <TitleChip key={c.id} c={c} />)}
          {p.total !== undefined && <span className="basis-full text-xs text-ink-2" data-txn-position>Transaction {p.index} of {p.total}</span>}
          {hint && <span className="self-center text-ink-2" title={hint} aria-label={hint} role="img"><InfoIcon size={16} /></span>}
          {status.requiredTotal > 0 && (
            <span className="text-[13px] text-ink-2">{status.requiredDone} of {status.requiredTotal} required{status.optionalTotal > 0 ? ` · ${status.optionalDone} of ${status.optionalTotal} optional` : ""}</span>
          )}
        </div>
        {complete && status.requiredTotal > 0 && <ToneChip tone="ok" check>All documents checked</ToneChip>}
      </div>

      <div className="flex flex-col gap-2 sm:px-5 sm:py-4">
        {/* Phone: the header row is hidden, so show the open-item chips and the progress here */}
        {(p.titleChips ?? []).length > 0 && <p className="flex flex-wrap gap-1.5 sm:hidden">{(p.titleChips ?? []).map((c) => <TitleChip key={c.id} c={c} phone />)}</p>}
        <p className="text-[13px] text-ink-2 sm:hidden">
          {p.total !== undefined && <span data-txn-position>Transaction {p.index} of {p.total} · </span>}
          {status.requiredDone} of {status.requiredTotal} required ticked{status.optionalTotal > 0 ? ` · ${status.optionalDone} of ${status.optionalTotal} optional` : ""}
        </p>
        <div id={`papers-${p.txnId}`} className="grid scroll-mt-28 grid-cols-1 gap-1.5" role="group" aria-label={`${p.name} papers`}>
          {required.map(row)}
          {groups.map((g) => (
            <div key={g} className="contents">
              <p className="pt-1 text-xs font-semibold uppercase tracking-[0.05em] text-ink-2">{g}: pick at least one</p>
              {p.lines.filter((l) => l.required && l.kind === "ONE_OF" && (l.group ?? l.label) === g).map(row)}
            </div>
          ))}
          {optional.length > 0 && (
            <h4 className="pt-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Optional</h4>
          )}
          {optional.map(row)}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
          {p.editable && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-11 items-center gap-1 font-semibold text-navy underline underline-offset-2">
              <PlusIcon size={14} /> Add another paper
            </button>
          )}
          {p.editable && p.canAct && !p.openMissingRequest && p.lines.some((l) => !checked.has(l.id)) && (
            <AskMissing txnId={p.txnId} name={p.name} canHold={!!p.canHold} lines={p.lines.filter((l) => !checked.has(l.id) && (l.active || l.checked))} />
          )}
          <span role="status" aria-live="polite" className="ml-auto text-[13px] text-ink-2">
            {savedText && !sendVisible && <span className="inline-flex items-center gap-1"><CheckIcon size={14} />{savedText}</span>}
          </span>
        </div>
        {save.state === "error" && <p role="alert" className="mt-2 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad-fg">{save.msg} Your ticks were not saved. Try again.</p>}
        {adding && (
          <form
            className="mt-2 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => { e.preventDefault(); if (other.trim()) { run(other.trim()); setOther(""); setAdding(false); } }}
          >
            <label htmlFor={`other-${p.txnId}`} className="sr-only">Name of the other paper</label>
            <input id={`other-${p.txnId}`} autoFocus value={other} onChange={(e) => setOther(e.target.value)} maxLength={120} placeholder="Name of the other paper" className="input" />
            <button type="submit" className="btn-navy">Add paper</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        )}
      </div>

      {/* Action area: a footer section of the card */}
      <div className="flex flex-col gap-3 border-t border-[rgb(12_35_64/0.1)] pt-4 empty:hidden sm:px-5 sm:pb-4">
        {p.assignmentText && <p className="rounded-xl bg-wait-bg px-4 py-3 text-[15px] text-wait-fg">{p.assignmentText}</p>}
        {p.code === "EDST" && p.status === "COMPLETED" && (
          <p className="rounded-xl bg-ok-bg px-4 py-3 text-[15px] text-ok-fg">EDST done. Reference {p.edstReference}.</p>
        )}
        {p.code === "EDST" && p.canAct && (p.status === "READY" || (p.status === "FOR_CHECKLIST" && complete)) && <EdstDone txnId={p.txnId} waiting={p.status !== "READY"} />}
        {sendVisible && p.send && (
          <SendPanel
            txnId={p.txnId} code={p.code} name={p.name} borrower={p.borrower} status={p.status} o={p.send}
            ready={complete} requiredDone={status.requiredDone} requiredTotal={status.requiredTotal} missing={status.missing}
            waitingForSave={complete && p.status === "FOR_CHECKLIST"} savedText={savedText} goTo={goToLines}
          />
        )}
      </div>
    </section>
  );
}

/** The small chip beside the title: where an open item is (the Open items card is the alert). */
function TitleChip({ c, phone = false }: { c: { id: string; text: string; tone: "bad" | "navy" }; phone?: boolean }) {
  return (
    <span id={phone ? `open-${c.id}-m` : `open-${c.id}`} data-title-chip={c.tone} className={`chip ${c.tone === "navy" ? "c-navy" : "c-bad"} h-6 self-center px-2 text-xs ${phone ? "" : "max-sm:hidden"}`}>
      {c.tone === "navy" ? <span className="text-gold"><PauseIcon size={12} strokeWidth={2.6} /></span> : <AlertIcon size={12} strokeWidth={2.6} />}
      {c.text}
    </span>
  );
}

const ASKED_FROM: [string, string][] = [["BORROWER", "Borrower"], ["BRANCH", "Branch"], ["OTHER", "Other"]];

/**
 * Ask for missing paper: pick the papers that have not arrived (required first, optional after; at
 * least one), from whom (optional), a note, and optionally put the transaction on hold (waiting on
 * borrower) through the normal hold rules. Time and who asked are recorded by the server.
 */
function AskMissing({ txnId, name, lines, canHold }: { txnId: string; name: string; lines: Line[]; canHold: boolean }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(() => params.get("ask") === "missing");
  const [state, action, pending] = useActionState(requestMissingAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  return (
    <>
      <span className="text-ink-2">
        Missing something?{" "}
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2">Ask for missing paper</button>
      </span>
      <GuardedSheet open={open} onClose={close} title="Ask for missing paper">
        <AskMissingForm txnId={txnId} name={name} lines={lines} canHold={canHold} action={action} state={state} pending={pending} />
      </GuardedSheet>
    </>
  );
}

function AskMissingForm({ txnId, name, lines, canHold, action, state, pending }: {
  txnId: string; name: string; lines: Line[]; canHold: boolean; action: (fd: FormData) => void; state: Result; pending: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState(false);
  const required = lines.filter((l) => l.required);
  const optional = lines.filter((l) => !l.required);
  const none = (tried && picked.size === 0) || state?.field === "checkIds";
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const box = (l: Line) => (
    <label key={l.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-navy has-[:checked]:bg-fill">
      <input type="checkbox" name="checkIds" value={l.id} checked={picked.has(l.id)} onChange={() => toggle(l.id)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" />
      <span className="min-w-0 flex-1 text-[15px]">{l.label}</span>
      <span className="text-xs text-ink-2">{l.required ? "Required" : "Optional"}</span>
    </label>
  );
  return (
    <form action={action} onSubmit={(e) => { if (picked.size === 0) { e.preventDefault(); setTried(true); } }} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="transactionId" value={txnId} />
      <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>
        A reminder that a paper was asked for and has not arrived. It does not stop the work and does not pause the turnaround time. It closes by itself when the paper is ticked.
      </p>
      <fieldset aria-describedby={none ? `miss-${txnId}-err` : undefined}>
        <legend className="label">Which papers for {name}?</legend>
        <div className="flex max-h-[38dvh] flex-col gap-1.5 overflow-y-auto">
          {required.map(box)}
          {optional.length > 0 && <p className="pt-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Optional</p>}
          {optional.map(box)}
        </div>
        {none && <p id={`miss-${txnId}-err`} className="mt-1 text-[13px] font-semibold text-bad-fg">Pick at least one paper.</p>}
      </fieldset>
      <fieldset>
        <legend className="label">Asked from (optional)</legend>
        <div className="flex flex-wrap gap-x-5">
          {ASKED_FROM.map(([v, l]) => (
            <label key={v} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
              <input type="radio" name="askedFrom" value={v} className="h-5 w-5 accent-[var(--navy)]" /> {l}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`note-${txnId}`} className="label">Note (optional)</label>
        <textarea id={`note-${txnId}`} name="note" rows={2} maxLength={500} className="input" />
      </div>
      <NowLine label="Asked now" />
      {canHold && (
        <label className="inline-flex min-h-11 items-start gap-2 text-[15px]">
          <input type="checkbox" name="alsoHold" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--navy)]" />
          <span>Also put this transaction on hold (waiting on borrower)<span className="block text-[13px] text-ink-2">A separate On hold. The turnaround time keeps counting.</span></span>
        </label>
      )}
      {state && !state.ok && state.field !== "checkIds" && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad-fg">{plainMessage(state.error)}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <SheetCancel />
        <button type="submit" className="btn-gold" disabled={pending || picked.size === 0}>{pending ? "Sending..." : "Ask for the paper"}</button>
      </div>
    </form>
  );
}

function EdstDone({ txnId, waiting }: { txnId: string; waiting: boolean }) {
  const [state, action, pending] = useActionState(recordEdstAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="transactionId" value={txnId} />
      <div>
        <h3 className="text-[17px] font-bold text-navy">Enter it in EDST</h3>
        <p className="text-[15px] text-ink-2">You do this one. No processor needed. Enter the account in EDST, then type the reference here.</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 sm:max-w-sm">
          <label htmlFor={`edst-${txnId}`} className="label">EDST reference</label>
          <input id={`edst-${txnId}`} name="reference" required maxLength={60} className="input" aria-invalid={state?.field === "reference"} />
        </div>
        <button type="submit" className="btn-gold" disabled={pending || waiting}>{pending ? "Saving..." : "Mark EDST done"}</button>
      </div>
      {waiting && <p className="text-sm text-ink-2">Saving your ticks first...</p>}
      {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad-fg">{plainMessage(state.error)}</p>}
    </form>
  );
}

// ===========================================================================
// Problems: report one, mark one as fixed
// ===========================================================================

export function ReportProblem({ loanId, missingTxns, compact = false }: { loanId: string; missingTxns: { id: string; name: string; href: string }[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"MISSING_PAPER" | "WRONG_DETAILS" | "OTHER">("MISSING_PAPER");
  const [txn, setTxn] = useState(missingTxns[0]?.id ?? "");
  const [stateB, actionB, pendingB] = useActionState(reportProblemAction, null);
  const useMissing = kind === "MISSING_PAPER" && missingTxns.length > 0;
  const state = stateB;
  const pending = pendingB;
  const done = stateB?.ok;
  const choices: [typeof kind, string, string][] = [
    ["MISSING_PAPER", "Missing paper", "A paper is not with you yet."],
    ["WRONG_DETAILS", "Wrong details", "Something in the loan details is not right."],
    ["OTHER", "Something else", "Anything else that stops you."],
  ];
  return (
    <>
      <button type="button" className={compact ? "inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-2" : "btn-navy self-start"} onClick={() => setOpen(true)}>{compact ? "Report a problem" : "Report"}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Report a problem">
        {done ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-ok-bg px-4 py-3 text-[15px] text-ok-fg">Thank you. Your supervisor has been told. You can see it under Problems on the To do tab.</p>
            <button type="button" className="btn-navy" onClick={() => setOpen(false)}>Close</button>
          </div>
        ) : (
          <form action={actionB} className="flex flex-col gap-4">
            <input type="hidden" name="loanId" value={loanId} />
            <input type="hidden" name="kind" value={kind} />
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2 text-[15px] font-semibold">What is wrong?</legend>
              {choices.map(([v, l, h]) => (
                <label key={v} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${kind === v ? "border-2 border-navy bg-hover" : "border-line bg-white"}`}>
                  <input type="radio" name="kindChoice" value={v} checked={kind === v} onChange={() => setKind(v)} className="h-5 w-5 accent-[var(--navy)]" />
                  <span><span className="block text-base font-semibold">{l}</span><span className="block text-sm text-ink-2">{h}</span></span>
                </label>
              ))}
            </fieldset>
            {useMissing && (
              <div>
                <label htmlFor="rp-txn" className="label">Which part is missing a paper?</label>
                <select id="rp-txn" value={txn} onChange={(e) => setTxn(e.target.value)} className="input">
                  {missingTxns.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {useMissing ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <a href={missingTxns.find((t) => t.id === txn)?.href ?? "#"} className="btn-gold btn-lg">Choose the papers</a>
                <button type="button" className="btn-ghost btn-lg" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="rp-text" className="label">Tell us what happened</label>
                  <textarea id="rp-text" name="details" rows={4} maxLength={1000} required className="input" aria-invalid={state?.field === "details"} />
                </div>
                {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad-fg">{plainMessage(state.error)}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button type="submit" className="btn-gold btn-lg" disabled={pending}>{pending ? "Sending..." : "Send report"}</button>
                  <button type="button" className="btn-ghost btn-lg" onClick={() => setOpen(false)}>Cancel</button>
                </div>
              </>
            )}
          </form>
        )}
      </Sheet>
    </>
  );
}

export function FixProblem({ exceptionId }: { exceptionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resolveExceptionAction, null);
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Mark problem as fixed</button>;
  return (
    <form action={action} className="mt-1 flex w-full flex-col gap-2">
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <label htmlFor={`fix-${exceptionId}`} className="label">How was it fixed?</label>
      <textarea id={`fix-${exceptionId}`} name="resolution" required rows={2} maxLength={1000} className="input" />
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg">{plainMessage(state.error)}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-navy btn-sm" disabled={pending}>{pending ? "Saving..." : "Mark problem as fixed"}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
