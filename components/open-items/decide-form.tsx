"use client";

import { useActionState, useId } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { askCashBackAction, decideOpenItemAction, moveCashAction } from "@/app/actions/open-items";

const decide = announcing(decideOpenItemAction);
const cashBack = announcing(askCashBackAction);
const moveCash = announcing(moveCashAction);

/** Approve / Reject one Open Item (or a loan's rule group), with the required remarks (5 to 500). */
export function DecideForm({ itemId, picks, label }: { itemId: string; picks: boolean; label: string }) {
  const [state, action] = useActionState(decide, null);
  const id = useId();
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  return (
    <form action={action} className="flex flex-col gap-2" data-decide-form>
      <input type="hidden" name="itemId" value={itemId} />
      {picks && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm" data-picks>
          <legend className="label">The product now means Financing: pick both to approve</legend>
          {([["financingType", "UNDERTAKING", "Undertaking"], ["financingType", "NON_UNDERTAKING", "Non-Undertaking"], ["orcrStatus", "TRANSFERRED", "Transferred"], ["orcrStatus", "UNTRANSFERRED", "Untransferred"]] as const).map(([n, v, l]) => (
            <label key={v} className="flex min-h-11 items-center gap-2"><input type="radio" name={n} value={v} className="h-5 w-5" />{l}</label>
          ))}
        </fieldset>
      )}
      <label htmlFor={`${id}-r`} className="label">Remarks (required)</label>
      <textarea id={`${id}-r`} name="remarks" rows={2} maxLength={500} className="input" aria-invalid={!!err("remarks")} aria-describedby={`${id}-h`} />
      <p id={`${id}-h`} className="help">5 to 500 characters. Saved with the decision and in the audit log.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn-navy btn-sm" name="decision" value="APPROVE" aria-label={`Approve ${label}`}>Approve</SubmitButton>
        <SubmitButton className="btn-ghost btn-sm" name="decision" value="REJECT" aria-label={`Reject ${label}`}>Reject</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** Cash still out on a loan that left Released: ask for it back before approving. */
export function CashBackForm({ loanId }: { loanId: string }) {
  const [state, action] = useActionState(cashBack, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-cash-back>
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label htmlFor={`${id}-r`} className="label">Remarks for the cash back</label>
        <input id={`${id}-r`} name="remarks" maxLength={500} className="input" />
      </div>
      <SubmitButton className="btn-secondary btn-sm">Ask for the cash back</SubmitButton>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function MoveCashForm({ loanId, lineId, label }: { loanId: string; lineId: string; label: string }) {
  const [state, action] = useActionState(moveCash, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-move-cash>
      <input type="hidden" name="loanId" value={loanId} />
      <input type="hidden" name="lineId" value={lineId} />
      <SubmitButton className="btn-ghost btn-sm">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
