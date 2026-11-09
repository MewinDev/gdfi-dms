"use client";

import { useActionState, useId, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { saveDefaultCapacityAction, saveDpCapacityAction } from "@/app/actions/monitoring";
import { AVAILABILITY } from "@/lib/monitoring/rules";

const saveDefault = announcing(saveDefaultCapacityAction);
const saveDp = announcing(saveDpCapacityAction);

/** Settings, Processor capacity: the default number of open jobs. */
export function DefaultCapacityForm({ value }: { value: number }) {
  const [state, action] = useActionState(saveDefault, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3" data-default-capacity>
      <div>
        <label htmlFor={`${uid}-c`} className="label">Default capacity (open jobs)</label>
        <input id={`${uid}-c`} name="defaultCapacity" type="number" min={AVAILABILITY.minCapacity} max={AVAILABILITY.maxCapacity} step={1} defaultValue={value} className="input w-32" required />
      </div>
      <SubmitButton className="btn-secondary">Save default</SubmitButton>
      <p className="basis-full text-[13px] text-ink-2">Used for every processor without their own capacity. Available from {AVAILABILITY.availableFrom}% free, Busy from 1% to {AVAILABILITY.availableFrom - 1}%, Full at 0%.</p>
      {state && <div className="basis-full"><FormMessage state={state} /></div>}
    </form>
  );
}

export interface DpCapacityRowData {
  id: string;
  name: string;
  branches: string;
  ownCapacity: number | null;
  capacity: number;
  onLeave: boolean;
  leaveUntil: string | null;
  open: number;
  availText: string;
}

/** One processor: own capacity (blank = the default) and On leave with an optional last day. */
export function DpCapacityRow({ d, defaultCapacity, today }: { d: DpCapacityRowData; defaultCapacity: number; today: string }) {
  const [state, action] = useActionState(saveDp, null);
  const [leave, setLeave] = useState(d.onLeave);
  const uid = useId();
  return (
    <li className="rounded-xl border border-line p-3" data-dp-capacity={d.name}>
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="userId" value={d.id} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-[15px] font-semibold text-navy">{d.name}</p>
          <p className="text-[13px] text-ink-2">{d.branches} · {d.availText}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`${uid}-c`} className="label">Capacity (optional)</label>
            <input id={`${uid}-c`} name="capacity" type="number" min={AVAILABILITY.minCapacity} max={AVAILABILITY.maxCapacity} step={1} defaultValue={d.ownCapacity ?? ""} placeholder={`Default (${defaultCapacity})`} className="input w-36" />
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
            <input type="checkbox" name="onLeave" checked={leave} onChange={(e) => setLeave(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" role="switch" aria-checked={leave} /> On leave
          </label>
          {leave && (
            <div>
              <label htmlFor={`${uid}-u`} className="label">Until (optional, last day)</label>
              <input id={`${uid}-u`} name="leaveUntil" type="date" min={today} defaultValue={d.leaveUntil ?? ""} className="input" />
            </div>
          )}
          <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
        </div>
        {state && <FormMessage state={state} />}
      </form>
    </li>
  );
}
