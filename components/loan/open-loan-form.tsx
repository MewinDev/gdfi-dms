"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { openLoanFileAction } from "@/app/actions/loan";
import { CheckIcon } from "@/components/ui/icons";
import { plainMessage } from "@/lib/ui/plain";

/**
 * Open loan file. For Financing the LA must answer two questions first; the button stays
 * disabled until both are picked (the server checks the same thing again).
 */
export function OpenLoanForm({ pn, financing, canOpen }: { pn: string; financing: boolean; canOpen: boolean }) {
  const [state, action, pending] = useActionState(openLoanFileAction, null);
  const [ft, setFt] = useState<string | null>(null);
  const [orcr, setOrcr] = useState<string | null>(null);
  const ready = canOpen && (!financing || (ft !== null && orcr !== null));

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="pn" value={pn} />
      {financing && (
        <div>
          <h3 className="text-lg font-bold text-navy">Tell us two things</h3>
          <p className="text-[15px] text-ink-2">This is a Financing loan, so we need your answer on both.</p>
          <Segmented
            legend="1. Is it an Undertaking?"
            name="financingType"
            value={ft}
            onChange={setFt}
            options={[["UNDERTAKING", "Undertaking"], ["NON_UNDERTAKING", "Non-Undertaking"]]}
            error={state?.field === "financingType" ? plainMessage(state.error) : undefined}
          />
          <Segmented
            legend="2. Is the OR/CR transferred?"
            name="orcrStatus"
            value={orcr}
            onChange={setOrcr}
            options={[["TRANSFERRED", "Transferred"], ["UNTRANSFERRED", "Untransferred"]]}
            error={state?.field === "orcrStatus" ? plainMessage(state.error) : undefined}
          />
        </div>
      )}
      {state && !state.ok && !state.field?.match(/financingType|orcrStatus/) && (
        <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-[15px] text-bad-fg">{plainMessage(state.error)}</p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" disabled={!ready || pending} aria-busy={pending} className="btn-gold btn-lg w-full sm:w-auto">
          {pending ? "Opening..." : "Open loan file"}
        </button>
        <Link href="/loans" className="btn-ghost btn-lg w-full sm:w-auto">Cancel</Link>
        {!canOpen && <span className="text-sm text-ink-2">Your role does not allow opening loan files.</span>}
      </div>
    </form>
  );
}

function Segmented({
  legend, name, value, onChange, options, error,
}: { legend: string; name: string; value: string | null; onChange: (v: string) => void; options: [string, string][]; error?: string }) {
  return (
    <fieldset className="mt-5">
      <legend className="mb-2.5 text-[15px] font-semibold">{legend}</legend>
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <label key={v}
              className={`flex min-h-[54px] cursor-pointer items-center justify-center gap-2.5 rounded-xl border-[1.5px] px-[18px] text-[15px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.22)] bg-white text-navy hover:bg-fill"}`}>
              <input type="radio" name={name} value={v} checked={on} onChange={() => onChange(v)} required className="sr-only" />
              {on && <CheckIcon size={20} strokeWidth={2.6} />}
              {l}
            </label>
          );
        })}
      </div>
      {value === null && <p className="mt-2 text-[15px] text-act-fg">{error ?? "Please pick one to continue."}</p>}
    </fieldset>
  );
}
