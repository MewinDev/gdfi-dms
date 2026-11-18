"use client";

import { useActionState, useId, useState } from "react";
import { FormMessage } from "@/components/form-status";
import { refreshProductsAction, setProductClassificationAction } from "@/app/actions/classification";

/**
 * Settings, Product classification (D-049): every active myloans product, what it is now and (while testing keyword
 * rules) what it would become; its history (each change with who, when and why); and, with "Manage product
 * classification", Set to Financing or Refinancing (overrides the keywords) or Use the keywords, with a reason.
 */
export interface ProductView {
  id: string; code: string; name: string; manual: "FINANCING" | "REFINANCING" | null; note: string; by: string; atText: string | null;
  beforeText: string; afterText: string; changes: boolean;
  history: { atText: string; by: string; text: string }[];
}

export function ProductClassificationList({ rows, moving, testing, canEdit }: { rows: ProductView[]; moving: { from: string; to: string; n: number }[]; testing: boolean; canEdit: boolean }) {
  const [refreshState, refresh, refreshing] = useActionState(refreshProductsAction, null);
  const [state, action, pending] = useActionState(setProductClassificationAction, null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const id = useId();
  const shown = rows.filter((r) => !q.trim() || `${r.name} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section aria-labelledby={`${id}-h`} className="mt-5 flex flex-col gap-2" data-products>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-h`} className="text-[15px] font-bold text-navy">{testing ? `Test keyword rules: ${rows.length} active products, before and after (not saved)` : `Products from myloans (${rows.length} active)`}</h3>
        {canEdit && <form action={refresh}><button type="submit" className="btn-ghost btn-sm" disabled={refreshing}>{refreshing ? "Reading..." : "Read the list from myloans"}</button></form>}
      </div>
      {testing && (
        <p className="text-sm" data-products-moving>
          {moving.length === 0 ? "No product changes classification." : moving.map((m) => `${m.n} product${m.n === 1 ? "" : "s"} move from ${m.from} to ${m.to}`).join("; ") + "."}
        </p>
      )}
      <FormMessage state={refreshState} />
      <FormMessage state={state} />
      {rows.length > 8 && (
        <div className="max-w-sm">
          <label htmlFor={`${id}-q`} className="label">Find a product</label>
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} className="input" placeholder="Name or code" />
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-ink-2">No product list yet. {canEdit ? "Read the list from myloans." : ""}</p> : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line text-sm">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 px-3 py-2" data-product={r.name} data-changes={r.changes ? "true" : undefined}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1"><span className="font-semibold">{r.name}</span> <span className="text-ink-2">· {r.code}</span></span>
                {r.manual && <span className="chip c-wait h-6 text-xs" title={`${r.by}, ${r.atText}: ${r.note}`} data-set-by-hand>Set by hand</span>}
                {testing && r.changes
                  ? <span data-product-result><span className="text-ink-2 line-through">{r.beforeText}</span> → <strong>{r.afterText}</strong></span>
                  : <span data-product-result>{r.beforeText}</span>}
                {canEdit && <button type="button" className="link inline-flex min-h-11 items-center text-[13px]" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>Set</button>}
              </div>
              {r.manual && <p className="text-[13px] text-ink-2">Set by {r.by}{r.atText ? `, ${r.atText}` : ""}: {r.note}</p>}
              {r.history.length > 0 && (
                <details className="text-[13px] text-ink-2" data-product-history>
                  <summary className="cursor-pointer">History ({r.history.length})</summary>
                  <ul className="mt-1 flex flex-col gap-0.5">{r.history.map((h, i) => <li key={i}>{h.atText} · {h.by}: {h.text}</li>)}</ul>
                </details>
              )}
              {canEdit && open === r.id && (
                <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3" data-set-form>
                  <input type="hidden" name="productId" value={r.id} />
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-${r.id}-v`} className="label">Classification</label>
                    <select id={`${id}-${r.id}-v`} name="value" defaultValue={r.manual ?? ""} className="input">
                      <option value="FINANCING">Financing</option>
                      <option value="REFINANCING">Refinancing</option>
                      <option value="">Use the keywords</option>
                    </select>
                  </div>
                  <div className="flex min-w-56 flex-1 flex-col gap-1">
                    <label htmlFor={`${id}-${r.id}-r`} className="label">Reason</label>
                    <input id={`${id}-${r.id}-r`} name="reason" required minLength={5} maxLength={300} className="input" placeholder="For example: confirmed with Credit, 18 Nov" />
                  </div>
                  <button type="submit" className="btn-navy btn-sm" disabled={pending}>Save</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(null)}>Cancel</button>
                  <p className="basis-full text-[13px] text-ink-2">A setting here overrides the keywords for this product, also after myloans renames it. Open loan files that change are flagged &ldquo;Classification changed since accepted&rdquo;.</p>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
