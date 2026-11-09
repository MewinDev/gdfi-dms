"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettingsAction, setActiveAction } from "@/app/actions/admin";
import { addSuggestionAction, moveKindAction } from "@/app/actions/expense-kinds";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { Sheet } from "@/components/ui/sheet";
import { AmountModeFields } from "@/components/funds/kind-field";
import { SAVED_EVENT } from "./settings-modal";
import { amountModeText, type AmountMode } from "@/lib/funds/kinds";

export interface KindListRow {
  id: string; code: string; name: string; builtIn: boolean; active: boolean;
  amountMode: AmountMode; amountCents: number | null; rules: number; lines: number; editHref: string;
}

function MoveButtons({ id, name, first, last }: { id: string; name: string; first: boolean; last: boolean }) {
  const [state, action, pending] = useActionState(moveKindAction, null);
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="dir" value="up" disabled={first || pending} className="btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Move ${name} up`}>↑</button>
      <button type="submit" name="dir" value="down" disabled={last || pending} className="btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Move ${name} down`}>↓</button>
      {state && !state.ok && <p role="alert" className="text-xs text-bad-fg">{state.error}</p>}
    </form>
  );
}

function MakeActive({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(setActiveAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="kind" value="expenseKind" /><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value="true" />
      <button type="submit" disabled={pending} className="btn-ghost btn-sm" aria-label={`Make ${name} active`}>Make active</button>
      {state && !state.ok && <p role="alert" className="mt-1 text-xs text-bad-fg">{state.error}</p>}
    </form>
  );
}

/** Settings, Expense kinds: the list (Name, Used in, Status, Order), Other last and explained. */
export function ExpenseKindsList({ rows, canManage, addHref }: { rows: KindListRow[]; canManage: boolean; addHref?: string }) {
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => (status === "all" || (status === "active" ? r.active : !r.active)) && r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const movable = rows.filter((r) => !r.builtIn && r.active);
  return (
    <div className="flex flex-col gap-4" data-expense-kinds>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:flex-1">
          <label htmlFor="kinds-filter" className="sr-only">Find a kind</label>
          <input id="kinds-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a kind" className="input h-[46px]" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="kinds-status" className="sr-only">Show</label>
          <select id="kinds-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="input h-[46px] sm:w-40">
            <option value="active">Active</option>
            <option value="inactive">Inactive{rows.some((r) => !r.active) ? ` (${rows.filter((r) => !r.active).length})` : ""}</option>
            <option value="all">All</option>
          </select>
        </div>
        {canManage && addHref && <Link href={addHref} scroll={false} className="btn-gold shrink-0 sm:ml-auto">Add kind</Link>}
      </div>
      <p className="text-xs text-ink-2" role="status" aria-live="polite">{shown.length} of {rows.length}</p>
      <ul className="divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
        {shown.map((r) => {
          const i = movable.findIndex((m) => m.id === r.id);
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap ${r.active ? "" : "bg-fill-soft"}`} data-kind-row={r.code}>
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold ${r.active ? "text-navy" : "text-ink-2"}`}>
                  {r.name}
                  {r.builtIn && <span className="chip c-navy ml-2 h-6 text-xs">Built-in</span>}
                  {!r.active && <span className="chip c-mute ml-2 h-6 text-xs">Inactive</span>}
                </p>
                <p className="text-sm text-ink-2">
                  Used in {r.rules} rule{r.rules === 1 ? "" : "s"} and {r.lines} request line{r.lines === 1 ? "" : "s"} · {r.active ? "Active" : "Inactive"}
                </p>
                <p className="text-[13px] text-ink-2" data-kind-amount>{amountModeText(r.amountMode, r.amountCents)}</p>
                {r.builtIn && <p className="text-[13px] text-ink-2">Used when nothing else fits. The person must say what it is.</p>}
              </div>
              {canManage && !r.builtIn && r.active && <MoveButtons id={r.id} name={r.name} first={i === 0} last={i === movable.length - 1} />}
              {r.builtIn && <span className="text-[13px] text-ink-2">Always last</span>}
              {canManage && !r.active && <MakeActive id={r.id} name={r.name} />}
              {canManage && <Link href={r.editHref} scroll={false} className="btn-ghost btn-sm shrink-0" aria-label={`Edit ${r.name}`}>Edit</Link>}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">{status === "inactive" && !q ? "Nothing is inactive." : "Nothing matches."}</li>}
      </ul>
      {!canManage && <p className="help">You can see the kinds. Changing them needs &ldquo;Add and manage expense kinds&rdquo;.</p>}
    </div>
  );
}

/** "Often typed as Other": typed 3 or more times in 90 days. "Add as a kind" asks the amount and offers to relabel. */
export function OtherSuggestions({ items }: { items: { text: string; count: number }[] }) {
  const [pick, setPick] = useState<{ text: string; count: number } | null>(null);
  const [mode, setMode] = useState("TYPED");
  const [amount, setAmount] = useState("");
  const [state, action] = useActionState(async (p: Awaited<ReturnType<typeof addSuggestionAction>>, fd: FormData) => {
    const r = await addSuggestionAction(p, fd);
    if (r?.ok) setPick(null);
    return r;
  }, null);
  const uid = useId();
  if (!items.length) return null;
  return (
    <section aria-labelledby={`${uid}-t`} className="rounded-xl border border-dashed border-line bg-fill-soft p-3" data-other-suggestions>
      <h3 id={`${uid}-t`} className="text-[15px] font-semibold text-navy">Often typed as Other</h3>
      <p className="text-[13px] text-ink-2">Typed 3 or more times in the last 90 days. Make one a kind so people can pick it.</p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((s) => (
          <li key={s.text} className="flex flex-wrap items-center gap-2 text-[15px]">
            <span className="min-w-0 flex-1">{s.text} <span className="text-[13px] text-ink-2">· typed {s.count} times</span></span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setPick(s); setMode("TYPED"); setAmount(""); }} aria-label={`Add ${s.text} as a kind`}>Add as a kind</button>
          </li>
        ))}
      </ul>
      {state?.ok && <p role="status" className="mt-2 text-[13px] font-semibold text-ok-fg">{state.message}</p>}
      <Sheet open={!!pick} onClose={() => setPick(null)} title={`Add ${pick?.text ?? ""} as a kind`}>
        <form action={action} className="flex flex-col gap-3">
          <div>
            <label htmlFor={`${uid}-n`} className="label">Name</label>
            <input id={`${uid}-n`} name="name" defaultValue={pick?.text} key={pick?.text} required minLength={2} maxLength={40} className="input" />
          </div>
          <AmountModeFields idPrefix={uid} mode={mode} amount={amount} onMode={setMode} onAmount={setAmount} error={state?.field === "amount" ? state.error : undefined} />
          <label className="inline-flex min-h-11 items-start gap-3 text-[15px]">
            <input type="checkbox" name="relabel" className="mt-1 h-5 w-5 accent-[var(--navy)]" />
            <span>Also relabel the {pick?.count} old &ldquo;Other: {pick?.text}&rdquo; lines as this kind<span className="block text-[13px] text-ink-2">Optional. Their amounts do not change.</span></span>
          </label>
          {state && !state.ok && state.field !== "amount" && <FormMessage state={state} />}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPick(null)}>Cancel</button><SubmitButton className="btn-gold">Add kind</SubmitButton></div>
        </form>
      </Sheet>
    </section>
  );
}

