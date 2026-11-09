"use client";

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettingsAction } from "@/app/actions/admin";
import { SAVED_EVENT } from "./settings-modal";
import { OTHER } from "@/lib/funds/kinds";

/**
 * Cash-advance rule (Settings > Cash-advance rules, Add rule / edit). Labels above the fields:
 * Transaction and Expense kind side by side from tablet width (stacked on a phone), Purpose full width,
 * Suggested and Maximum side by side. The rule logic and amounts are unchanged; an Other rule covers
 * Other and any kind without its own rule (no description is asked here).
 */
export function CaRuleForm({ id, formId, listHref, types, kinds, value }: {
  id: string | null; formId: string; listHref: string;
  types: [string, string][]; kinds: [string, string][];
  value: { transactionTypeId: string; kind: string; purpose: string; suggestedAmount: string; maxAmount: string };
}) {
  const router = useRouter();
  const [kind, setKind] = useState(value.kind);
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveSettingsAction>>, fd: FormData) => {
    const r = await saveSettingsAction(prev, fd);
    if (r?.ok) { window.dispatchEvent(new Event(SAVED_EVENT)); if (!id) router.push(listHref, { scroll: false }); }
    return r;
  }, null);
  const uid = `caRule-${id ?? "new"}`;
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : undefined);
  const general = state && !state.ok && !["transactionTypeId", "expenseKind", "purpose", "suggestedAmount", "maxAmount"].includes(state.field ?? "") ? state.error : undefined;
  const field = (name: string, label: string, el: React.ReactNode, help?: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={name}>
      <label htmlFor={`${uid}-${name}`} className="label mb-0">{label}</label>
      {el}
      {help && !err(name) && <div className="help mt-0">{help}</div>}
      {err(name) && <p id={`${uid}-${name}-err`} className="text-sm text-bad-fg">{err(name)}</p>}
    </div>
  );
  return (
    <form id={formId} data-track-dirty data-ca-rule-form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}>
      <input type="hidden" name="kind" value="caRule" />
      {id && <input type="hidden" name="id" value={id} />}
      {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
      {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}
      <div className="grid gap-5 sm:grid-cols-2">
        {field("transactionTypeId", "Transaction", (
          <select id={`${uid}-transactionTypeId`} name="transactionTypeId" defaultValue={value.transactionTypeId} className="input" aria-invalid={!!err("transactionTypeId")}>
            {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        {field("expenseKind", "Expense kind", (
          <select id={`${uid}-expenseKind`} name="expenseKind" value={kind} onChange={(e) => setKind(e.target.value)} className="input" aria-invalid={!!err("expenseKind")}>
            {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ), kind === OTHER ? <span data-other-rule-note>Applies to Other and to any kind without its own rule.</span> : undefined)}
      </div>
      {field("purpose", "Purpose", <input id={`${uid}-purpose`} name="purpose" defaultValue={value.purpose} className="input" aria-invalid={!!err("purpose")} />)}
      <div className="grid gap-5 sm:grid-cols-2">
        {field("suggestedAmount", "Suggested (PHP, optional)", <input id={`${uid}-suggestedAmount`} name="suggestedAmount" inputMode="decimal" defaultValue={value.suggestedAmount} className="input" aria-invalid={!!err("suggestedAmount")} />)}
        {field("maxAmount", "Maximum per transaction (PHP)", <input id={`${uid}-maxAmount`} name="maxAmount" inputMode="decimal" defaultValue={value.maxAmount} className="input" aria-invalid={!!err("maxAmount")} />, "More than the maximum needs a typed reason.")}
      </div>
    </form>
  );
}
