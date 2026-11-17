"use client";

import { startTransition, useActionState, useId, useMemo, useState } from "react";
import { calendarEntryAction, entryActiveAction, workingDaysAction } from "@/app/actions/calendar";
import { FormMessage } from "@/components/form-status";
import type { ActionState } from "@/lib/action";

/**
 * Settings, Holidays and working days (D-018, D-041). Three forms, each with Check (the preview, nothing saved)
 * then Save. Save stays off until Check has run on exactly the values in the form, so nobody saves without
 * seeing "This will extend N items (M currently overdue)".
 */
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TYPES = [["REGULAR", "Regular holiday"], ["SPECIAL_NON_WORKING", "Special non-working day"], ["LOCAL", "Local holiday"]] as const;

export interface CalendarRow { id: string; date: string; name: string; kind: "HOLIDAY" | "CLOSURE"; type: string; active: boolean; isSample: boolean; reason: string; where: string }

/** A form's values as one key: Save is allowed only for the values that were checked. */
const keyOf = (form: HTMLFormElement | null) => (form ? JSON.stringify([...new FormData(form).entries()].filter(([k]) => k !== "intent")) : "");

function CheckThenSave({ action, children, saveLabel, canEdit, id }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; children: React.ReactNode; saveLabel: string; canEdit: boolean; id: string }) {
  const [state, run, pending] = useActionState(action, null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState("");
  const checkedOk = !!state?.ok && !!state.preview && !state.preview.saved && checkedKey !== null && checkedKey === currentKey;
  const why = `${id}-why`;
  return (
    <form
      onChange={(e) => setCurrentKey(keyOf(e.currentTarget))}
      onSubmit={(e) => {
        // Dispatched by hand, not through <form action>: React resets a form after an action, and the checked
        // values must stay in the form for Save (and for the person to read what they checked).
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const k = keyOf(e.currentTarget);
        setCurrentKey(k);
        if (submitter?.value === "check") setCheckedKey(k);
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => run(fd));
      }}
      className="flex flex-col gap-3" data-calendar-form={id}>
      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-3">{children}</fieldset>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" name="intent" value="check" className="btn-secondary" disabled={pending}>{pending ? "Checking..." : "Check"}</button>
          <button type="submit" name="intent" value="save" className="btn-primary" disabled={pending || !checkedOk} aria-describedby={checkedOk ? undefined : why} title={checkedOk ? undefined : "Check first: it shows which due dates will move."}>{saveLabel}</button>
          {!checkedOk && <span id={why} className="text-xs text-ink-2">Check first: it shows which due dates will move.</span>}
        </div>
      )}
      {state && <div data-calendar-preview={state.ok && state.preview ? `${state.preview.extend}/${state.preview.overdue}` : "error"}><FormMessage state={state} /></div>}
    </form>
  );
}

function BranchPicker({ branches, id, label }: { branches: { id: string; name: string }[]; id: string; label: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => branches.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())), [branches, q]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="label">{label}</label>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a branch" aria-label="Find a branch" className="input" />
      <select id={id} name="branchIds" multiple size={6} className="input h-auto" aria-describedby={`${id}-help`}>
        {shown.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <p id={`${id}-help`} className="text-xs text-ink-2">Hold Ctrl (or Cmd) to tick more than one.</p>
    </div>
  );
}

