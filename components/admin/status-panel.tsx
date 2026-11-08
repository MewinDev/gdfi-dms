"use client";

import { useActionState, useState } from "react";
import { setActiveAction } from "@/app/actions/admin";
import { SAVED_EVENT } from "./settings-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Status of one row, shown under the edit form: Make inactive (with a short confirm in plain
 * words, inside the same window) or Make active. Nothing is ever deleted. The server enforces the
 * hard limits (built-in types, last active row, yourself, last Admin) and writes the audit row.
 */
export function StatusPanel({
  kind, id, active, effect, lockedReason, noun,
}: {
  kind: string;
  id: string;
  active: boolean;
  /** Plain words about what making it inactive does, with counts. Ends with "Make inactive?" */
  effect: string;
  /** Shown instead of the button when it can never be inactive (e.g. built-in transaction types). */
  lockedReason?: string;
  noun: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof setActiveAction>>, fd: FormData) => {
    const r = await setActiveAction(prev, fd);
    if (r?.ok) {
      setConfirming(false);
      window.dispatchEvent(new Event(SAVED_EVENT));
    }
    return r;
  }, null);

  return (
    <section aria-label="Status" className="mt-6 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[15px]">
          <span className="font-semibold text-navy">Status: </span>
          {active ? <span className="chip c-ok h-6 text-xs">Active</span> : <span className="chip c-mute h-6 text-xs">Inactive</span>}
        </p>
        {lockedReason ? (
          <p className="w-full text-sm text-ink-2">{lockedReason}</p>
        ) : !confirming ? (
          active ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(true)}>Make inactive</button>
          ) : (
            <form action={action}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="active" value="true" />
              <button type="submit" disabled={pending} className="btn-ghost btn-sm">{pending ? "Saving..." : "Make active"}</button>
            </form>
          )
        ) : null}
      </div>
      {!active && !lockedReason && <p className="mt-2 text-sm text-ink-2">Inactive: kept with its history, but not offered for new work. Nothing is deleted.</p>}
      {/* The question opens in the shared confirm window; its button submits this form. */}
      <form id={`inactive-${id}`} action={action} hidden>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value="false" />
      </form>
      <ConfirmDialog
        open={confirming && active}
        title={`Make this ${noun} inactive?`}
        body={effect}
        cancelLabel="Keep it active"
        confirmLabel="Make inactive"
        confirmForm={`inactive-${id}`}
        pending={pending}
        onCancel={() => setConfirming(false)}
      />
      {state && !state.ok && <p role="alert" className="mt-2 text-sm text-bad-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-2 text-sm font-semibold text-ok-fg">{state.message ?? "Saved."}</p>}
    </section>
  );
}
