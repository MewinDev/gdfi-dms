"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { linkRelatedAction } from "@/app/actions/source";
import type { RelatedRow } from "@/lib/services/source-review";

/** Submit without React clearing the form: a refused try keeps the note, the ticks and the picks. */
function keepValues(e: React.FormEvent<HTMLFormElement>, action: (fd: FormData) => void) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => action(fd));
}

const link = announcing(linkRelatedAction);
const TAG_CLS: Record<RelatedRow["tag"], string> = { REPLACES: "c-navy", REPLACED_BY: "c-navy", POSSIBLE: "c-act", ADDITIONAL: "c-mute" };

/** Loan File, right column: other loans of the same borrower (CIN or CIF). Hidden when there are none. */
export function RelatedLoansCard({ loanId, rows, hidden }: { loanId: string; rows: RelatedRow[]; hidden: number }) {
  const [linking, setLinking] = useState<RelatedRow | null>(null);
  if (!rows.length && !hidden) return null;
  return (
    <section aria-labelledby="related-h" className="card overflow-hidden" data-related-loans>
      <h2 id="related-h" className="px-4 pb-2 pt-3.5 text-[17px] font-bold text-navy">Related loans ({rows.length + hidden})</h2>
      <p className="px-4 pb-2 text-[13px] text-ink-2">Same borrower (CIN or CIF). A replacement is the same loan under a new PN; an additional unit is a new loan.</p>
      <ul className="border-t border-line">
        {rows.map((r) => (
          <li key={r.pn} className="border-b border-line-soft last:border-0" data-related-row={r.tag}>
            <Link href={`/loans/${r.pn}`} className="flex flex-col gap-0.5 px-4 py-2.5 no-underline hover:bg-fill">
              <span className="flex flex-wrap items-center gap-2">
                <span className="mono text-[14px] font-bold text-navy">{r.pn}</span>
                <span className={`chip ${TAG_CLS[r.tag]} h-6 text-xs`}>{r.tagText}</span>
              </span>
              <span className="text-[13px] text-ink">{r.product}{r.amount ? ` · ${r.amount}` : ""}</span>
              <span className="text-[12px] text-ink-2">{r.stage} · MyLoans: {r.status}</span>
              {r.reason && r.tag !== "ADDITIONAL" && <span className="text-[12px] text-ink-2">{r.reason}</span>}
            </Link>
            {r.canLink && (
              <div className="px-4 pb-2.5">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setLinking(r)}>Link as replacement</button>
              </div>
            )}
          </li>
        ))}
        {hidden > 0 && <li className="px-4 py-2.5 text-[13px] text-ink-2" data-related-hidden>{hidden} more loan{hidden === 1 ? "" : "s"} in another branch</li>}
      </ul>
      {linking && <LinkSheet loanId={loanId} row={linking} onClose={() => setLinking(null)} />}
    </section>
  );
}

function LinkSheet({ loanId, row, onClose }: { loanId: string; row: RelatedRow; onClose: () => void }) {
  const [state, action] = useActionState(link, null);
  useCloseWhenDone(state, onClose);
  const uid = useId();
  return (
    <GuardedSheet open onClose={onClose} title="Link as replacement">
      <form onSubmit={(e) => keepValues(e, action)} className="flex flex-col gap-3" data-link-sheet>
        <input type="hidden" name="loanId" value={loanId} />
        <input type="hidden" name="otherPn" value={row.pn} />
        <p className="rounded-xl bg-fill px-3 py-2 text-[13px]">{row.newPn} replaces {row.oldPn}: the same loan under a new PN, only when no payment was made on {row.oldPn}. {row.tag === "ADDITIONAL" ? "The system sees this as an additional unit: link it only for an unusual case you have checked." : ""}</p>
        {row.reason && <p className="text-[13px] text-ink-2">{row.reason}</p>}
        {row.differentBranch && <p className="rounded-xl bg-wait-bg px-3 py-2 text-[14px] font-semibold text-wait-fg" data-different-branch>{row.differentBranch}. You can still link it.</p>}
        {row.payment.known ? (
          <p className={`rounded-xl px-3 py-2 text-[14px] font-semibold ${row.payment.recorded ? "bg-bad-bg text-bad-fg" : "bg-ok-bg text-ok-fg"}`}>{row.payment.text}</p>
        ) : (
          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line px-3 py-2">
            <input type="checkbox" name="confirmNoPayment" className="mt-0.5 h-5 w-5 accent-[var(--navy)]" />
            <span className="text-[14px] font-semibold">I confirmed no payment was made on the old PN</span>
          </label>
        )}
        {row.payment.recorded && (
          <div><label htmlFor={`${uid}-ov`} className="label">Override note (required to link anyway, at least 5 characters)</label><textarea id={`${uid}-ov`} name="overrideNote" rows={2} maxLength={300} className="input" /></div>
        )}
        <div><label htmlFor={`${uid}-n`} className="label">Note (required)</label><textarea id={`${uid}-n`} name="note" rows={2} maxLength={500} className="input" aria-describedby={`${uid}-n-h`} placeholder="Why this is a replacement" /><p id={`${uid}-n-h`} className="help">5 to 500 characters.</p></div>
        {state && !state.ok && <FormMessage state={state} />}
        <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Link as replacement</SubmitButton></div>
      </form>
    </GuardedSheet>
  );
}
