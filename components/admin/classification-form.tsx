"use client";

import { useActionState } from "react";
import { saveClassificationAction, reclassifyAction } from "@/app/actions/classification";

/** Settings, Product classification (D-031): the two keyword lists and the default. Test keyword rules is a GET (no save). */
export function ClassificationForm({ refinancing, financing, fallback, canEdit, formId }: { refinancing: string[]; financing: string[]; fallback: "FINANCING" | "REFINANCING"; canEdit: boolean; formId: string }) {
  const [state, action] = useActionState(saveClassificationAction, null);
  const err = state && !state.ok ? state.error : null;
  return (
    <form id={formId} action={action} className="flex flex-col gap-4" data-classification-form>
      <p className="text-sm text-ink-2">
        Order of checks on the product name (capital letters, hyphens and extra spaces do not matter): 1. a Refinancing keyword → Refinancing; 2. else a Financing keyword → Financing; 3. else the default. Refinancing is checked first, so a Refinancing name never becomes Financing.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Refinancing keywords (one per line)
          <textarea name="refinancing" defaultValue={refinancing.join("\n")} rows={4} readOnly={!canEdit} className="input min-h-24 font-mono" aria-invalid={state?.field === "refinancing" || undefined} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Financing keywords (one per line)
          <textarea name="financing" defaultValue={financing.join("\n")} rows={4} readOnly={!canEdit} className="input min-h-24 font-mono" aria-invalid={state?.field === "financing" || undefined} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold sm:max-w-xs">
        No keyword (the default)
        <select name="fallback" defaultValue={fallback} disabled={!canEdit} className="input">
          <option value="REFINANCING">Refinancing</option>
          <option value="FINANCING">Financing</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {/* Test keyword rules: the same fields as a GET to this page (nothing is saved). */}
        <button type="submit" formMethod="get" formAction="/admin/settings" name="open" value="classification" className="btn-secondary btn-sm" data-test-rules>Test keyword rules</button>
        {!canEdit && <span className="text-sm text-ink-2">Read only. Ask a Superadmin to turn on &ldquo;Change product classification keywords&rdquo; for your role to change them.</span>}
      </div>
      {err && <p role="alert" className="text-sm font-semibold text-bad-fg" data-classification-error>{err}</p>}
      {state?.ok && state.message && <p role="status" className="text-sm font-semibold text-ok-fg" data-classification-saved>{state.message}</p>}
    </form>
  );
}

/** Loan File: "Classification changed since accepted" and Reclassify (loans:reclassify), with remarks and, for Financing, the picks. */
export function ReclassifyForm({ loanId, pn, text, becomesFinancing, canReclassify }: { loanId: string; pn: string; text: string; becomesFinancing: boolean; canReclassify: boolean }) {
  const [state, action, pending] = useActionState(reclassifyAction, null);
  const err = state && !state.ok ? state.error : null;
  return (
    <div role="status" className="rounded-xl border border-act-line bg-act-bg px-4 py-3 text-sm" data-classification-changed>
      <p className="font-semibold">{text}</p>
      {!canReclassify ? (
        <p className="mt-1 text-ink-2">The keyword rules changed after this loan file was opened. Someone with &ldquo;Reclassify a loan&rdquo; (the LA Supervisor/Head or Admin) decides it. Nothing is blocked.</p>
      ) : state?.ok ? (
        <p className="mt-1 font-semibold text-ok-fg" data-reclassified>{state.message}</p>
      ) : (
        <form action={action} className="mt-2 flex flex-col gap-2" data-reclassify-form>
          <input type="hidden" name="loanId" value={loanId} />
          <input type="hidden" name="pn" value={pn} />
          {becomesFinancing && (
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 font-semibold">Undertaking
                <select name="financingType" className="input" required defaultValue=""><option value="" disabled>Pick one</option><option value="UNDERTAKING">Undertaking</option><option value="NON_UNDERTAKING">Non-Undertaking</option></select>
              </label>
              <label className="flex flex-col gap-1 font-semibold">OR/CR
                <select name="orcrStatus" className="input" required defaultValue=""><option value="" disabled>Pick one</option><option value="TRANSFERRED">Transferred</option><option value="UNTRANSFERRED">Untransferred</option></select>
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1 font-semibold">Note (required)
            <input name="note" className="input" minLength={5} maxLength={500} placeholder="Why it is reclassified" />
          </label>
          {err && <p role="alert" className="font-semibold text-bad-fg" data-reclassify-error>{err}</p>}
          <div><button type="submit" className="btn-gold btn-sm" disabled={pending} title={pending ? "Saving, please wait" : undefined}>Reclassify</button></div>
        </form>
      )}
    </div>
  );
}
