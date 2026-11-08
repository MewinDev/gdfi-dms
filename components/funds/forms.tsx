"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { Sheet } from "@/components/ui/sheet";
import {
  addReceiptAction, closeAdvanceAction, confirmReturnAction, decideAdvanceAction, decideCarryOverAction, decideTopUpAction, grantExceptionAction,
  recordReturnAction, releaseAdvanceAction, releaseTopUpAction, requestAdvanceAction, requestTopUpAction,
} from "@/app/actions/jobs";
import type { ActionState } from "@/lib/action";

const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toC = (t: string) => {
  const s = (t ?? "").replace(/[,\s₱]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
};
const Hidden = ({ v }: { v: Record<string, string> }) => <>{Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>;
function useCloseOnOk(state: ActionState, close: () => void) {
  useEffect(() => { if (state?.ok) close(); }, [state, close]);
}

// ---------------------------------------------------------------------------
// Request (DP)
// ---------------------------------------------------------------------------

export interface RequestJob {
  transactionId: string; loanPn: string; borrower: string; typeName: string;
  lto?: { id: string; name: string; estimate: string | null } | null;
  kinds: { kind: string; label: string; suggestedCents: number | null; maxCents: number | null; suggestedFrom?: "office" | "rule" | null }[];
}

export function RequestForm({ jobs, blocked }: { jobs: RequestJob[]; blocked?: string }) {
  const init = () => Object.fromEntries(jobs.flatMap((j) => j.kinds.map((k) => [`${j.transactionId}|${k.kind}`, { on: true, amount: k.suggestedCents ? (k.suggestedCents / 100).toFixed(2) : "", reason: "" }])));
  const [lines, setLines] = useState<Record<string, { on: boolean; amount: string; reason: string }>>(init);
  const [others, setOthers] = useState<{ kind: "TRANSPORT" | "OTHER"; amount: string; note: string }[]>([]);
  // A sent request clears the form (the jobs move to My advances).
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await requestAdvanceAction(p, fd);
    if (r?.ok) { setLines(init()); setOthers([]); }
    return r;
  }, null);
  const uid = useId();
  const set = (key: string, patch: Partial<{ on: boolean; amount: string; reason: string }>) => setLines((x) => ({ ...x, [key]: { ...x[key], ...patch } }));
  const chosen = jobs.flatMap((j) => j.kinds.map((k) => ({ j, k, key: `${j.transactionId}|${k.kind}` }))).filter(({ key }) => lines[key]?.on);
  const total = chosen.reduce((s, { key }) => s + (toC(lines[key].amount) ?? 0), 0) + others.reduce((s, o) => s + (toC(o.amount) ?? 0), 0);
  const payload = JSON.stringify({
    lines: chosen.map(({ j, k, key }) => ({ transactionId: j.transactionId, kind: k.kind, cents: toC(lines[key].amount) ?? 0, overMaxReason: lines[key].reason })),
    others: others.map((o) => ({ kind: o.kind, cents: toC(o.amount) ?? 0, note: o.note })),
  });

  return (
    <form action={action} className="flex flex-col gap-4">
      <Hidden v={{ json: payload }} />
      {blocked && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-[15px] text-bad-fg">{blocked}</p>}
      {jobs.length === 0 ? (
        <p className="text-[15px] text-ink-2">No accepted jobs need funds right now. Jobs appear here after you accept them, when the Loan Associate flagged them as needing funds.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.transactionId} className="rounded-xl border border-line p-3">
              <p className="text-[15px] font-semibold">{j.borrower} · {j.loanPn} · {j.typeName}</p>
              {j.lto && <p className="text-[13px] text-ink-2" data-lto-line>At {j.lto.name} · {j.lto.estimate ?? "No estimate yet"}</p>}
              <div className="mt-2 flex flex-col gap-2">
                {j.kinds.map((k) => {
                  const key = `${j.transactionId}|${k.kind}`;
                  const v = lines[key];
                  const c = toC(v.amount);
                  const over = !!(k.maxCents && c && c > k.maxCents);
                  return (
                    <div key={key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start">
                      <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                        <input type="checkbox" checked={v.on} onChange={(e) => set(key, { on: e.target.checked })} className="h-5 w-5 accent-[var(--navy)]" />
                        {k.label}
                        <span className="text-[13px] text-ink-2">{k.suggestedCents ? `suggested ${peso(k.suggestedCents)}${k.suggestedFrom === "office" ? " (from the LTO office)" : ""}` : "no suggested amount"}{k.maxCents ? ` · max ${peso(k.maxCents)}` : ""}</span>
                      </label>
                      <div>
                        <label htmlFor={`${uid}-${key}`} className="sr-only">{k.label} amount (PHP)</label>
                        <input id={`${uid}-${key}`} inputMode="decimal" disabled={!v.on} value={v.amount} onChange={(e) => set(key, { amount: e.target.value })} placeholder="0.00" className="input" aria-invalid={v.on && c === null} />
                      </div>
                      {v.on && over && (
                        <div className="sm:col-span-2">
                          <label htmlFor={`${uid}-${key}-r`} className="label">Above the maximum. Why?</label>
                          <input id={`${uid}-${key}-r`} value={v.reason} onChange={(e) => set(key, { reason: e.target.value })} required minLength={3} maxLength={300} className="input" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[15px] font-semibold">Other expenses (not for one job)</legend>
        {others.map((o, i) => (
          <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label htmlFor={`${uid}-ok-${i}`} className="label">Kind</label>
              <select id={`${uid}-ok-${i}`} value={o.kind} onChange={(e) => setOthers((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value as "TRANSPORT" | "OTHER" } : y)))} className="input">
                <option value="TRANSPORT">Transport</option><option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-oa-${i}`} className="label">Amount (PHP)</label>
              <input id={`${uid}-oa-${i}`} inputMode="decimal" value={o.amount} onChange={(e) => setOthers((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className="input" required />
            </div>
            <div>
              <label htmlFor={`${uid}-on-${i}`} className="label">What for</label>
              <input id={`${uid}-on-${i}`} value={o.note} onChange={(e) => setOthers((x) => x.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} className="input" required minLength={3} />
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOthers((x) => x.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setOthers((x) => [...x, { kind: "TRANSPORT", amount: "", note: "" }])}>Add an expense</button>
      </fieldset>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[17px] font-bold text-navy">Total {peso(total)}</p>
        <SubmitButton disabled={!!blocked || total <= 0}>Send to Finance</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// DP: top-up, receipt, return
// ---------------------------------------------------------------------------

export function TopUpButton({ lineId, label }: { lineId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(requestTopUpAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Ask for more</button>
      <Sheet open={open} onClose={close} title={`Ask for more: ${label}`}>
        <form action={action} className="flex flex-col gap-3">
          <Hidden v={{ lineId }} />
          <div><label htmlFor={`${uid}-e`} className="label">Extra amount (PHP)</label><input id={`${uid}-e`} name="extra" inputMode="decimal" required className="input" /></div>
          <div><label htmlFor={`${uid}-r`} className="label">Why is more needed?</label><input id={`${uid}-r`} name="reason" required minLength={3} maxLength={300} className="input" /></div>
          <p className="help">The approver sees only the extra amount.</p>
          <FormMessage state={state} />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>Cancel</button><SubmitButton>Send</SubmitButton></div>
        </form>
      </Sheet>
    </>
  );
}

export function ReceiptForm({ lines, today }: { lines: { id: string; label: string; balanceCents: number }[]; today: string }) {
  const [state, action] = useActionState(addReceiptAction, null);
  const uid = useId();
  // The form resets after each saved receipt (React resets uncontrolled forms after an action).
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_9rem_9rem_minmax(0,1fr)]">
      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor={`${uid}-l`} className="label">For</label>
        <select id={`${uid}-l`} name="lineId" required className="input">
          {lines.map((l) => <option key={l.id} value={l.id}>{l.label} · left {peso(l.balanceCents)}</option>)}
        </select>
      </div>
      <div><label htmlFor={`${uid}-d`} className="label">Receipt date</label><input id={`${uid}-d`} type="date" name="date" max={today} defaultValue={today} required className="input" /></div>
      <div><label htmlFor={`${uid}-a`} className="label">Amount (PHP)</label><input id={`${uid}-a`} name="amount" inputMode="decimal" required className="input" aria-invalid={state?.field === "amount"} /></div>
      <div><label htmlFor={`${uid}-n`} className="label">Receipt / OR no.</label><input id={`${uid}-n`} name="number" required maxLength={60} className="input" /></div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label htmlFor={`${uid}-f`} className="label">Photo or PDF (up to 5 MB)</label>
        <input id={`${uid}-f`} type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input py-2" aria-invalid={state?.field === "file"} />
      </div>
      <div className="flex items-end"><SubmitButton>Add receipt</SubmitButton></div>
      <div className="sm:col-span-2 lg:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function ReturnCashForm({ advanceId, balanceCents, today }: { advanceId: string; balanceCents: number; today: string }) {
  const [state, action] = useActionState(recordReturnAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Hidden v={{ advanceId }} />
      <div><label htmlFor={`${uid}-a`} className="label">Cash returned (PHP)</label><input id={`${uid}-a`} name="amount" inputMode="decimal" defaultValue={(balanceCents / 100).toFixed(2)} required className="input" /></div>
      <div><label htmlFor={`${uid}-d`} className="label">Date</label><input id={`${uid}-d`} type="date" name="date" max={today} defaultValue={today} required className="input" /></div>
      <SubmitButton className="btn-secondary">Record return</SubmitButton>
      {state && <FormMessage state={state} />}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export function DecideAdvanceForm({ advanceId, lines }: { advanceId: string; lines: { id: string; label: string; requestedCents: number; overMaxReason: string }[] }) {
  const [state, action] = useActionState(decideAdvanceAction, null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, (l.requestedCents / 100).toFixed(2)])));
  const uid = useId();
  const requested = lines.reduce((s, l) => s + l.requestedCents, 0);
  const approved = lines.reduce((s, l) => s + (toC(amounts[l.id]) ?? 0), 0);
  const lower = approved < requested;
  return (
    <form action={action} className="flex flex-col gap-2">
      <Hidden v={{ advanceId }} />
      {lines.map((l) => (
        <div key={l.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
          <label htmlFor={`${uid}-${l.id}`} className="text-[15px]">
            {l.label} <span className="text-[13px] text-ink-2">· asked {peso(l.requestedCents)}</span>
            {l.overMaxReason && <span className="block text-[13px] text-act-fg">Above the maximum: {l.overMaxReason}</span>}
          </label>
          <input type="hidden" name="lineId" value={l.id} />
          <input id={`${uid}-${l.id}`} name={`amount-${l.id}`} inputMode="decimal" value={amounts[l.id]} onChange={(e) => setAmounts((x) => ({ ...x, [l.id]: e.target.value }))} className="input" />
        </div>
      ))}
      <div>
        <label htmlFor={`${uid}-n`} className="label">Note {lower ? "(needed when approving less)" : "(needed to deny)"}</label>
        <input id={`${uid}-n`} name="note" maxLength={500} className="input" aria-invalid={state?.field === "note"} />
      </div>
      <p className="text-[15px] font-semibold">Approve {peso(approved)} of {peso(requested)}</p>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approve">Approve</SubmitButton>
        <SubmitButton name="decision" value="deny" className="btn-ghost">Deny</SubmitButton>
      </div>
    </form>
  );
}

export function ReleaseForm({ advanceId }: { advanceId: string }) {
  const [state, action] = useActionState(releaseAdvanceAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Hidden v={{ advanceId }} />
      <div className="min-w-0 flex-1"><label htmlFor={`${uid}-r`} className="label">Reference (voucher or transfer no.)</label><input id={`${uid}-r`} name="ref" required minLength={2} maxLength={80} className="input" /></div>
      <SubmitButton>Release</SubmitButton>
      {state && <div className="sm:basis-full"><FormMessage state={state} /></div>}
    </form>
  );
}

export function SmallAction({ kind, id, label, cls = "btn-ghost btn-sm", extra }: { kind: "topup-approve" | "topup-deny" | "topup-release" | "carry-approve" | "carry-deny" | "confirm-return" | "close"; id: string; label: string; cls?: string; extra?: boolean }) {
  const act = {
    "topup-approve": decideTopUpAction, "topup-deny": decideTopUpAction, "topup-release": releaseTopUpAction,
    "carry-approve": decideCarryOverAction, "carry-deny": decideCarryOverAction, "confirm-return": confirmReturnAction, close: closeAdvanceAction,
  }[kind];
  const [state, action] = useActionState(act, null);
  const field = kind.startsWith("topup") ? "topUpId" : kind.startsWith("carry") ? "carryId" : kind === "confirm-return" ? "returnId" : "advanceId";
  const decision = kind.endsWith("approve") ? "approve" : kind.endsWith("deny") ? "deny" : "";
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <Hidden v={{ [field]: id, decision }} />
      {extra && <input name="note" placeholder="Note" aria-label="Note" className="input h-9 w-40" />}
      <SubmitButton className={cls}>{label}</SubmitButton>
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

export function GrantExceptionForm({ dpUserId, name }: { dpUserId: string; name: string }) {
  const [state, action] = useActionState(grantExceptionAction, null);
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <Hidden v={{ dpUserId }} />
      <input name="note" placeholder="Why (optional)" aria-label={`Why let ${name} request once more`} className="input h-9 w-48" />
      <SubmitButton className="btn-ghost btn-sm">Allow one more request</SubmitButton>
      {state && <FormMessage state={state} />}
    </form>
  );
}