export function CalendarArea({ canEdit, weekdays, branches, rows, today, backdateMax }: { canEdit: boolean; weekdays: boolean[]; branches: { id: string; name: string }[]; rows: CalendarRow[]; today: string; backdateMax: number }) {
  const uid = useId();
  const [scope, setScope] = useState<"all" | "some">("all");
  const earliest = new Date(new Date(`${today}T00:00:00Z`).getTime() - backdateMax * 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-6" data-calendar-area>
      <section aria-labelledby={`${uid}-wd`} className="flex flex-col gap-2">
        <h3 id={`${uid}-wd`} className="text-[15px] font-bold text-navy">Working days</h3>
        <p className="text-sm text-ink-2">Every count of working days uses these: turnaround times, liquidation, reminders and reports. Holidays and office closures are skipped too.</p>
        <CheckThenSave action={workingDaysAction} saveLabel="Save working days" canEdit={canEdit} id="working-days">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEK.map((d, i) => (
              <label key={d} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" name={`wd${i}`} defaultChecked={weekdays[i]} className="h-5 w-5" /> {d}
              </label>
            ))}
          </div>
        </CheckThenSave>
      </section>

      <section aria-labelledby={`${uid}-cl`} className="flex flex-col gap-2 rounded-xl border border-act-line bg-act-bg p-3" data-office-closure>
        <h3 id={`${uid}-cl`} className="text-[15px] font-bold text-navy">Office closure</h3>
        <p className="text-sm text-ink-2">A typhoon or a sudden declaration: the date is a non-working day for the branches you tick. Due dates whose count includes it move by the lost day, overdue ones too, and their owners are told.</p>
        <CheckThenSave action={calendarEntryAction} saveLabel="Save closure" canEdit={canEdit} id="closure">
          <input type="hidden" name="kind" value="CLOSURE" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-cd`} className="label">Date</label>
              <input id={`${uid}-cd`} type="date" name="date" defaultValue={today} min={earliest} className="input" required />
              <p className="text-xs text-ink-2">Up to {backdateMax} days back, with the reason.</p>
            </div>
            <BranchPicker branches={branches} id={`${uid}-cb`} label="Branches closed" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-cr`} className="label">Reason</label>
            <textarea id={`${uid}-cr`} name="reason" rows={2} maxLength={300} className="input" placeholder="For example: Typhoon, offices closed by the LGU" required />
          </div>
        </CheckThenSave>
      </section>

      <section aria-labelledby={`${uid}-ho`} className="flex flex-col gap-2">
        <h3 id={`${uid}-ho`} className="text-[15px] font-bold text-navy">Add a holiday</h3>
        <p className="text-sm text-ink-2">Enter the official list from the government proclamation. A date in the past (up to {backdateMax} days back) needs a reason.</p>
        <CheckThenSave action={calendarEntryAction} saveLabel="Save holiday" canEdit={canEdit} id="holiday">
          <input type="hidden" name="kind" value="HOLIDAY" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1"><label htmlFor={`${uid}-hd`} className="label">Date</label><input id={`${uid}-hd`} type="date" name="date" min={earliest} className="input" required /></div>
            <div className="flex flex-col gap-1"><label htmlFor={`${uid}-hn`} className="label">Name</label><input id={`${uid}-hn`} name="name" maxLength={80} className="input" required /></div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-ht`} className="label">Type</label>
              <select id={`${uid}-ht`} name="type" className="input" defaultValue="REGULAR">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Applies to</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} /> All branches</label>
              <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="scope" value="some" checked={scope === "some"} onChange={() => setScope("some")} /> Ticked branches</label>
            </div>
            {scope === "some" && <BranchPicker branches={branches} id={`${uid}-hb`} label="Branches" />}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-hr`} className="label">Reason (needed for a date in the past)</label>
            <input id={`${uid}-hr`} name="reason" maxLength={300} className="input" />
          </div>
        </CheckThenSave>
      </section>

      <section aria-labelledby={`${uid}-ls`} className="flex flex-col gap-2">
        <h3 id={`${uid}-ls`} className="text-[15px] font-bold text-navy">Holidays and closures</h3>
        {rows.length === 0 ? <p className="text-sm text-ink-2">None yet.</p> : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line text-sm" data-calendar-rows>
            {rows.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${r.active ? "" : "text-ink-2"}`} data-calendar-row={r.date}>
                <span className="min-w-28 font-semibold tabular-nums">{r.date}</span>
                <span className="min-w-0 flex-1">
                  {r.name}
                  <span className="block text-xs text-ink-2">
                    {r.kind === "CLOSURE" ? "Office closure" : TYPES.find(([v]) => v === r.type)?.[1] ?? r.type} · {r.where}{r.reason ? ` · ${r.reason}` : ""}
                  </span>
                </span>
                {r.isSample && <span className="chip c-act" data-sample title="Sample. Enter the official list from the government proclamation.">Sample</span>}
                {!r.active && <span className="chip c-mute">Inactive</span>}
                {canEdit && <ActiveToggle id={r.id} active={r.active} title={`${r.name} (${r.date})`} past={r.date < today} />}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-2">Making one inactive moves back only the due dates it moved. Someone with &quot;Correct due dates&quot; can correct one item on its page.</p>
      </section>
    </div>
  );
}

/**
 * Make inactive / Make active (D-042): Check first. Inactive gives back only the days this entry took from each
 * item; active again extends like a new one. A date in the past needs a reason (up to the back-dating limit).
 */
function ActiveToggle({ id, active, title, past }: { id: string; active: boolean; title: string; past: boolean }) {
  const [open, setOpen] = useState(false);
  const verb = active ? "Make inactive" : "Make active";
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={`${verb}: ${title}`}>{verb}</button>;
  return (
    <div className="basis-full" data-entry-toggle={id}>
      <CheckThenSave action={entryActiveAction} saveLabel={verb} canEdit id={`toggle-${id}`}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        {past && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`r-${id}`} className="label">Reason (this date is in the past)</label>
            <input id={`r-${id}`} name="reason" maxLength={300} className="input" />
          </div>
        )}
        <p className="text-xs text-ink-2">{active ? "Due dates this entry moved go back to what they were before it; other moves stay." : "Due dates whose count includes this day move by the day, like a new holiday."}</p>
      </CheckThenSave>
    </div>
  );
}
