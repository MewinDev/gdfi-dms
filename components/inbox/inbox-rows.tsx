"use client";

import { useActionState, useId, useState } from "react";
import { acceptWorkAction, setAwayAction } from "@/app/actions/work";
import { FormMessage } from "@/components/form-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { InboxRow } from "@/lib/services/work-items";

/**
 * The Inbox's forms (D-046): Accept, Move (Give to... / Back to the pool) and Away. D-063: the rows and the details
 * panel are in inbox-view.tsx; these forms sit in the panel (Accept, Move) and in the header's Set away sheet.
 */

export interface RowExtras {
  /** Give to... choices (people of the same work role in the branch, not away), for those who may move work. */
  giveTo?: { id: string; name: string }[];
  /** "Correct due date" on an LA item (Correct due dates tick). */
  correct?: boolean;
  /** The reader does not do this work role (a supervisor looking at the pool): no Accept. */
  noAccept?: boolean;
}

type MoveAction = (fd: FormData) => void;

/**
 * Accept (D-063, the user's review): asks first ("Accept Notary?": it moves to your items and its turnaround time
 * starts today), then takes the item and opens the work. Compact: 28 px from 640 px, 44 px to tap on a phone.
 */
export function AcceptButton({ id, what }: { id: string; what?: string }) {
  const [state, action, pending] = useActionState(acceptWorkAction, null);
  const [asking, setAsking] = useState(false);
  const formId = useId();
  // A refusal ("Already accepted by ...") closes the question so its message shows under the button.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state && !state.ok) setAsking(false);
  }
  return (
    <form id={formId} action={action} className="flex flex-col gap-1">
      <input type="hidden" name="itemId" value={id} />
      <button type="button" onClick={() => setAsking(true)} disabled={pending} data-accept
        className="relative inline-flex min-h-11 items-center justify-center rounded-lg bg-navy px-3 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-60 sm:min-h-7">
        {pending ? "Accepting..." : "Accept"}
      </button>
      {state && !state.ok && <FormMessage state={state} />}
      <ConfirmDialog open={asking} title={what ? `Accept ${what}?` : "Accept this work?"} body="It moves to your items and its turnaround time starts today."
        confirmLabel="Accept" pendingLabel="Accepting..." pending={pending} confirmForm={formId} sheetOnPhone data="accept-confirm"
        onCancel={() => setAsking(false)} />
    </form>
  );
}

export function MoveForm({ r, people, action, pending, onClose }: { r: InboxRow; people: { id: string; name: string }[]; action: MoveAction; pending: boolean; onClose: () => void }) {
  const id = useId();
  const canPool = r.kind !== "DP_JOB";
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-line p-3" data-move-form>
      <input type="hidden" name="itemId" value={r.id} />
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor={`${id}-to`} className="label">Move to</label>
          <select id={`${id}-to`} name="to" required className="input" defaultValue="">
            <option value="" disabled>Pick</option>
            {canPool && <option value="POOL">Back to the branch pool</option>}
            {people.map((p) => <option key={p.id} value={p.id}>Give to {p.name}</option>)}
          </select>
          {!people.length && <p className="text-[13px] text-ink-2">Nobody else of this work role is free in {r.branchName}.</p>}
        </div>
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-n`} className="label">Why</label>
          <input id={`${id}-n`} name="note" required minLength={5} maxLength={300} className="input" placeholder="For example: on leave this week" />
        </div>
      </div>
      <p className="text-[13px] text-ink-2">The current round ends as &ldquo;Moved (away)&rdquo; and is not counted late. The new person gets a fresh target; the overall due date stays. Both people are told.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-navy btn-sm" disabled={pending}>{pending ? "Moving..." : "Move"}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/** Away (D-046): the person's own, or anyone's of the reader's branches with "Set who is away". */
export function AwayForm({ people, me, current, startOpen = false }: { people?: { id: string; name: string; away: string | null }[]; me: string; current: string | null; startOpen?: boolean }) {
  const [state, action, pending] = useActionState(setAwayAction, null);
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  return (
    <div className="flex flex-col gap-2" data-away>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm">{current ? <><span className="chip c-hold mr-1.5">Away</span>{current}</> : people ? "Mark someone away so they are not given new work." : "You are not marked away."}</p>
        {!open && <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setOpen(true)} data-away-open>{people ? "Set who is away" : current ? "Change" : "I will be away"}</button>}
        {current && !people && (
          <form action={action}><input type="hidden" name="intent" value="clear" /><button type="submit" className="link inline-flex min-h-11 items-center text-[13px]" disabled={pending}>I am back</button></form>
        )}
      </div>
      {open && (
        <form action={action} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap gap-3">
            {people && (
              <div className="flex min-w-48 flex-col gap-1">
                <label htmlFor={`${id}-u`} className="label">Person</label>
                <select id={`${id}-u`} name="userId" className="input" defaultValue={me}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.away ? ` (${p.away})` : ""}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-f`} className="label">First day away</label>
              <input id={`${id}-f`} type="date" name="from" required defaultValue={today} className="input" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-t`} className="label">Last day away</label>
              <input id={`${id}-t`} type="date" name="to" required defaultValue={today} className="input" />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-n`} className="label">Note (optional)</label>
              <input id={`${id}-n`} name="note" maxLength={200} className="input" placeholder="For example: sick leave" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="intent" value="set" className="btn-navy btn-sm" disabled={pending}>Save</button>
            {people && <button type="submit" name="intent" value="clear" className="btn-secondary btn-sm" disabled={pending} formNoValidate>Clear away</button>}
            {!startOpen && <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>}
          </div>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}
