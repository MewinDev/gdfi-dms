"use client";

import { useActionState, useState } from "react";
import { saveClassificationAction, reclassifyAction } from "@/app/actions/classification";

type Keyword = { text: string; wholeWord: boolean };

/** One keyword list: a row per keyword with its "Whole word only" tickbox; sent as JSON in a hidden field. */
function KeywordList({ name, label, initial, canEdit, invalid }: { name: string; label: string; initial: Keyword[]; canEdit: boolean; invalid: boolean }) {
  const [rows, setRows] = useState<Keyword[]>(initial.length ? initial : [{ text: "", wholeWord: false }]);
  const set = (i: number, k: Partial<Keyword>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...k } : x)));
  return (
    <fieldset className="flex flex-col gap-2" data-keyword-list={name} aria-invalid={invalid || undefined}>
      <legend className="text-sm font-semibold">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(rows.filter((r) => r.text.trim()))} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" data-keyword-row>
          <input aria-label={`${label}: keyword ${i + 1}`} value={r.text} onChange={(e) => set(i, { text: e.target.value })} readOnly={!canEdit} className="input h-9 w-40 font-mono" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={r.wholeWord} onChange={(e) => set(i, { wholeWord: e.target.checked })} disabled={!canEdit} title={canEdit ? undefined : "Read only: needs the 'Change product classification keywords' tick"} />
            Whole word only
          </label>
          {canEdit && rows.length > 1 && <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={`Remove keyword ${r.text || i + 1}`}>Remove</button>}
        </div>
      ))}
      {canEdit && <div><button type="button" className="btn-ghost btn-sm" onClick={() => setRows((x) => [...x, { text: "", wholeWord: false }])}>Add keyword</button></div>}
    </fieldset>
  );
}

/**
 * Settings, Product classification (D-031, D-034): the two keyword lists (each keyword starts a word, or with
 * "Whole word only" must be a whole word) and the default. Test keyword rules is a GET of the same fields.
 */
export function ClassificationForm({ refinancing, financing, fallback, canEdit, formId }: { refinancing: Keyword[]; financing: Keyword[]; fallback: "FINANCING" | "REFINANCING"; canEdit: boolean; formId: string }) {
  const [state, action] = useActionState(saveClassificationAction, null);
  const err = state && !state.ok ? state.error : null;
  return (
    <form id={formId} action={action} className="flex flex-col gap-4" data-classification-form>
      <p className="text-sm text-ink-2">
        Order of checks on the product name (capital letters and extra spaces do not matter): 1. a Refinancing keyword → Refinancing; 2. else a Financing keyword → Financing; 3. else the default, labelled &ldquo;Classified by default&rdquo;. A keyword matches at the start of a word (&ldquo;financ&rdquo; matches &ldquo;Pre-Financing&rdquo;); with &ldquo;Whole word only&rdquo; it must be the whole word (&ldquo;refi&rdquo; matches &ldquo;REFI Loan&rdquo;, not &ldquo;Refinery&rdquo;). Hyphens inside a word are ignored (&ldquo;Re-Financing&rdquo; = refinancing).
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <KeywordList name="refinancing" label="Refinancing keywords" initial={refinancing} canEdit={canEdit} invalid={state?.field === "refinancing"} />
        <KeywordList name="financing" label="Financing keywords" initial={financing} canEdit={canEdit} invalid={state?.field === "financing"} />
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
