"use client";

import { startTransition, useActionState, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { AlertIcon } from "@/components/ui/icons";
import { borrowerDecisionAction } from "@/app/actions/source";
import { charDiff, type Part } from "@/lib/ui/char-diff";
import type { BorrowerReviewData } from "@/lib/services/borrower-review";

const decide = announcing(borrowerDecisionAction);

function keepValues(e: React.FormEvent<HTMLFormElement>, action: (fd: FormData) => void) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => action(fd));
}

/** One side of a changed value: the characters that differ are marked. */
function Marked({ parts, tone }: { parts: Part[]; tone: "was" | "now" }) {
  if (!parts.length) return <span className="text-ink-2">blank</span>;
  return (
    <span className="break-words">
      {parts.map((p, i) => p.changed
        ? <mark key={i} className={`rounded-sm px-0.5 ${tone === "was" ? "bg-bad-bg text-bad-fg line-through decoration-1" : "bg-ok-bg font-bold text-ok-fg"}`} data-diff={tone}>{p.text}</mark>
        : <span key={i}>{p.text}</span>)}
    </span>
  );
}

/**
 * The Borrower details review: old and new side by side for every field that changed (the characters
 * that differ are marked), what it means, and Accept the correction or Keep current with a note. People
 * who cannot decide see the same, read-only, with who reviews it.
 */
export function BorrowerReviewSheet({ review, open, onClose }: { review: BorrowerReviewData; open: boolean; onClose: () => void }) {
  const [state, action] = useActionState(decide, null);
  useCloseWhenDone(state, onClose);
  const uid = useId();
  const err = state && !state.ok ? state.error : null;
  return (
    <GuardedSheet open={open} onClose={onClose} title={review.title}>
      <form onSubmit={(e) => keepValues(e, action)} className="flex flex-col gap-4" data-borrower-review>
        <input type="hidden" name="changeId" value={review.id} />
        {review.simulated && <p><span className="chip c-wait h-6 text-xs">Simulated</span></p>}
        {review.toAdmin && <p className="rounded-xl bg-wait-bg px-3 py-2 text-[14px] font-semibold text-wait-fg" data-borrower-to-admin>No supervisor or approver in this branch. Admin reviews it.</p>}
        <section aria-labelledby={`${uid}-what`}>
          <h3 id={`${uid}-what`} className="mb-1.5 text-[15px] font-bold text-navy">What changed</h3>
          {/* Desktop and tablet: a table. Phone: one block per field (no sideways scroll). */}
          <div className="hidden rounded-xl border border-line sm:block">
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2">
                <tr><th scope="col" className="w-[20%] px-3 py-1.5">Field</th><th scope="col" className="px-3 py-1.5">In the DMS now</th><th scope="col" className="px-3 py-1.5">MyLoans now</th><th scope="col" className="w-[22%] px-3 py-1.5">MyLoans answered</th></tr>
              </thead>
              <tbody>
                {review.rows.map((r) => {
                  const d = charDiff(r.dms === "blank" ? "" : r.dms, r.myloans === "blank" ? "" : r.myloans);
                  return (
                    <tr key={r.field} className="border-t border-line-soft align-top" data-borrower-row={r.field}>
                      <th scope="row" className="px-3 py-1.5 font-semibold">{r.label}</th>
                      <td className="px-3 py-1.5"><Marked parts={d.was} tone="was" /></td>
                      <td className="px-3 py-1.5"><Marked parts={d.now} tone="now" /></td>
                      <td className="px-3 py-1.5 text-[13px] text-ink-2">{r.at}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 sm:hidden">
            {review.rows.map((r) => {
              const d = charDiff(r.dms === "blank" ? "" : r.dms, r.myloans === "blank" ? "" : r.myloans);
              return (
                <li key={r.field} className="rounded-xl border border-line p-3 text-[14px]" data-borrower-row-m={r.field}>
                  <p className="font-bold text-navy">{r.label}</p>
                  <p className="mt-1"><span className="block text-xs text-ink-2">In the DMS now</span><Marked parts={d.was} tone="was" /></p>
                  <p className="mt-1"><span className="block text-xs text-ink-2">MyLoans now</span><Marked parts={d.now} tone="now" /></p>
                  <p className="mt-1 text-[12px] text-ink-2">MyLoans answered {r.at}</p>
                </li>
              );
            })}
          </ul>
          {review.history > 0 && <p className="mt-1 text-xs text-ink-2">MyLoans changed it {review.history + 1} times while this waited; this shows the latest.</p>}
        </section>
        <section aria-labelledby={`${uid}-means`}>
          <h3 id={`${uid}-means`} className="mb-1 text-[15px] font-bold text-navy">What it means</h3>
          <div className="flex flex-col gap-1 text-[14px]" data-borrower-means>
            {review.sentences.map((s) => <p key={s}>{s}</p>)}
            <p className="text-ink-2">Until it is decided the loan keeps showing the DMS details. Send, Accept and funds keep working.</p>
          </div>
        </section>
        {review.canDecide ? (
          <>
            <div>
              <label htmlFor={`${uid}-note`} className="label">Note (required)</label>
              <textarea id={`${uid}-note`} name="note" rows={2} maxLength={500} className="input" aria-invalid={state?.field === "note"} aria-describedby={`${uid}-note-h`} placeholder="For example: checked the borrower's valid ID" />
              <p id={`${uid}-note-h`} className="help">5 to 500 characters.</p>
            </div>
            {err && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-[14px] font-semibold text-bad-fg" data-borrower-error>{err}</p>}
            {state?.ok && <FormMessage state={state} />}
            <div className="flex flex-wrap justify-end gap-2">
              <SheetCancel />
              <SubmitButton className="btn-ghost" name="$decision" value="keep">Keep current</SubmitButton>
              <SubmitButton name="$decision" value="accept">Accept the correction</SubmitButton>
            </div>
          </>
        ) : (
          <>
            <p className="rounded-xl bg-fill px-3 py-2 text-[14px] font-semibold text-navy" data-borrower-waiting>{review.waiting}</p>
            <div className="flex justify-end"><SheetCancel>Close</SheetCancel></div>
          </>
        )}
      </form>
    </GuardedSheet>
  );
}

/** Loan File, To do: the "MyLoans corrections" entry (opens itself from ?correction=1). */
export function BorrowerReviewEntry({ review }: { review: BorrowerReviewData }) {
  const auto = useSearchParams().get("correction") === "1";
  const [open, setOpen] = useState(false);
  useEffect(() => { if (auto) { const t = window.setTimeout(() => setOpen(true), 0); return () => window.clearTimeout(t); } }, [auto]);
  return (
    <section aria-labelledby="borrower-h" className="rounded-[14px] border-2 border-wait-fg/50 bg-wait-bg p-4 sm:p-5" data-borrower-entry>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id="borrower-h" className="flex items-center gap-2 text-lg font-bold text-wait-fg"><AlertIcon size={20} /> MyLoans corrections · Borrower details</h2>
          <p className="text-[15px]">Changed: {review.fields}. {review.canDecide ? "Review it: Accept the correction or Keep current." : review.waiting}</p>
        </div>
        <button type="button" className="btn-navy shrink-0" onClick={() => setOpen(true)}>{review.canDecide ? "Review" : "See the change"}</button>
      </div>
      <BorrowerReviewSheet review={review} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
