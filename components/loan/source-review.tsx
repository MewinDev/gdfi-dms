"use client";

import { startTransition, useActionState, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { AlertIcon } from "@/components/ui/icons";
import { copyPapersAction, simulateSourceAction, sourceDecisionAction } from "@/app/actions/source";
import type { ReviewData } from "@/lib/services/source-review";

/** Submit without React clearing the form: a refused try keeps the note, the ticks and the picks. */
function keepValues(e: React.FormEvent<HTMLFormElement>, action: (fd: FormData) => void) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => action(fd));
}

const decide = announcing(sourceDecisionAction);
const copy = announcing(copyPapersAction);
const sim = announcing(simulateSourceAction);

/** The review pop-up: what changed, what it means, who is affected, and the Admin's decision. */
export function SourceReviewSheet({ review, open, onClose }: { review: ReviewData; open: boolean; onClose: () => void }) {
  const [state, action] = useActionState(decide, null);
  useCloseWhenDone(state, onClose);
  const uid = useId();
  const err = state && !state.ok ? state.error : null;
  const material = review.category === "MATERIAL";
  return (
    <GuardedSheet open={open} onClose={onClose} title={review.title}>
      <form onSubmit={(e) => keepValues(e, action)} className="flex flex-col gap-4" data-source-review={review.category}>
        <input type="hidden" name="changeId" value={review.id} />
        {review.simulated && <p><span className="chip c-wait h-6 text-xs">Simulated</span></p>}
        <section aria-labelledby={`${uid}-what`}>
          <h3 id={`${uid}-what`} className="mb-1.5 text-[15px] font-bold text-navy">What changed</h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2"><tr><th scope="col" className="px-3 py-1.5">Field</th><th scope="col" className="px-3 py-1.5">Was</th><th scope="col" className="px-3 py-1.5">Now</th></tr></thead>
              <tbody>
                {review.rows.map((r) => (
                  <tr key={r.label} className="border-t border-line-soft">
                    <th scope="row" className="px-3 py-1.5 font-semibold">{r.label}</th>
                    {r.hidden
                      ? <td colSpan={2} className="px-3 py-1.5 text-ink-2" data-amount-hidden>Amount changed</td>
                      : <><td className="px-3 py-1.5">{r.was}</td><td className="px-3 py-1.5 font-semibold">{r.now}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {review.history > 0 && <p className="mt-1 text-xs text-ink-2">MyLoans changed it {review.history + 1} times while this waited; this shows the first value and the latest.</p>}
        </section>
        <section aria-labelledby={`${uid}-means`}>
          <h3 id={`${uid}-means`} className="mb-1 text-[15px] font-bold text-navy">What it means</h3>
          <div className="flex flex-col gap-1 text-[14px]" data-source-means>{review.sentences.map((s) => <p key={s}>{s}</p>)}</div>
        </section>
        {review.branchMove && (
          <section aria-labelledby={`${uid}-branch`} className="rounded-xl border border-line bg-fill p-3" data-branch-move>
            <h3 id={`${uid}-branch`} className="mb-1 text-[15px] font-bold text-navy">Branch: {review.branchMove.from} → {review.branchMove.to}</h3>
            <ul className="flex flex-col gap-1 text-[14px]">
              {review.branchMove.openedAt && <li>{review.branchMove.openedAt} (from the PN; it stays).</li>}
              <li>The loan&apos;s branch changes only when you apply this. After that it shows &ldquo;{review.branchMove.openedAt ? `${review.branchMove.openedAt}, now at ${review.branchMove.to}` : `Now at ${review.branchMove.to}`}&rdquo;.</li>
              {!review.branchMove.known && <li className="font-semibold text-bad-fg">{review.branchMove.to} is not a branch here yet: accept it in Settings, Branches (Branch review) first.</li>}
              <li>Who can see it: {review.branchMove.seeBefore} {review.branchMove.seeBefore === 1 ? "person" : "people"} now, {review.branchMove.seeAfter} after.{review.branchMove.lose.length > 0 && <> Loses access: {review.branchMove.lose.join(", ")}.</>}{review.branchMove.gain.length > 0 && <> Gains access: {review.branchMove.gain.join(", ")}.</>}</li>
              <li>Open work with: {review.branchMove.las.length ? review.branchMove.las.join(", ") : "no Loan Associate (nothing sent)"}.</li>
            </ul>
          </section>
        )}
        {review.affected.length > 0 && (
          <section aria-labelledby={`${uid}-who`}>
            <h3 id={`${uid}-who`} className="mb-1 text-[15px] font-bold text-navy">Who is affected</h3>
            <ul className="flex flex-col gap-1 text-[14px]" data-source-affected>
              {review.affected.map((a) => (
                <li key={a.name} className="flex flex-wrap items-center gap-2">{a.stateLine}{a.locked && <span className="chip c-wait h-6 text-xs">Already sent</span>}</li>
              ))}
            </ul>
          </section>
        )}
        {review.cash.length > 0 && (
          <section aria-labelledby={`${uid}-cash`} className="rounded-xl border border-bad-fg/40 bg-bad-bg p-3">
            <h3 id={`${uid}-cash`} className="mb-1 flex items-center gap-1.5 text-[15px] font-bold text-bad-fg"><AlertIcon size={16} /> Cash still out</h3>
            <p className="mb-1 text-[13px]">Handle it first: nothing moves or cancels money by itself.</p>
            <ul className="flex flex-col gap-1.5 text-[14px]" data-source-cash>
              {review.cash.map((c) => (
                <li key={c.lineId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">{c.text}</span>
                  {review.canReview && review.canMove && !c.notReleased && <SubmitButton className="btn-ghost btn-sm" name="$decision" value={`move:${c.lineId}`}>Move to {review.replacedByPn}</SubmitButton>}
                </li>
              ))}
            </ul>
            {review.canReview && <div className="mt-2"><SubmitButton className="btn-secondary btn-sm" name="$decision" value="cash">Return the cash</SubmitButton></div>}
          </section>
        )}
        {review.candidates.length > 0 && !review.replacedByPn && (
          <section aria-labelledby={`${uid}-repl`} className="flex flex-col gap-1.5" data-source-replacement>
            <h3 id={`${uid}-repl`} className="text-[15px] font-bold text-navy">Possible replacement</h3>
            <p className="text-[13px] text-ink-2">Same borrower (CIN or CIF), this PN ended in MyLoans and the details match. A replacement is the same loan under a new PN; it is only allowed when no payment was made on this PN.</p>
            <ul className="flex flex-col gap-0.5 text-[14px]" data-candidates>
              {review.candidates.map((c) => (
                <li key={c.pn}><strong>{c.text}</strong>{c.matched ? <span className="block text-[13px] text-ink-2">Matches: {c.matched}</span> : null}
                  {c.differentBranch && <span className="mt-0.5 block rounded-lg bg-wait-bg px-2 py-1 text-[13px] font-semibold text-wait-fg" data-different-branch>{c.differentBranch}</span>}</li>
              ))}
            </ul>
            {review.canReview && (
              <>
                {review.candidates.length > 1 && (
                  <div>
                    <label htmlFor={`${uid}-pn`} className="label">Link which one</label>
                    <select id={`${uid}-pn`} name="newPn" className="input">{review.candidates.map((c) => <option key={c.pn} value={c.pn}>{c.pn}</option>)}</select>
                  </div>
                )}
                {review.candidates.length === 1 && <input type="hidden" name="newPn" value={review.candidates[0].pn} />}
                {review.payment.known ? (
                  <p className={`rounded-xl px-3 py-2 text-[14px] font-semibold ${review.payment.recorded ? "bg-bad-bg text-bad-fg" : "bg-ok-bg text-ok-fg"}`} data-payment>{review.payment.text}</p>
                ) : (
                  <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line px-3 py-2" data-confirm-no-payment>
                    <input type="checkbox" name="confirmNoPayment" className="mt-0.5 h-5 w-5 accent-[var(--navy)]" />
                    <span className="text-[14px] font-semibold">I confirmed no payment was made on the old PN<span className="block text-[13px] font-normal text-ink-2">MyLoans does not say whether a payment was made. Check it before linking.</span></span>
                  </label>
                )}
                {review.payment.known && review.payment.recorded && (
                  <div>
                    <label htmlFor={`${uid}-ov`} className="label">Override note (required to link anyway, at least 5 characters)</label>
                    <textarea id={`${uid}-ov`} name="overrideNote" rows={2} maxLength={300} className="input" />
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {review.canReview ? (
          <>
            {material && review.needsPicks && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor={`${uid}-ft`} className="label">Undertaking</label>
                  <select id={`${uid}-ft`} name="financingType" className="input" defaultValue=""><option value="" disabled>Pick one</option><option value="UNDERTAKING">Undertaking</option><option value="NON_UNDERTAKING">Non-Undertaking</option></select></div>
                <div><label htmlFor={`${uid}-or`} className="label">ORCR</label>
                  <select id={`${uid}-or`} name="orcrStatus" className="input" defaultValue=""><option value="" disabled>Pick one</option><option value="TRANSFERRED">Transferred</option><option value="UNTRANSFERRED">Untransferred</option></select></div>
              </div>
            )}
            <div>
              <label htmlFor={`${uid}-note`} className="label">Note (required)</label>
              <textarea id={`${uid}-note`} name="note" rows={2} maxLength={500} className="input" aria-invalid={state?.field === "note"} aria-describedby={`${uid}-note-h`} placeholder="For example: client confirmed by phone" />
              <p id={`${uid}-note-h`} className="help">5 to 500 characters.</p>
            </div>
            {err && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-[14px] font-semibold text-bad-fg" data-source-error>{err}</p>}
            {state?.ok && <FormMessage state={state} />}
            <div className="flex flex-wrap justify-end gap-2">
              <SheetCancel />
              <SubmitButton className="btn-ghost" name="$decision" value="keep">Keep current</SubmitButton>
              {!material && review.candidates.length > 0 && !review.replacedByPn && <SubmitButton className="btn-secondary" name="$decision" value="link">Link as replacement</SubmitButton>}
              {!material && !review.replacedByPn && review.candidates.some((c) => c.differentBranch) && (
                <p className="basis-full text-right text-[13px] font-semibold text-wait-fg" data-link-branch-note>{review.candidates.filter((c) => c.differentBranch).map((c) => `${c.pn}: ${c.differentBranch}`).join(" · ")}. You can still link it.</p>
              )}
              {material ? <SubmitButton name="$decision" value="apply">Apply changes</SubmitButton> : <SubmitButton name="$decision" value="close">Close as cancelled</SubmitButton>}
            </div>
          </>
        ) : (
          <>
            <p className="rounded-xl bg-fill px-3 py-2 text-[14px] font-semibold text-navy" data-source-waiting>Waiting for Admin to review.</p>
            <div className="flex justify-end"><SheetCancel>Close</SheetCancel></div>
          </>
        )}
      </form>
    </GuardedSheet>
  );
}

/** Loan File, To do: the "MyLoans changes" entry (opens itself from ?review=1). */
export function SourceReviewEntry({ review }: { review: ReviewData }) {
  const auto = useSearchParams().get("review") === "1";
  const [open, setOpen] = useState(false);
  useEffect(() => { if (auto) { const t = window.setTimeout(() => setOpen(true), 0); return () => window.clearTimeout(t); } }, [auto]);
  return (
    <section aria-labelledby="source-h" className="rounded-[14px] border-2 border-bad-fg/60 bg-bad-bg p-4 sm:p-5" data-source-entry>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id="source-h" className="flex items-center gap-2 text-lg font-bold text-bad-fg"><AlertIcon size={20} /> MyLoans changes · Needs review</h2>
          <p className="text-[15px]">{review.category === "MATERIAL" ? `Changed: ${review.fields}.` : review.category === "REPLACEMENT" ? `MyLoans gave this loan a replacement PN.` : "MyLoans says this loan is cancelled or not released."} {review.canReview ? "" : "Waiting for Admin to review."}</p>
        </div>
        <button type="button" className="btn-navy shrink-0" onClick={() => setOpen(true)}>Review</button>
      </div>
      <SourceReviewSheet review={review} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

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
          <option value="amount">Change the amount (across the Rule 4 threshold)</option>
          <option value="name">Change the borrower name, address and contact number</option>
          <option value="cif">Change the borrower&apos;s CIF</option>
          <option value="area">Correct the area name (minor)</option>
          <option value="product">Change the product name</option>
          <option value="cancel">Set the loan cancelled</option>
          <option value="replace">Create a replacement PN</option>
          <option value="branch">Move the loan to another branch</option>
        </select>
      </div>
      <SubmitButton className="btn-secondary">Simulate</SubmitButton>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}
