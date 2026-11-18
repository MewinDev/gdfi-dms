"use client";

import { useActionState, useId, useState } from "react";
import { takeBackFromPoolAction } from "@/app/actions/work";
import { FormMessage } from "@/components/form-status";

/** Sent to the Branch DP pool, nobody accepted yet (D-046): the line, and Take it back for the LA who may send. */
export function PoolTakeBack({ transactionId, text, canTake }: { transactionId: string; text: string; canTake: boolean }) {
  const [state, action, pending] = useActionState(takeBackFromPoolAction, null);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-wait-bg px-4 py-3 text-[15px] text-wait-fg" data-pool-line>
      <p>{text}</p>
      {canTake && !open && <button type="button" className="link inline-flex min-h-11 items-center self-start text-[13px]" onClick={() => setOpen(true)}>Take it back</button>}
      {canTake && open && (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="transactionId" value={transactionId} />
          <label htmlFor={`${id}-r`} className="label">Why do you take it back?</label>
          <input id={`${id}-r`} name="reason" required minLength={3} maxLength={300} className="input" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-navy btn-sm" disabled={pending}>{pending ? "Taking back..." : "Take it back"}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}
