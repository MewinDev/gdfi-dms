"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { acceptWorkAction, moveItemAction, setAwayAction } from "@/app/actions/work";
import { FormMessage } from "@/components/form-status";
import { CorrectDueDate } from "@/components/jobs/due-date";
import type { InboxRow } from "@/lib/services/work-items";
import { NotInDmsBadge } from "@/components/loan/not-in-dms-badge";

/**
 * The Inbox rows (D-046): what it is, where it is, how long it waited, when it is due, and one button.
 * Colours: due dates as everywhere (green, amber, red, paused); pool waiting green, amber after 1 day, red after 2.
 */

const DUE_CHIP: Record<string, string> = { green: "c-ok", amber: "c-act", red: "c-bad", paused: "c-hold" };
const POOL_TEXT: Record<string, string> = { green: "text-ink-2", amber: "font-semibold text-act-fg", red: "font-semibold text-bad-fg" };

export interface RowExtras {
  /** Give to... choices (people of the same work role in the branch, not away), for those who may move work. */
  giveTo?: { id: string; name: string }[];
  /** "Correct due date" on an LA item (Correct due dates tick). */
  correct?: boolean;
  /** The reader does not do this work role (a supervisor looking at the pool): no Accept. */
  noAccept?: boolean;
}

type MoveAction = (fd: FormData) => void;

export function InboxList({ rows, extras = {}, empty, pool = false }: { rows: InboxRow[]; extras?: Record<string, RowExtras>; empty: string; pool?: boolean }) {
  // The Move result is kept here: the moved row leaves the list, and its message must stay in view.
  const [moved, move, moving] = useActionState(moveItemAction, null);
  return (
    <>
      {moved && <div className="px-4 pt-3 sm:px-5" data-move-result><FormMessage state={moved} /></div>}
      {!rows.length
        ? <p className="px-4 py-5 text-[15px] text-ink-2 sm:px-5" data-inbox-empty>{empty}</p>
        : <ul className="flex flex-col divide-y divide-line">{rows.map((r) => <Row key={r.id} r={r} x={extras[r.id] ?? {}} pool={pool} move={move} moving={moving} />)}</ul>}
    </>
  );
}

function Row({ r, x, pool, move, moving: busy }: { r: InboxRow; x: RowExtras; pool: boolean; move: MoveAction; moving: boolean }) {
  const [moving, setMoving] = useState(false);
  // D-060: a released loan not yet in the DMS has no Accept: View details opens its preview (Open loan file is there).
  const candidate = r.kind === "LOAN_CANDIDATE";
  const acceptable = !x.noAccept && !candidate && (r.state === "POOL" || r.state === "INBOX") && r.kind !== "FUND_REQUEST" && r.kind !== "PACKAGE";
  return (
    <li className="relative flex flex-col gap-2 px-4 py-3 hover:bg-fill-soft sm:px-5" data-inbox-row={r.label} data-state={r.state}>
      {/* D-058: the text keeps the whole width when the due column does not fit beside it (that column drops below). */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-auto basis-[18rem]">
          <Link href={r.link} className="break-words text-base font-semibold text-navy underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:underline">{r.label}</Link>
          <p className="mt-0.5 text-sm text-ink-2">
            <span className="chip c-wait mr-1.5">{r.kindText}</span>
            {r.branchName}{r.holder && !pool ? ` · ${r.holder}` : ""}
          </p>
          <p className="text-sm">
            {/* D-060: an item in a branch pool says how long it has been there, counted from its arrival. */}
            <span className={pool || r.state !== "HELD" ? POOL_TEXT[r.poolTone] : "text-ink-2"} data-pool-tone={r.poolTone} data-pool-since={r.poolText ? "" : undefined}>{r.state === "HELD" ? `Accepted after ${r.waiting === 0 ? "less than a day" : `${r.waiting} working day${r.waiting === 1 ? "" : "s"}`}` : r.poolText ?? r.waitingText}</span>
            {!r.poolText && <span className="text-ink-2"> · arrived {r.arrivedText}</span>}
            {r.candidate && <span className="text-ink-2" data-candidate> · released {r.candidate.releaseDate}{r.candidate.amount ? ` · ${r.candidate.amount}` : ""}</span>}
            {candidate && <> <NotInDmsBadge className="ml-1 align-[1px]" /></>}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
          {r.paused ? <span className="chip c-hold" data-due-tone="paused">Paused</span>
            : r.dueText ? <span className={`chip ${DUE_CHIP[r.tone ?? "green"]}`} data-due-tone={r.tone}>Due {r.dueText}</span>
            : r.state !== "HELD" ? <span className="text-sm text-ink-2">{candidate ? "Due date starts when its loan file is opened" : "Due date starts at accept"}</span> : null}
          <span className="text-[13px] text-ink-2">{r.measureText}</span>
        </div>
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-1 self-start">
        {acceptable ? <AcceptButton id={r.id} /> : <Link href={r.link} className="btn-secondary btn-sm" data-view>{candidate ? "View details" : "Open"}</Link>}
        {!acceptable && !candidate && r.state !== "HELD" && <span className="text-sm text-ink-2">{r.kind === "PACKAGE" ? "Receive it to accept it." : "Approve or Release counts as accepting it."}</span>}
        {x.giveTo && !moving && <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setMoving(true)} data-move-open>Move</button>}
        {x.correct && r.dueDate && r.kind !== "DP_JOB" && <CorrectDueDate subjectType="WorkItem" subjectId={r.id} current={r.dueDate} />}
      </div>
      {moving && x.giveTo && <div className="relative z-10"><MoveForm r={r} people={x.giveTo} action={move} pending={busy} onClose={() => setMoving(false)} /></div>}
    </li>
  );
}

function AcceptButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(acceptWorkAction, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="itemId" value={id} />
      <button type="submit" className="btn-navy btn-sm" disabled={pending} data-accept>{pending ? "Accepting..." : "Accept"}</button>
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

function MoveForm({ r, people, action, pending, onClose }: { r: InboxRow; people: { id: string; name: string }[]; action: MoveAction; pending: boolean; onClose: () => void }) {
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
export function AwayForm({ people, me, current }: { people?: { id: string; name: string; away: string | null }[]; me: string; current: string | null }) {
  const [state, action, pending] = useActionState(setAwayAction, null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  return (
    <div className="flex flex-col gap-2" data-away>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[15px]">{current ? <><span className="chip c-hold mr-1.5">Away</span>{current}</> : people ? "Mark someone away so they are not given new work." : "You are not marked away."}</p>
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
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}
