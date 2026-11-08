"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, NowLine, useCloseWhenDone } from "@/components/ui/live-toast";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { acceptWithMissingAction, returnToLaAction } from "@/app/actions/jobs";
import type { ActionState } from "@/lib/action";
import { remarksCounter } from "@/lib/ui/holds";
import { RemarksField } from "./forms";

const returnAnnounced = announcing(returnToLaAction);
const missingAnnounced = announcing(acceptWithMissingAction);
/** Reasons that must name the papers (same rule as the server). */
const NEEDS_PAPERS = ["MISSING", "WRONG"];

/**
 * Return to LA: papers needed. After accepting, the processor sends the job back when a paper is
 * missing or wrong. Not a Problem; the turnaround time keeps counting.
 */
export function ReturnToLaForm({ assignmentId, laName, reasons, papers, heldText, handover }: {
  assignmentId: string;
  laName: string;
  reasons: { id: string; name: string; code: string }[];
  papers: { id: string; label: string }[];
  /** "₱1,500.00" when the processor holds released, unliquidated cash for this job. */
  heldText: string | null;
  /** The papers with the processor (received at Accept): each is ticked as handed over to the LA. */
  handover: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(returnAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}><ArrowLeftIcon size={16} /> Return to LA: papers needed</button>
      <GuardedSheet open={open} onClose={close} title="Return to LA: papers needed">
        <ReturnForm assignmentId={assignmentId} laName={laName} reasons={reasons} papers={papers} heldText={heldText} handover={handover} action={action} state={state} />
      </GuardedSheet>
    </>
  );
}

function ReturnForm({ assignmentId, laName, reasons, papers, heldText, handover, action, state, preselected = [], atAccept = false }: {
  assignmentId: string; laName: string; reasons: { id: string; name: string; code: string }[]; papers: { id: string; label: string }[];
  heldText: string | null; action: (fd: FormData) => void; state: ActionState;
  /** Papers to hand over (at Accept: the received ones, by checklist row; worked out below). */
  handover?: { id: string; label: string }[];
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
  const [handed, setHanded] = useState<Set<string>>(new Set());
  // At Accept the papers received (not marked missing) go straight back to the LA: they are ticked by row.
  const toHand = handover ?? papers.filter((p) => !picked.has(p.id));
  const allHanded = toHand.every((p) => handed.has(p.id));
  const toggleHanded = (id: string) => setHanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const code = reasons.find((r) => r.id === reason)?.code ?? "";
  const needPapers = NEEDS_PAPERS.includes(code);
  const ready = !!reason && remarksCounter(note).ok && (!needPapers || picked.size > 0 || other.trim().length > 0) && allHanded && (!atAccept || labels);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>
        {atAccept
          ? <>Some papers are missing. You accept the papers you received (they are recorded as received by you), and the job goes back to {laName} for the missing ones. Not a problem; the turnaround time keeps counting.</>
          : <>Return to LA: you accepted it, but something is wrong or missing. It goes back to {laName}, who sent it, with your findings, to fix and send again. After this you will not see this job any more. Not a problem; the turnaround time keeps counting.</>}
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
      <RemarksField id={`${uid}-n`} label="Findings (required): what is wrong or missing" value={note} onChange={setNote} error={err("note")} />
      {toHand.length > 0 && (
        <fieldset data-handover>
          <legend className="label">Papers handed over to {laName} (tick each)</legend>
          <p className="help -mt-1 mb-1">Every paper you received at Accept goes back. {laName} confirms them before sending it again.</p>
          <div className="flex flex-col gap-1.5">
            {toHand.map((p) => (
              <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-navy has-[:checked]:bg-fill">
                <input type="checkbox" name="handedOver" value={p.id} checked={handed.has(p.id)} onChange={() => toggleHanded(p.id)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" />
                <span className="text-[15px]">{p.label}</span>
              </label>
            ))}
          </div>
          {err("handedOver") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("handedOver")}</p>}
        </fieldset>
      )}
      {heldText && (
        <p className="rounded-xl border border-act-line bg-act-bg px-3 py-2 text-[13px] text-act-fg" data-liquidation-notice>
          <strong className="font-semibold">The cash advance must be liquidated.</strong> You hold {heldText} for this job. In My funds, record what was spent (with receipts) and return the unspent cash. The return goes ahead now; the cash stays under &ldquo;Cash to settle&rdquo; until it is closed.
        </p>
      )}
      <NowLine label="Returns now" />
      {state && !state.ok && !["reasonId", "checkIds", "note", "handedOver"].includes(state.field ?? "") && <FormMessage state={state} />}
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