/** Add or edit a kind (second step of the modal; the footer's Save submits it). */
export function ExpenseKindForm({ id, formId, listHref, kind, openRequests, maxRule }: {
  id: string | null; formId: string; listHref: string;
  kind: { name: string; builtIn: boolean; amountMode: AmountMode; amountCents: number | null } | null;
  /** Open requests using the kind (they keep their amounts). */
  openRequests: number;
  /** The lowest rule maximum for this kind (a fixed amount must fit it). */
  maxRule: { cents: number; text: string } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<string>(kind?.amountMode ?? "TYPED");
  const [amount, setAmount] = useState(kind?.amountCents != null ? (kind.amountCents / 100).toFixed(2) : "");
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveSettingsAction>>, fd: FormData) => {
    const r = await saveSettingsAction(prev, fd);
    if (r?.ok) { window.dispatchEvent(new Event(SAVED_EVENT)); if (!id) router.push(listHref, { scroll: false }); }
    return r;
  }, null);
  const uid = id ?? "new";
  const other = !!kind?.builtIn;
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : undefined);
  const general = state && !state.ok && !["name", "amount", "amountMode"].includes(state.field ?? "") ? state.error : undefined;
  return (
    <form id={formId} data-track-dirty className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}>
      <input type="hidden" name="kind" value="expenseKind" />
      {id && <input type="hidden" name="id" value={id} />}
      {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
      {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}
      <div>
        <label htmlFor={`xk-name-${uid}`} className="label">Name</label>
        <input id={`xk-name-${uid}`} name="name" defaultValue={kind?.name ?? ""} readOnly={other} maxLength={40} className={`input ${other ? "bg-fill" : ""}`} aria-invalid={!!err("name")} />
        <p className="help">{other ? "Built-in: used when nothing else fits. The person must say what it is. It cannot be renamed or made inactive." : "2 to 40 characters. Unique, ignoring capitals and spaces."}</p>
        {err("name") && <p className="mt-1.5 text-sm text-bad-fg">{err("name")}</p>}
      </div>
      {other ? (
        <div><p className="label">Amount</p><p className="text-[15px]">Person enters it (always, for Other).</p><input type="hidden" name="amountMode" value="TYPED" /><input type="hidden" name="amount" value="" /></div>
      ) : (
        <AmountModeFields idPrefix={`xk-${uid}`} mode={mode} amount={amount} onMode={setMode} onAmount={setAmount} error={err("amount") ?? err("amountMode")} />
      )}
      {!other && mode === "FIXED" && maxRule && <p className="help">The fixed amount must not be above {maxRule.text}.</p>}
      {!other && mode !== "TYPED" && <p className="help">A Cash-advance rule&rsquo;s Suggested amount for a transaction comes first; the rule&rsquo;s maximum still applies.</p>}
      {openRequests > 0 && <p className="text-[13px] font-semibold text-act-fg" data-open-requests>Used by {openRequests} open request{openRequests === 1 ? "" : "s"}, they keep their amount.</p>}
      <p className="help">Changing the amount affects only new lines. Old records never change.</p>
    </form>
  );
}
