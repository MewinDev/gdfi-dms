"use client";

import { useActionState, useId, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { saveAdvanceLineAction } from "@/app/actions/expense-kinds";
import { OTHER, otherDescriptionProblem, startingAmount } from "@/lib/funds/kinds";
import type { KindOption } from "@/lib/funds/kind-option";
import { AmountInput, KindSelect, OtherDescriptionField, centsText, toCentsLoose } from "./kind-field";

const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface LineEditData {
  id: string; kind: string; otherDescription: string; requestedCents: number; overMaxReason: string;
}

/**
 * Finance or an approver: change a line of a request (or add one) before it is decided. Rules of the
 * line's transaction type by kind code (an OTHER rule covers kinds without their own rule).
 */
export function LineEditButton({ advanceId, line, kinds: kinds0, rules, canAddKind, canOverrideFixed, label }: {
  advanceId: string; line?: LineEditData; kinds: KindOption[]; rules: Record<string, { suggestedCents: number | null; maxCents: number | null }>;
  canAddKind: boolean; canOverrideFixed: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState(kinds0);
  const [kind, setKind] = useState(line?.kind ?? (kinds0.find((k) => k.code === "TRANSPORT") ? "TRANSPORT" : kinds0[0]?.code ?? OTHER));
  const [desc, setDesc] = useState(line?.otherDescription ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(line?.overMaxReason ?? "");
  const ruleOf = (code: string) => rules[code] ?? (code === OTHER ? undefined : rules[OTHER]);
  const startOf = (code: string) => {
    const k = kinds.find((x) => x.code === code);
    return startingAmount({ ruleSuggestedCents: ruleOf(code)?.suggestedCents ?? null, kind: k ? { code: k.code, amountMode: k.amountMode, amountCents: k.amountCents } : null });
  };
  const [amount, setAmount] = useState(line ? centsText(line.requestedCents) : centsText(startOf(kind).cents));
  const [state, action] = useActionState(async (p: Awaited<ReturnType<typeof saveAdvanceLineAction>>, fd: FormData) => {
    const r = await saveAdvanceLineAction(p, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, null);
  const uid = useId();
  const start = startOf(kind);
  const max = ruleOf(kind)?.maxCents ?? null;
  const c = toCentsLoose(amount);
  const over = !!(max && c && c > max);
  const locked = start.locked && !canOverrideFixed;
  const why = kind === OTHER ? otherDescriptionProblem(desc) : !line && note.trim().length < 3 ? "Say what the expense is for." : c === null || c <= 0 ? "Enter the amount." : over && reason.trim().length < 3 ? `Above the maximum of ${peso(max!)}. Type a reason.` : null;
  const pick = (code: string) => { setKind(code); const st = startOf(code); if (st.cents !== null) setAmount(centsText(st.cents)); };
  const title = line ? "Change this line" : "Add a line";
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)} data-line-edit={line?.id ?? "new"}>{label ?? (line ? "Change" : "Add a line")}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="advanceId" value={advanceId} />
          {line && <input type="hidden" name="lineId" value={line.id} />}
          <KindSelect id={`${uid}-k`} value={kind} onChange={pick} kinds={kinds} onKindsChange={setKinds} canAdd={canAddKind} where="Funds, To approve" />
          {kind === OTHER && <OtherDescriptionField id={`${uid}-d`} value={desc} onChange={setDesc} serverError={state?.field === "otherDescription" ? state.error : undefined} />}
          {!line && kind !== OTHER && (
            <div><label htmlFor={`${uid}-n`} className="label">What for</label><input id={`${uid}-n`} name="note" value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={300} className="input" /></div>
          )}
          <AmountInput id={`${uid}-a`} value={amount} onChange={setAmount} locked={locked} source={start.source} startCents={start.cents}
            overrideNote={start.locked && canOverrideFixed ? "Fixed for this kind. You may change it for this request only; the history will say so." : undefined} invalid={state?.field === "cents"} />
          {max !== null && <p className="text-[12px] text-ink-2">Maximum {peso(max)} (Cash-advance rule).</p>}
          {over && (
            <div><label htmlFor={`${uid}-r`} className="label">Above the maximum. Why?</label><input id={`${uid}-r`} name="overMaxReason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} className="input" /></div>
          )}
          {why && <p className="text-[13px] font-semibold text-act-fg" data-save-why>{why}</p>}
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton className="btn-gold" disabled={!!why}>Save</SubmitButton>
          </div>
        </form>
      </Sheet>
    </>
  );
}
