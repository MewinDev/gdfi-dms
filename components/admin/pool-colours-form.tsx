"use client";

import { useActionState, useId } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { savePoolColoursAction } from "@/app/actions/work";

const save = announcing(savePoolColoursAction);

/** Settings, Inbox waiting colours (D-046, D-048): amber, then red, after N working days waiting in a branch pool. */
export function PoolColoursForm({ amber, red, canEdit }: { amber: number; red: number; canEdit: boolean }) {
  const [state, action] = useActionState(save, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-line p-3" data-pool-colours>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-a`} className="label">Amber after (working days)</label>
          <input id={`${id}-a`} name="amber" type="number" min={1} max={30} step={1} defaultValue={amber} required disabled={!canEdit} className="input w-32" aria-invalid={state?.field === "amber"} />
        </div>
        <div>
          <label htmlFor={`${id}-r`} className="label">Red after (working days)</label>
          <input id={`${id}-r`} name="red" type="number" min={2} max={30} step={1} defaultValue={red} required disabled={!canEdit} className="input w-32" aria-invalid={state?.field === "red"} />
        </div>
        {canEdit && <SubmitButton className="btn-secondary">Save</SubmitButton>}
      </div>
      <p className="text-[13px] text-ink-2">An item waiting in a branch pool is green the day it arrives, amber after this many working days, and red after that. Red items count on the supervisors&rsquo; Home as &ldquo;waiting in the pool too long&rdquo;. Red must come after amber.</p>
      <FormMessage state={state} />
    </form>
  );
}
