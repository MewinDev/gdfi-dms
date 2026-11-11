"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { includePaperAction, markMissingAction, receiveMissingAction, saveRemarksAction } from "@/app/actions/loan";
import { CheckIcon } from "@/components/ui/icons";
import { REMARKS_LIMIT_MESSAGE, REMARKS_MAX, REMARKS_MIN, remarksCounter } from "@/lib/ui/holds";
import { plainMessage } from "@/lib/ui/plain";
import { announcing } from "@/components/ui/live-toast";

const saveRemarksAnnounced = announcing(saveRemarksAction);
const receiveAnnounced = announcing(receiveMissingAction);

/** One paper of the checklist, as the Check papers screen shows it. */
export interface PaperLine {
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
  /** The DP returned this paper ("Returned: missing paper"): the one marker on its row. */
  returned?: string;
  /** Missing papers: MISSING (not in hand) or RECEIVED_LATE (arrived later); null otherwise. */
  missing?: "MISSING" | "RECEIVED_LATE" | null;
  reasonId?: string | null;
  reasonName?: string | null;
  remarks?: string | null;
  /** "Ana Cruz · Nov 10, 2026, 9:05 AM PHT". */
  missingInfo?: string | null;
  /** "Received Nov 12, 2026 · Ana Cruz". */
  receivedText?: string | null;
  /** Optional papers: "Include in this file" is ticked. */
  included?: boolean;
}

/** What the person may do with missing papers on this transaction. */
export interface PaperTools {
  reasons: { id: string; name: string }[];
  /** papers:mark_missing and the checklist is editable now. */
  canMark: boolean;
  /** papers:receive_late. */
  canReceive: boolean;
  /** Sent at least once: a Missing mark can no longer be taken back (only Received). */
  sentBefore: boolean;
  /** Philippine date today (the Received date picker's maximum). */
  today: string;
}

/** Optional and not part of this file: the row stays quiet. */
export const isQuiet = (l: PaperLine, on: boolean) => !l.required && !l.included && !on && !l.missing;

