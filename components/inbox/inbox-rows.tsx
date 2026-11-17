"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { acceptWorkAction, moveItemAction, setAwayAction } from "@/app/actions/work";
import { FormMessage } from "@/components/form-status";
import { CorrectDueDate } from "@/components/jobs/due-date";
import type { InboxRow } from "@/lib/services/work-items";

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
}

export function InboxList({ rows, extras = {}, empty, pool = false }: { rows: InboxRow[]; extras?: Record<string, RowExtras>; empty: string; pool?: boolean }) {
  if (!rows.length) return <p className="px-4 py-5 text-[15px] text-ink-2 sm:px-5" data-inbox-empty>{empty}</p>;
  return <ul className="flex flex-col divide-y divide-line">{rows.map((r) => <Row key={r.id} r={r} x={extras[r.id] ?? {}} pool={pool} />)}</ul>;
}

function Row({ r, x, pool }: { r: InboxRow; x: RowExtras; pool: boolean }) {
  const [moving, setMoving] = useState(false);
  const acceptable = (r.state === "POOL" || r.state === "INBOX") && r.kind !== "FUND_REQUEST" && r.kind !== "PACKAGE";
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5" data-inbox-row={r.label} data-state={r.state}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <Link href={r.link} className="text-[15px] font-semibold text-navy underline-offset-2 hover:underline">{r.label}</Link>
          <p className="text-[13px] text-ink-2">
            <span className="chip c-wait mr-1.5">{r.kindText}</span>
            {r.branchName}{r.holder && !pool ? ` · ${r.holder}` : ""}
          </p>
          <p className="text-[13px]">
            <span className={pool || r.state !== "HELD" ? POOL_TEXT[r.poolTone] : "text-ink-2"} data-pool-tone={r.poolTone}>{r.state === "HELD" ? `Accepted after ${r.waiting === 0 ? "less than a day" : `${r.waiting} working day${r.waiting === 1 ? "" : "s"}`}` : r.waitingText}</span>
            <span className="text-ink-2"> · arrived {r.arrivedText}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {r.paused ? <span className="chip c-hold" data-due-tone="paused">Paused</span>
            : r.dueText ? <span className={`chip ${DUE_CHIP[r.tone ?? "green"]}`} data-due-tone={r.tone}>Due {r.dueText}</span>
            : r.state !== "HELD" ? <span className="text-[13px] text-ink-2">Due date starts at accept</span> : null}
          <span className="text-[12px] text-ink-2">{r.measureText}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {acceptable ? <AcceptButton id={r.id} /> : <Link href={r.link} className="btn-secondary btn-sm">Open</Link>}
        {!acceptable && r.state !== "HELD" && <span className="text-[13px] text-ink-2">{r.kind === "PACKAGE" ? "Receive it to accept it." : "Approve or Release counts as accepting it."}</span>}
        {x.giveTo && !moving && <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setMoving(true)} data-move-open>Move</button>}
        {x.correct && r.dueDate && r.kind !== "DP_JOB" && <CorrectDueDate subjectType="WorkItem" subjectId={r.id} current={r.dueDate} />}
      </div>
      {moving && x.giveTo && <MoveForm r={r} people={x.giveTo} onClose={() => setMoving(false)} />}
    </li>
  );
}

function AcceptButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(acceptWorkAction, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok && state.href) router.push(state.href); }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="itemId" value={id} />
      <button type="submit" className="btn-navy btn-sm" disabled={pending} data-accept>{pending ? "Accepting..." : "Accept"}</button>
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

function MoveForm({ r, people, onClose }: { r: InboxRow; people: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(moveItemAction, null);
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
      <FormMessage state={state} />
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
