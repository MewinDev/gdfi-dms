"use client";

import { useActionState, useState } from "react";
import { addTransactionAction, completeLaTransactionAction } from "@/app/actions/loan";
import { PlusIcon } from "@/components/ui/icons";

/**
 * Check documents: "Add a transaction". Lists the active custom transaction types (the automation
 * rules never create them). Adding one copies its checklist from Checklist items.
 */
export function AddTransaction({ loanId, types }: { loanId: string; types: { id: string; name: string; papers: number; requiresDp: boolean; added: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addTransactionAction, null);
  return (
    <section aria-label="Add a transaction" className="flex flex-col gap-3">
      <button type="button" aria-expanded={open} aria-controls="add-txn-list" onClick={() => setOpen((v) => !v)}
        className="btn-ghost btn-sm self-start gap-1.5">
        <PlusIcon size={16} /> Add a transaction
      </button>
      {open && (
        <div id="add-txn-list" className="card p-4 sm:p-5">
          <p className="text-sm text-ink-2">Only for work the automation does not set up. The papers to tick come from Settings.</p>
          <ul className="mt-3 divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-navy">{t.name}</span>
                  <span className="block text-sm text-ink-2">
                    {t.papers === 0 ? "No papers set yet" : `${t.papers} paper${t.papers === 1 ? "" : "s"} to tick`} · {t.requiresDp ? "sent to a processor" : "done by you"}
                  </span>
                </span>
                {t.added ? (
                  <span className="chip c-ok h-6 text-xs">Added</span>
                ) : (
                  <form action={action}>
                    <input type="hidden" name="loanId" value={loanId} />
                    <input type="hidden" name="typeId" value={t.id} />
                    <button type="submit" disabled={pending} className="btn-gold btn-sm" aria-label={`Add ${t.name}`}>Add</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {state && !state.ok && <p role="alert" className="mt-2 text-sm text-bad-fg">{state.error}</p>}
          {state?.ok && <p role="status" className="mt-2 text-sm font-semibold text-ok-fg">{state.message}</p>}
        </div>
      )}
    </section>
  );
}

/** A custom transaction done by the Loan Associate (no processor): Mark as done once its required papers are ticked. */
export function MarkDone({ transactionId, name, ready }: { transactionId: string; name: string; ready: boolean }) {
  const [state, action, pending] = useActionState(completeLaTransactionAction, null);
  return (
    <form action={action} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:p-5">
      <input type="hidden" name="transactionId" value={transactionId} />
      <p className="min-w-0 flex-1 text-[15px]">
        {ready ? `When ${name} is finished, mark it as done.` : "Tick the required papers first, then mark it as done."}
      </p>
      <button type="submit" disabled={!ready || pending} className="btn-gold">{pending ? "Saving..." : "Mark as done"}</button>
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg sm:basis-full">{state.error}</p>}
    </form>
  );
}
