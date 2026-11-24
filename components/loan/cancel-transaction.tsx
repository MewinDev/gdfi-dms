"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { cancelTransactionAction } from "@/app/actions/loan";

const cancelAnnounced = announcing(cancelTransactionAction);

/**
 * Cancel a transaction (D-056 item 2). The confirm step says what happens first: the processor's job stops, and any
 * cash already released stays owed and must be liquidated (D-044 item 2). A reason is required.
 */
export function CancelTransaction({ transactionId, name, jobs, cashWords }: { transactionId: string; name: string; jobs: string[]; cashWords: string[] }) {
  const [state, action] = useActionState(cancelAnnounced, null);
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <div className="flex justify-end" data-cancel-transaction>
      <button type="button" className="btn-ghost btn-sm text-bad-fg" onClick={() => setOpen(true)}>Cancel transaction</button>
      <GuardedSheet open={open} onClose={close} title={`Cancel ${name}`}>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transactionId} />
          <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-ink" data-purpose>
            {name} will be cancelled on this loan file. Its papers stay recorded; nothing is deleted.
            {jobs.length ? ` ${jobs.join(" and ")}'s job stops, and they are told.` : ""}
          </p>
          {cashWords.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl bg-act-bg px-3 py-2 text-[13px] text-act-fg" data-cancel-cash>
              {cashWords.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div>
            <label htmlFor={`${uid}-r`} className="label">Why cancel it?</label>
            <textarea id={`${uid}-r`} name="reason" rows={2} required minLength={5} maxLength={500} className="input" />
          </div>
          {state && !state.ok && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Cancel transaction</SubmitButton></div>
        </form>
      </GuardedSheet>
    </div>
  );
}
