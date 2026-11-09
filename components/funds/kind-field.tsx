"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "@/components/ui/sheet";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { quickAddKindAction, type QuickAddState } from "@/app/actions/expense-kinds";
import { OTHER, OTHER_MAX, kindOptions, otherDescriptionProblem, presetWas, sourceHint, type AmountSource } from "@/lib/funds/kinds";
import type { KindOption } from "@/lib/funds/kind-option";

/** "Person enters it" / "Suggested amount" / "Fixed amount": the amount choice of a kind (add and edit forms). */
export function AmountModeFields({ idPrefix, mode, amount, onMode, onAmount, error, disabled }: {
  idPrefix: string; mode: string; amount: string; onMode: (m: string) => void; onAmount: (a: string) => void; error?: string; disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" data-amount-mode>
      <legend className="label">Amount</legend>
      {[["TYPED", "Person enters it", "The amount field starts empty."], ["SUGGESTED", "Suggested amount", "Pre-filled; the person may change it."], ["FIXED", "Fixed amount", "Pre-filled and cannot be changed by the processor. Use for set fees only."]].map(([v, l, h]) => (
        <label key={v} className={`inline-flex min-h-11 items-start gap-3 text-[15px] ${disabled ? "text-ink-2" : ""}`}>
          <input type="radio" name="amountMode" value={v} checked={mode === v} disabled={disabled} onChange={() => onMode(v)} className="mt-1 h-5 w-5 accent-[var(--navy)]" />
          <span>{l}<span className="block text-[13px] text-ink-2">{h}</span></span>
        </label>
      ))}
      {mode !== "TYPED" && (
        <div className="ml-8 max-w-48">
          <label htmlFor={`${idPrefix}-amt`} className="label">Amount (PHP)</label>
          <input id={`${idPrefix}-amt`} name="amount" inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} className="input" aria-invalid={!!error} placeholder="500" />
        </div>
      )}
      {mode === "TYPED" && <input type="hidden" name="amount" value="" />}
      {error && <p className="ml-8 text-sm text-bad-fg">{error}</p>}
    </fieldset>
  );
}

/** "+ Add new kind": a small modal with the name and the amount choice. The new kind is selected at once. */
export function AddKindLink({ onAdded, where }: { onAdded: (k: KindOption) => void; where: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("TYPED");
  const [amount, setAmount] = useState("");
  const [state, action] = useActionState(quickAddKindAction, null as QuickAddState);
  const uid = useId();
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.kind && state.at !== last.current) {
      last.current = state.at;
      onAdded(state.kind);
      setOpen(false); setMode("TYPED"); setAmount("");
    }
  }, [state, onAdded]);
  return (
    <>
      <button type="button" className="link min-h-11 text-[13px]" onClick={() => setOpen(true)} data-add-kind>+ Add new kind</button>
      {/* Opened only on a click, and outside any form (the field sits inside the request's own form). */}
      {open && createPortal(<Sheet open={open} onClose={() => setOpen(false)} title="Add new kind">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="where" value={where} />
          <div>
            <label htmlFor={`${uid}-n`} className="label">Name</label>
            <input id={`${uid}-n`} name="name" required minLength={2} maxLength={40} className="input" aria-invalid={state?.field === "name"} placeholder="Courier" />
            <p className="help">2 to 40 characters. Saved as Active and selected here.</p>
          </div>
          <AmountModeFields idPrefix={uid} mode={mode} amount={amount} onMode={setMode} onAmount={setAmount} error={state?.field === "amount" ? state.error : undefined} />
          {state && !state.ok && state.field !== "amount" && <FormMessage state={state} />}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton className="btn-gold">Add</SubmitButton>
          </div>
        </form>
      </Sheet>, document.body)}
    </>
  );
}

/** The Expense kind dropdown: active kinds (and the one already on the record), Other last; "+ Add new kind" when allowed. */
export function KindSelect({ id, value, onChange, kinds, onKindsChange, canAdd, where, name = "kind", allowed, label = "Expense kind" }: {
  id: string; value: string; onChange: (code: string) => void; kinds: KindOption[]; onKindsChange?: (k: KindOption[]) => void; canAdd?: boolean; where?: string; name?: string;
  /** Limit the choice (e.g. the kinds the LA flagged). */
  allowed?: string[]; label?: string;
}) {
  const opts = kindOptions(kinds, value).filter((k) => !allowed || allowed.includes(k.code) || k.code === value);
  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <label htmlFor={id} className="label">{label}</label>
        {canAdd && onKindsChange && <AddKindLink where={where ?? "a funds screen"} onAdded={(k) => { onKindsChange([...kinds, k]); onChange(k.code); }} />}
      </div>
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input">
        {opts.map((k) => <option key={k.code} value={k.code}>{k.name}{k.active ? "" : " · Inactive"}</option>)}
      </select>
    </div>
  );
}

/** Kind Other: "What is this expense?" (3 to 60 characters, a counter, plain error). */
export function OtherDescriptionField({ id, value, onChange, name = "otherDescription", serverError }: { id: string; value: string; onChange: (v: string) => void; name?: string; serverError?: string }) {
  const [touched, setTouched] = useState(false);
  const why = otherDescriptionProblem(value);
  const show = (touched || value.length > 0) && why ? why : serverError;
  return (
    <div data-other-description>
      <label htmlFor={id} className="label">What is this expense?</label>
      <input id={id} name={name} value={value} maxLength={OTHER_MAX} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)} required className="input"
        aria-invalid={!!show} aria-describedby={`${id}-h`} />
      <p id={`${id}-h`} className="help flex justify-between gap-2"><span>For example: courier, photocopy, parking.</span><span aria-live="polite">{value.trim().length}/{OTHER_MAX}</span></p>
      {show && <p className="text-sm text-bad-fg">{show}</p>}
    </div>
  );
}

/** The amount, read-only when the kind's amount is fixed, with grey lines saying where it came from. */
export function AmountInput({ id, value, onChange, locked, source, startCents, name = "amount", label = "Amount (PHP)", overrideNote, invalid }: {
  id: string; value: string; onChange: (v: string) => void; locked: boolean; source: AmountSource | null; startCents: number | null; name?: string; label?: string;
  /** Shown when a person who may manage kinds can change a fixed amount for this request. */
  overrideNote?: string; invalid?: boolean;
}) {
  const c = toCentsLoose(value);
  const was = startCents !== null && c !== null ? presetWas(startCents, c) : "";
  return (
    <div data-amount-field>
      <label htmlFor={id} className="label">{label}</label>
      {locked ? (
        <>
          <input type="hidden" name={name} value={value} />
          <p id={id} className="input flex items-center bg-fill" data-locked-amount aria-readonly="true">{value}</p>
        </>
      ) : (
        <input id={id} name={name} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="input" aria-invalid={invalid} />
      )}
      {source && <p className="text-[12px] text-ink-2" data-amount-source>{sourceHint(source, locked)}</p>}
      {was && <p className="text-[12px] text-ink-2" data-preset-was>{was}</p>}
      {overrideNote && <p className="text-[12px] text-ink-2">{overrideNote}</p>}
    </div>
  );
}

export function toCentsLoose(t: string): number | null {
  const s = (t ?? "").replace(/[,\s₱]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
export const centsText = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
export { OTHER };