export function PaperRow({ l, on, disabled, onToggle, highlight, tools, onMissing, groupMet = false }: {
  l: PaperLine; on: boolean; disabled: boolean; onToggle: () => void; highlight: boolean; tools: PaperTools | null;
  /** The row was marked Missing (or the mark taken back): the parent drops the Present tick. */
  onMissing: (id: string, missing: boolean) => void;
  /** Its pick-one group is already met by another paper: it cannot be missing. */
  groupMet?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Pressed Missing on this screen just now: the reasons get the focus.
  const [justMarked, setJustMarked] = useState(false);
  // Shown at once while the server saves it (the page then refreshes with the stored state).
  // It holds only while the stored state is still the one it was pressed on; the refreshed state wins.
  const [pressed, setPressed] = useState<{ to: "MISSING" | "CLEARED"; on: PaperLine["missing"] } | null>(null);
  const optimistic = pressed && pressed.on === (l.missing ?? null) ? pressed.to : null;
  const setOptimistic = (to: "MISSING" | "CLEARED" | null) => setPressed(to ? { to, on: l.missing ?? null } : null);
  const missing = optimistic === "MISSING" ? "MISSING" : optimistic === "CLEARED" ? null : l.missing ?? null;
  const isMissing = missing === "MISSING" && !on;
  const late = missing === "RECEIVED_LATE";
  const quiet = isQuiet(l, on);
  const noRemarks = isMissing && !l.remarks;
  const tone = noRemarks ? "border-bad-line bg-bad-bg" : isMissing ? "border-act-line bg-act-bg" : on ? "border-line bg-fill-soft" : "border-line bg-white";

  const call = (fd: FormData, after: () => void) => start(async () => {
    setError(null);
    const r = await markMissingAction(null, fd);
    if (!r?.ok) { setError(plainMessage(r?.error)); setOptimistic(null); return; }
    after();
  });
  const markMissing = () => {
    const fd = new FormData();
    fd.set("checkId", l.id);
    setOptimistic("MISSING");
    setJustMarked(true);
    onMissing(l.id, true);
    call(fd, () => {});
  };
  const undo = () => {
    const fd = new FormData();
    fd.set("checkId", l.id);
    fd.set("undo", "open");
    setOptimistic("CLEARED");
    call(fd, () => onMissing(l.id, false));
  };
  const include = (v: boolean) => start(async () => {
    setError(null);
    const fd = new FormData();
    fd.set("checkId", l.id);
    fd.set("included", v ? "true" : "false");
    const r = await includePaperAction(null, fd);
    if (!r?.ok) setError(plainMessage(r?.error));
    else if (!v) onMissing(l.id, true); // left out: the Present tick goes too
  });

  const canMarkHere = !!tools?.canMark && !disabled && !late && !quiet && !(groupMet && !isMissing);
  return (
    <div className={`flex scroll-mt-28 flex-col rounded-[10px] border transition-[box-shadow,border-color] ${highlight ? "border-gold shadow-[0_0_0_3px_var(--act-bg)]" : tone}`}
      data-paper-row={l.id} data-state={late ? "received-late" : isMissing ? (noRemarks ? "missing-no-remarks" : "missing") : on ? "present" : quiet ? "left-out" : "open"}>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-1.5">
        <label
          id={`line-${l.id}`}
          data-highlight={highlight ? "true" : undefined}
          title={l.documentId ?? undefined}
          className={`flex min-w-0 flex-1 basis-[200px] cursor-pointer items-center gap-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${disabled ? "cursor-default" : ""}`}
        >
          <span className={`relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.3)] bg-white"}`}>
            {on && <CheckIcon size={14} strokeWidth={3} />}
            <input type="checkbox" aria-label={`${l.label}: Present`} className="absolute -inset-0.5 m-0 cursor-pointer opacity-0 disabled:cursor-default" checked={on} disabled={disabled || late || (isMissing && tools?.sentBefore)} onChange={onToggle} />
          </span>
          <span className="min-w-0 flex-1 leading-snug">
            <span className={`text-[15px] ${quiet ? "font-medium text-ink-2" : "font-semibold text-ink"}`}>{l.label}</span>
            {l.documentId && on && <span className="mono ml-2 text-xs text-ink-2">{l.documentId}</span>}
            {/* The one marker of a paper the DP returned: under the name on a phone, beside it from the tablet up. */}
            {l.returned && !on && <span className="mt-0.5 block w-fit rounded-md border border-act-line bg-act-bg px-1.5 py-0.5 text-xs font-semibold text-act-fg sm:ml-2 sm:mt-0 sm:inline" data-returned-marker>{l.returned}</span>}
          </span>
        </label>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {l.requested && !on && (
            <span tabIndex={0} title={l.requestedInfo} aria-label={`Requested. ${l.requestedInfo ?? ""}`} data-requested
              className="group/req relative rounded-md bg-bad-bg px-1.5 py-0.5 text-xs font-semibold text-bad-fg outline-none focus-visible:outline-2 focus-visible:outline-navy">
              Requested
              {l.requestedInfo && (
                <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 hidden w-max max-w-[240px] whitespace-normal rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover/req:block group-focus/req:block">{l.requestedInfo}</span>
              )}
            </span>
          )}
          {isMissing && <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${noRemarks ? "bg-white text-bad-fg" : "bg-white text-act-fg"}`} data-missing-tag>{noRemarks ? "Missing, remarks needed" : "Missing, with remarks"}</span>}
          {late && <span className="rounded-md bg-ok-bg px-1.5 py-0.5 text-xs font-semibold text-ok-fg" data-late-tag>Received late</span>}
          {!l.required && (tools?.canMark || tools?.canReceive || !disabled) && !late && (
            <label className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold ${disabled || pending ? "text-ink-2" : "cursor-pointer text-navy"}`} data-include>
              <input type="checkbox" className="h-4 w-4 accent-[var(--navy)]" checked={!!l.included || on || isMissing} disabled={disabled || pending || (isMissing && tools?.sentBefore)}
                onChange={(e) => include(e.target.checked)} />
              Include in this file
            </label>
          )}
          {canMarkHere && !isMissing && !on && (
            <button type="button" onClick={markMissing} disabled={pending} className="btn-ghost min-h-9 px-2.5 text-xs" data-mark-missing>Missing</button>
          )}
          {canMarkHere && isMissing && !tools?.sentBefore && (
            <button type="button" onClick={undo} disabled={pending} className="link min-h-9 text-xs" data-undo-missing>Not missing</button>
          )}
          {l.required
            ? <span className="rounded-md bg-act-bg px-1.5 py-0.5 text-xs font-semibold text-act-fg">Required</span>
            : <span className="rounded-md bg-fill-strong px-1.5 py-0.5 text-xs font-semibold text-ink-2">Optional</span>}
          <span className="text-xs text-ink-2">{l.originality === "ORIGINAL" ? "Original" : "Copy"}</span>
        </span>
      </div>
      {error && <p role="alert" className="mx-3.5 mb-2 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-bad-fg">{error}</p>}
      {(isMissing || late) && tools && (
        <MissingBox l={l} tools={tools} editable={!!tools.canMark} late={late} open={noRemarks && !disabled} focus={justMarked} />
      )}
    </div>
  );
}

