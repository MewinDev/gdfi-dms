"use client";

import { useActionState, useId, useState } from "react";
import { correctDueDateAction } from "@/app/actions/calendar";
import { FormMessage } from "@/components/form-status";

/** One line of an item's due-date history (D-041, D-042): what moved it, from when to when, why. */
export interface DueHistoryLine { id: string; fromText: string; toText: string; what: string; note: string; by: string; atText: string }

export function DueHistory({ lines }: { lines: DueHistoryLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-[13px] text-ink-2" data-due-history>
      {lines.map((l) => (
        <li key={l.id} data-due-change={l.what}>Moved from {l.fromText} to {l.toText} ({l.what}, {l.by}, {l.atText}): {l.note}</li>
      ))}
    </ul>
  );
}

/**
 * "Correct due date" (D-042): one item at a time, a working day of the item's branch, a reason. Only for people
 * with "Correct due dates"; the change is logged in the item's history and its owner is told.
 */
export function CorrectDueDate({ subjectType, subjectId, current }: { subjectType: "DpAssignment" | "CashAdvance" | "WorkItem"; subjectId: string; current: string }) {
  const [state, action, pending] = useActionState(correctDueDateAction, null);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open) return <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setOpen(true)} data-correct-due-open>Correct due date</button>;
  return (
    <form action={action} className="mt-1 flex flex-col gap-2 rounded-xl border border-line p-3" data-correct-due>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-d`} className="label">New due date</label>
          <input id={`${id}-d`} type="date" name="date" defaultValue={current} required className="input" />
        </div>
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-r`} className="label">Reason</label>
          <input id={`${id}-r`} name="reason" required minLength={5} maxLength={300} className="input" placeholder="Why the due date is corrected" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={pending}>{pending ? "Saving..." : "Save correction"}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
