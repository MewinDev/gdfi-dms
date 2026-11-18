"use client";

import { useActionState, useId, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { copyPapersAction, simulateSourceAction } from "@/app/actions/source";

const copy = announcing(copyPapersAction);
const sim = announcing(simulateSourceAction);

/**
 * Copy reusable papers from a related loan, each paper ticked to confirm, then one confirmation.
 * Replacement: the papers are taken over. Additional unit: only papers needed as a Copy here; an
 * Original stays filed under the other PN (shown with the reason, cannot be ticked).
 */
export function CopyReusablePapers({ loanId, oldPn, mode, options }: {
  loanId: string; oldPn: string; mode: "replacement" | "additional";
  options: { fromCheckId: string; label: string; fromTxn: string; toTxn: string; documentId: string | null; blocked: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [ask, setAsk] = useState(false);
  const [state, action] = useActionState(copy, null);
  const close = () => { setOpen(false); setPicked([]); };
  useCloseWhenDone(state, close);
  const formId = useId();
  const usable = options.filter((o) => !o.blocked).length;
  const replacement = mode === "replacement";
  return (
    <section aria-labelledby={`${formId}-h`} className="card flex flex-col gap-2 border-2 border-navy/30 p-4 sm:flex-row sm:items-center" data-copy-papers={mode}>
      <div className="min-w-0 flex-1">
        <h2 id={`${formId}-h`} className="text-[17px] font-bold text-navy">Copy reusable papers from {oldPn}</h2>
        <p className="text-[14px] text-ink-2">{replacement
          ? `${usable} paper${usable === 1 ? "" : "s"} that belong to the borrower (valid IDs, SPA) can be reused. Unit papers are never copied.`
          : `Additional unit: ${usable} cop${usable === 1 ? "y" : "ies"} can be referenced. Originals stay filed under ${oldPn}. Unit papers are never copied.`}</p>
      </div>
      <button type="button" className="btn-secondary shrink-0" onClick={() => setOpen(true)}>Copy reusable papers</button>
      <GuardedSheet open={open} onClose={close} title={`Copy reusable papers from ${oldPn}`}>
        <form id={formId} action={action} className="flex flex-col gap-3">
          <input type="hidden" name="loanId" value={loanId} />
          <p className="rounded-xl bg-fill px-3 py-2 text-[13px]">{replacement
            ? <>Tick each paper you have checked is the same one. It is ticked on this loan and its custody says &ldquo;Reassigned from {oldPn}&rdquo;.</>
            : <>This is an additional unit (a new loan): {oldPn} keeps its papers. Tick a copy only if it is the same one; custody says &ldquo;Referenced from {oldPn}&rdquo;.</>}</p>
          <ul className="flex flex-col gap-1.5">
            {options.map((o) => (
              <li key={o.fromCheckId}>
                <label className={`flex min-h-11 items-start gap-3 rounded-xl border px-3 py-2 ${o.blocked ? "border-line-soft bg-fill" : "border-line"}`} data-copy-option={o.blocked ? "original" : "copy"}>
                  <input type="checkbox" name="checkIds" value={o.fromCheckId} className="mt-1 h-5 w-5 accent-[var(--navy)]" disabled={!!o.blocked}
                    checked={picked.includes(o.fromCheckId)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.fromCheckId] : picked.filter((x) => x !== o.fromCheckId))} />
                  <span className="min-w-0"><span className="block text-[15px] font-semibold">{o.label}</span>
                    <span className="block text-[13px] text-ink-2">{o.documentId ?? "No Document ID"} · from {o.fromTxn} to {o.toTxn}</span>
                    {o.blocked && <span className="mt-0.5 block text-[13px] font-semibold text-act-fg">{o.blocked}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          {state && !state.ok && <FormMessage state={state} />}
          <div className="flex justify-end gap-2">
            <SheetCancel />
            <button type="button" className="btn-gold" disabled={!picked.length} onClick={() => setAsk(true)}>Copy {picked.length || ""} paper{picked.length === 1 ? "" : "s"}</button>
          </div>
        </form>
      </GuardedSheet>
      <ConfirmDialog open={ask} title="Copy these papers?" body={`${picked.length} paper${picked.length === 1 ? "" : "s"} from ${oldPn} will be ticked on this loan.`} confirmLabel="Copy" confirmForm={formId} onCancel={() => setAsk(false)} onConfirm={() => setAsk(false)} />
    </section>
  );
}

/** Admin simulator (test mode, mock MyLoans): make MyLoans change this loan. */
export function SimulateSourceChange({ loanId }: { loanId: string }) {
  const [state, action] = useActionState(sim, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-gold p-3" data-simulate-source>
      <input type="hidden" name="loanId" value={loanId} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`${uid}-k`} className="label">Simulate a MyLoans change</label>
        <select id={`${uid}-k`} name="kind" className="input">
          <option value="amount">Change the amount (across the mortgage threshold)</option>
          <option value="name">Change the borrower name</option>
          <option value="cif">Change the borrower&apos;s CIF</option>
          <option value="area">Correct the area name (minor)</option>
          <option value="product">Change the product name</option>
          <option value="cancel">Set the loan cancelled</option>
          <option value="notreleased">Set the loan not released</option>
          <option value="released">Set the loan released again</option>
          <option value="replace">Create a replacement PN</option>
          <option value="branch">Move the loan to another branch</option>
        </select>
      </div>
      <SubmitButton className="btn-secondary">Simulate</SubmitButton>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}