/**
 * The small box right under a missing paper: Reason and Remarks (no modal). Saved, it folds to one
 * line (reason, remarks, who and when) with Edit, and Received for whoever may receive it.
 */
function MissingBox({ l, tools, editable, late, open, focus }: { l: PaperLine; tools: PaperTools; editable: boolean; late: boolean; open: boolean; focus: boolean }) {
  const uid = useId();
  const [editingNow, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  // No remarks yet: the form is always open.
  const editing = open || editingNow;
  const active = tools.reasons;
  const reasonChoices = l.reasonId && !active.some((r) => r.id === l.reasonId) ? [{ id: l.reasonId, name: l.reasonName ?? "Reason" }, ...active] : active;

  if (late) {
    return (
      <p className="border-t border-line px-3.5 py-1.5 text-[13px] text-ink-2" data-missing-summary>
        Was missing: {l.reasonName ?? "no reason"}{l.remarks ? ` · ${l.remarks}` : ""} · {l.receivedText}
      </p>
    );
  }
  if (!editing && l.remarks) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pb-2 text-[13px]" data-missing-summary>
        <span className="min-w-0 flex-1 text-ink">
          <span className="mr-1.5 inline-flex rounded-full border border-act-line bg-white px-2 py-px text-xs font-semibold text-act-fg">{l.reasonName}</span>
          {l.remarks}{l.missingInfo ? <span className="text-ink-2"> · {l.missingInfo}</span> : null}
        </span>
        {editable && <button type="button" className="link min-h-9 text-[13px]" onClick={() => setEditing(true)} aria-label={`Edit the reason and remarks for ${l.label}`}>Edit</button>}
        {tools.canReceive && !receiving && <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => setReceiving(true)} data-receive>Received</button>}
        {receiving && <ReceiveForm checkId={l.id} label={l.label} today={tools.today} onCancel={() => setReceiving(false)} />}
      </div>
    );
  }
  if (!editable) {
    return <p className="border-t border-bad-line/60 px-3.5 py-1.5 text-[13px] text-bad-fg">No reason or remarks yet.</p>;
  }
  return <RemarksForm key={uid} l={l} reasons={reasonChoices} sentBefore={tools.sentBefore} onDone={() => setEditing(false)} canCancel={!!l.remarks} focus={focus || editingNow} />;
}

/**
 * Reason and remarks, compact: the reasons are one-tap chips (a radio group), the remarks one line that
 * grows as the person types, Save beside it (under it on a phone). Enter saves, Shift+Enter is a new
 * line, Esc cancels an edit. The counter stays quiet: "4 more characters" until 5, the count only near 500.
 */
