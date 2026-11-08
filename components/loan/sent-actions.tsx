"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { changeLtoOfficeAction, changeProcessorAction, processorNoteAction, pullBackAction } from "@/app/actions/loan";
import { dpChangeLtoOfficeAction } from "@/app/actions/jobs";
import type { ActionState } from "@/lib/action";
import { flash } from "./open-items-client";

/**
 * Sent, not accepted yet: the LA can still change it. Each pop-up says its purpose in one line; the
 * server refuses every change once the processor accepted.
 */
const changeAnnounced = announcing(changeProcessorAction);
const noteAnnounced = announcing(processorNoteAction);
const pullAnnounced = announcing(pullBackAction);
const ltoLaAnnounced = announcing(changeLtoOfficeAction);
const ltoDpAnnounced = announcing(dpChangeLtoOfficeAction);

/** Update papers: the checklist above stays editable while it waits to be accepted. */
export function UpdatePapersButton({ target }: { target: string }) {
  return <button type="button" className="btn-ghost btn-sm" onClick={() => flash(target)}>Update papers</button>;
}

function Purpose({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>{children}</p>;
}

function useSheet(state: ActionState) {
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  return { open, setOpen, close };
}

export function ChangeProcessorForm({ transactionId, current, processors }: {
  transactionId: string;
  current: { dpId: string; secondId: string | null };
  processors: { id: string; name: string; branches: string }[];
}) {
  const [state, action] = useActionState(changeAnnounced, null);
  const s = useSheet(state);
  const uid = useId();
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => s.setOpen(true)}>Change processor</button>
      <GuardedSheet open={s.open} onClose={s.close} title="Change processor">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transactionId} />
          <Purpose>Before the processor accepts, you can give the job to someone else. The first processor is told. The turnaround time keeps counting.</Purpose>
          <div>
            <label htmlFor={`${uid}-dp`} className="label">Processor</label>
            <select id={`${uid}-dp`} name="dpUserId" defaultValue={current.dpId} className="input" aria-invalid={!!err("dpUserId")}>
              {processors.map((p) => <option key={p.id} value={p.id}>{p.name}{p.branches ? ` (${p.branches})` : ""}</option>)}
            </select>
            {err("dpUserId") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("dpUserId")}</p>}
          </div>
          <div>
            <label htmlFor={`${uid}-2`} className="label">Second processor, Pasuyo (optional)</label>
            <select id={`${uid}-2`} name="secondaryDpUserId" defaultValue={current.secondId ?? ""} className="input">
              <option value="">None</option>
              {processors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-r`} className="label">Why change it?</label>
            <textarea id={`${uid}-r`} name="reason" rows={2} maxLength={300} className="input" aria-invalid={!!err("reason")} />
            {err("reason") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("reason")}</p>}
          </div>
          {state && !state.ok && !["dpUserId", "reason"].includes(state.field ?? "") && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Change processor</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

export function ProcessorNoteForm({ transactionId }: { transactionId: string }) {
  const [state, action] = useActionState(noteAnnounced, null);
  const s = useSheet(state);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => s.setOpen(true)}>Add a note for the processor</button>
      <GuardedSheet open={s.open} onClose={s.close} title="Note for the processor">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transactionId} />
          <Purpose>A short note the processor sees before they accept, for example where a paper is.</Purpose>
          <div>
            <label htmlFor={`${uid}-n`} className="label">Note</label>
            <textarea id={`${uid}-n`} name="note" rows={2} maxLength={300} className="input" />
          </div>
          {state && !state.ok && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Send note</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

export function PullBackForm({ transactionId, dpName }: { transactionId: string; dpName: string }) {
  const [state, action] = useActionState(pullAnnounced, null);
  const s = useSheet(state);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => s.setOpen(true)}>Pull back</button>
      <GuardedSheet open={s.open} onClose={s.close} title="Pull back">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transactionId} />
          <Purpose>Pull back: cancel the send before {dpName} starts. It comes back to you as Ready to send. The turnaround time keeps counting.</Purpose>
          <div>
            <label htmlFor={`${uid}-r`} className="label">Why pull it back?</label>
            <textarea id={`${uid}-r`} name="reason" rows={2} maxLength={300} className="input" />
          </div>
          {state && !state.ok && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Pull back</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

/**
 * Change the LTO office. The LA before the processor accepts (no note); the processor after accepting
 * when the real office differs (a short note is required). Offices show their estimate.
 */
export function ChangeLtoOfficeForm({ mode, id, offices, currentId }: {
  mode: "la" | "dp";
  /** The transaction (LA) or the job (processor). */
  id: string;
  offices: { id: string; name: string; estimate: string | null }[];
  currentId: string | null;
}) {
  const [state, action] = useActionState(mode === "la" ? ltoLaAnnounced : ltoDpAnnounced, null);
  const s = useSheet(state);
  const uid = useId();
  // Kept in state: a refused try (no note) keeps the office and note the person typed.
  const [office, setOffice] = useState(currentId ?? "");
  const [note, setNote] = useState("");
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => { setOffice(currentId ?? ""); setNote(""); s.setOpen(true); }}>Change LTO office</button>
      <GuardedSheet open={s.open} onClose={s.close} title="Change LTO office">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name={mode === "la" ? "transactionId" : "assignmentId"} value={id} />
          <Purpose>{mode === "la"
            ? "Before the processor accepts, you can change where they take it. They are told."
            : "If the real office is different, change it here. The Loan Associate and Finance are told, because it can change the cash needed."}</Purpose>
          <div>
            <label htmlFor={`${uid}-o`} className="label">LTO office</label>
            <select id={`${uid}-o`} name="ltoOfficeId" value={office} onChange={(e) => setOffice(e.target.value)} className="input">
              <option value="" disabled>Pick the LTO office</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.estimate ? ` (${o.estimate})` : ""}</option>)}
            </select>
          </div>
          {mode === "dp" && (
            <div>
              <label htmlFor={`${uid}-n`} className="label">Why is it different?</label>
              <textarea id={`${uid}-n`} name="note" rows={2} maxLength={300} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {state && !state.ok && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Change office</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}
