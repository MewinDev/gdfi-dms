"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, NowLine, useCloseWhenDone } from "@/components/ui/live-toast";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { acceptWithMissingAction, returnToLaAction } from "@/app/actions/jobs";
import type { ActionState } from "@/lib/action";

const returnAnnounced = announcing(returnToLaAction);
const missingAnnounced = announcing(acceptWithMissingAction);
/** Reasons that must name the papers (same rule as the server). */
const NEEDS_PAPERS = ["MISSING", "WRONG"];

/**
 * Return to LA: papers needed. After accepting, the processor sends the job back when a paper is
 * missing or wrong. Not a Problem; the turnaround time keeps counting.
 */
export function ReturnToLaForm({ assignmentId, laName, reasons, papers, heldText }: {
  assignmentId: string;
  laName: string;
  reasons: { id: string; name: string; code: string }[];
  papers: { id: string; label: string }[];
  /** "₱1,500.00" when the processor holds released, unliquidated cash for this job. */
  heldText: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(returnAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}><ArrowLeftIcon size={16} /> Return to LA: papers needed</button>
      <GuardedSheet open={open} onClose={close} title="Return to LA: papers needed">
        <ReturnForm assignmentId={assignmentId} laName={laName} reasons={reasons} papers={papers} heldText={heldText} action={action} state={state} />
      </GuardedSheet>
    </>
  );
}

function ReturnForm({ assignmentId, laName, reasons, papers, heldText, action, state, preselected = [], atAccept = false }: {
  assignmentId: string; laName: string; reasons: { id: string; name: string; code: string }[]; papers: { id: string; label: string }[];
  heldText: string | null; action: (fd: FormData) => void; state: ActionState;
  /** Papers already marked missing (at Accept). */
  preselected?: string[];
  /** Some papers are missing at Accept: the received papers are accepted first. */
  atAccept?: boolean;
}) {
  const uid = useId();
  const [reason, setReason] = useState(atAccept ? reasons.find((r) => r.code === "MISSING")?.id ?? "" : "");
  const [picked, setPicked] = useState<Set<string>>(new Set(preselected));
  const [labels, setLabels] = useState(false);
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [cash, setCash] = useState<"" | "KEEP" | "RETURN">("");
  const code = reasons.find((r) => r.id === reason)?.code ?? "";
  const needPapers = NEEDS_PAPERS.includes(code);
  const ready = !!reason && note.trim().length >= 3 && (!needPapers || picked.size > 0 || other.trim().length > 0) && (!heldText || !!cash) && (!atAccept || labels);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>
        {atAccept
          ? <>Some papers are missing. You accept the papers you received (they are recorded as received by you), and the job goes back to {laName} for the missing ones. Not a problem; the turnaround time keeps counting.</>
          : <>Return to LA: you accepted it, but a paper is missing or wrong. It goes back to {laName} to fix and send again. Not a problem; the turnaround time keeps counting.</>}
      </p>
      {atAccept && (
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold">
          <input type="checkbox" name="labels" checked={labels} onChange={(e) => setLabels(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />
          Labels are on the papers I received
        </label>
      )}
      <div>
        <label htmlFor={`${uid}-r`} className="label">Reason</label>
        <select id={`${uid}-r`} name="reasonId" value={reason} onChange={(e) => setReason(e.target.value)} className="input" aria-invalid={!!err("reasonId")}>
          <option value="" disabled>Pick a reason</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="label">Which papers{needPapers ? "" : " (optional)"}</legend>
        <div className="flex max-h-[30dvh] flex-col gap-1.5 overflow-y-auto">
          {papers.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-navy has-[:checked]:bg-fill">
              <input type="checkbox" name="checkIds" value={p.id} checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" />
              <span className="text-[15px]">{p.label}</span>
            </label>
          ))}
        </div>
        <label htmlFor={`${uid}-o`} className="label mt-2">Other paper (optional)</label>
        <input id={`${uid}-o`} name="otherPaper" value={other} onChange={(e) => setOther(e.target.value)} maxLength={120} className="input" />
        {err("checkIds") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("checkIds")}</p>}
      </fieldset>
      <div>
        <label htmlFor={`${uid}-n`} className="label">Note</label>
        <textarea id={`${uid}-n`} name="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="input" aria-invalid={!!err("note")} />
        {err("note") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("note")}</p>}
      </div>
      <fieldset>
        <legend className="label">The papers you have</legend>
        <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="papers" value="KEEP" defaultChecked className="h-5 w-5 accent-[var(--navy)]" /> I am keeping the papers I already have</label>
        <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="papers" value="RETURN" className="h-5 w-5 accent-[var(--navy)]" /> I am returning the papers to the LA</label>
      </fieldset>
      {heldText && (
        <fieldset aria-describedby={`${uid}-cash`} data-cash-question>
          <legend className="label">You hold {heldText} for this job</legend>
          <p id={`${uid}-cash`} className="help -mt-1 mb-1">Choose one before you return it.</p>
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="cash" value="KEEP" checked={cash === "KEEP"} onChange={() => setCash("KEEP")} className="h-5 w-5 accent-[var(--navy)]" /> Keep the cash for the re-send</label>
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="cash" value="RETURN" checked={cash === "RETURN"} onChange={() => setCash("RETURN")} className="h-5 w-5 accent-[var(--navy)]" /> Return the cash (Finance confirms it)</label>
          {err("cash") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("cash")}</p>}
        </fieldset>
      )}
      <NowLine label="Returns now" />
      {state && !state.ok && !["reasonId", "checkIds", "note", "cash"].includes(state.field ?? "") && <FormMessage state={state} />}
      {state && !state.ok && state.field === "reasonId" && <FormMessage state={state} />}
      <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton disabled={!ready}>{atAccept ? "Accept the rest and return to LA" : "Return to LA"}</SubmitButton></div>
    </form>
  );
}

/** Accept with some papers missing: the papers the processor did not receive are pre-selected. */
export function MissingAtAcceptSheet({ open, onClose, assignmentId, laName, reasons, papers, preselected }: {
  open: boolean; onClose: () => void; assignmentId: string; laName: string;
  reasons: { id: string; name: string; code: string }[]; papers: { id: string; label: string }[]; preselected: string[];
}) {
  const [state, action] = useActionState(missingAnnounced, null);
  useCloseWhenDone(state, onClose);
  return (
    <GuardedSheet open={open} onClose={onClose} title="Some papers are missing">
      <ReturnForm key={preselected.join(",")} assignmentId={assignmentId} laName={laName} reasons={reasons} papers={papers} heldText={null} action={action} state={state} preselected={preselected} atAccept />
    </GuardedSheet>
  );
}