function RemarksForm({ l, reasons, sentBefore, onDone, canCancel, focus }: { l: PaperLine; reasons: { id: string; name: string }[]; sentBefore: boolean; onDone: () => void; canCancel: boolean; focus: boolean }) {
  const uid = useId();
  const [state, action, pending] = useActionState(saveRemarksAnnounced, null);
  const [reason, setReason] = useState(l.reasonId ?? "");
  const [remarks, setRemarks] = useState(l.remarks ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const firstChip = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  // Just marked Missing: the reasons are next.
  useEffect(() => { if (focus) firstChip.current?.focus({ preventScroll: true }); }, [focus]);
  const c = remarksCounter(remarks);
  const ok = !!reason && c.ok;
  const err = (f: string) => (state && !state.ok && state.field === f ? plainMessage(state.error) : null);
  const remarksErr = err("remarks");
  const short = REMARKS_MIN - c.count;
  const hint = remarksErr ?? (c.over ? REMARKS_LIMIT_MESSAGE : short > 0 ? (c.count === 0 ? `A short note, at least ${REMARKS_MIN} characters.` : `${short} more character${short === 1 ? "" : "s"}.`) : null);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ok && !pending) formRef.current?.requestSubmit(); }
    if (e.key === "Escape" && canCancel) { e.preventDefault(); onDone(); }
  };
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 px-3.5 pb-3 pt-0.5" data-remarks-form noValidate>
      <input type="hidden" name="checkId" value={l.id} />
      <fieldset className="min-w-0" aria-describedby={err("reasonId") ? `r-${uid}-e` : undefined}>
        <legend className="mb-1.5 text-xs font-semibold text-ink-2">Reason</legend>
        <div className="flex flex-wrap gap-1.5" data-reason-chips>
          {reasons.map((r, i) => (
            <label key={r.id} className="relative cursor-pointer">
              <input ref={i === 0 ? firstChip : undefined} type="radio" name="reasonId" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="peer sr-only" />
              <span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-white px-3 text-[13px] font-medium text-ink transition-colors hover:border-navy peer-checked:border-navy peer-checked:bg-navy peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy sm:min-h-8">
                {reason === r.id && <CheckIcon size={12} strokeWidth={3} />}{r.name}
              </span>
            </label>
          ))}
        </div>
        {err("reasonId") && <p id={`r-${uid}-e`} className="mt-1 text-[13px] font-semibold text-bad-fg">{err("reasonId")}</p>}
      </fieldset>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor={`m-${uid}`} className="sr-only">Remarks</label>
          <textarea id={`m-${uid}`} name="remarks" rows={1} value={remarks} onChange={(e) => setRemarks(e.target.value)} onKeyDown={onKey}
            placeholder="Remarks: who has it, when it comes"
            className="input field-sizing-content max-h-40 min-h-10 resize-none py-2 leading-snug" aria-invalid={!!remarksErr || c.over || undefined} aria-describedby={`m-${uid}-c`} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canCancel && <button type="button" className="btn-ghost btn-sm min-h-10 flex-1 sm:flex-none" onClick={onDone}>Cancel</button>}
          <button type="submit" aria-label="Save remarks" className="btn-navy btn-sm min-h-10 flex-1 px-4 sm:flex-none" disabled={pending || !ok} data-save-remarks>{pending ? "Saving..." : "Save"}</button>
        </div>
      </div>
      <p id={`m-${uid}-c`} aria-live="polite" className="-mt-0.5 flex min-h-4 justify-between gap-3 text-xs" data-remarks-counter>
        <span className={remarksErr || c.over ? "font-semibold text-bad-fg" : "text-ink-2"} data-remarks-help>{hint ?? (sentBefore && l.remarks ? "The old remarks stay in the history." : "")}</span>
        {(c.warn || c.over) && <span className={c.over ? "font-semibold text-bad-fg" : "font-semibold text-hold-fg"} data-count data-warn>{c.count} / {REMARKS_MAX}</span>}
      </p>
      {state && !state.ok && !["reasonId", "remarks"].includes(state.field ?? "") && <p role="alert" className="text-[13px] font-semibold text-bad-fg">{plainMessage(state.error)}</p>}
    </form>
  );
}

function ReceiveForm({ checkId, label, today, onCancel }: { checkId: string; label: string; today: string; onCancel: () => void }) {
  const uid = useId();
  const [state, action, pending] = useActionState(receiveAnnounced, null);
  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2 pt-1" data-receive-form>
      <input type="hidden" name="checkId" value={checkId} />
      <div>
        <label htmlFor={`d-${uid}`} className="label">Date {label} arrived</label>
        <input id={`d-${uid}`} type="date" name="receivedOn" defaultValue={today} max={today} required className="input" />
      </div>
      <button type="submit" className="btn-navy btn-sm" disabled={pending}>{pending ? "Saving..." : "Mark Received"}</button>
      <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      {state && !state.ok && <p role="alert" className="basis-full text-[13px] font-semibold text-bad-fg">{plainMessage(state.error)}</p>}
    </form>
  );
}
