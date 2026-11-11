"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { openLoanFileAction } from "@/app/actions/loan";
import { CheckIcon } from "@/components/ui/icons";
import { plainMessage } from "@/lib/ui/plain";

const PICK_ONE = "Please pick one to continue.";
const focusGroup = (g: HTMLDivElement | null) => g?.querySelector<HTMLInputElement>("input:checked, input")?.focus();

/**
 * Open loan file. For Financing the LA must answer two questions first; the button stays
 * disabled until both are picked (the server checks the same thing again). A per-question message
 * shows only after they try to open with a question still empty.
 */
export function OpenLoanForm({ pn, financing, canOpen }: { pn: string; financing: boolean; canOpen: boolean }) {
  const [state, action, pending] = useActionState(openLoanFileAction, null);
  const [ft, setFt] = useState<string | null>(null);
  const [orcr, setOrcr] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const ftRef = useRef<HTMLDivElement>(null);
  const orcrRef = useRef<HTMLDivElement>(null);
  const answered = !financing || (ft !== null && orcr !== null);
  const ready = canOpen && answered;

  /** The first question still empty, so focus can go there. */
  const firstEmpty = () => (ft === null ? ftRef.current : orcr === null ? orcrRef.current : null);

  // After a loan is found, focus goes to the first question (once, on arrival).
  useEffect(() => {
    if (financing && canOpen) focusGroup(ftRef.current);
  }, [financing, canOpen]);

  const message = (field: "financingType" | "orcrStatus", value: string | null) =>
    value !== null ? undefined : state?.field === field ? plainMessage(state.error) : tried ? PICK_ONE : undefined;

  return (
    <form
      action={action}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        if (ready && !pending) return;
        // The button looks and reads disabled; pressing it shows what is missing instead of sending.
        e.preventDefault();
        if (canOpen && !answered) { setTried(true); focusGroup(firstEmpty()); }
      }}
    >
      <input type="hidden" name="pn" value={pn} />
      {financing && (
        <div className="grid grid-cols-12 gap-x-6 gap-y-4" data-open-questions>
          <Segmented
            groupRef={ftRef}
            legend="Is it an Undertaking?"
            name="financingType"
            value={ft}
            onChange={setFt}
            options={[["UNDERTAKING", "Undertaking"], ["NON_UNDERTAKING", "Non-Undertaking"]]}
            error={message("financingType", ft)}
          />
          <Segmented
            groupRef={orcrRef}
            legend="Is the OR/CR transferred?"
            name="orcrStatus"
            value={orcr}
            onChange={setOrcr}
            options={[["TRANSFERRED", "Transferred"], ["UNTRANSFERRED", "Untransferred"]]}
            error={message("orcrStatus", orcr)}
          />
        </div>
      )}
      {state && !state.ok && !state.field?.match(/financingType|orcrStatus/) && (
        <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-[15px] text-bad-fg">{plainMessage(state.error)}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4" data-open-row>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            aria-disabled={!ready || pending}
            aria-describedby={canOpen && !answered ? "open-hint" : undefined}
            aria-busy={pending}
            className="btn-gold h-11 min-h-11 px-5"
            data-open-loan
          >
            {pending ? "Opening..." : "Open loan file"}
          </button>
          <Link href="/loans" className="inline-flex h-11 items-center rounded-xl px-4 text-[15px] font-semibold text-navy no-underline hover:bg-fill">Cancel</Link>
        </div>
        {canOpen && !answered && <span id="open-hint" className="text-[13px] text-ink-2 sm:ml-auto" data-open-hint>Pick both answers to continue</span>}
        {!canOpen && <span className="text-[13px] text-ink-2 sm:ml-auto">Your role does not allow opening loan files.</span>}
      </div>
    </form>
  );
}

/**
 * Two equal halves in one rounded group, as tall as the buttons (44px). Selected: navy with a check.
 * Keyboard focus: a separate 2px gold ring, so focus never looks like a choice. A radio group, so the arrow keys move inside it. */
function Segmented({
  legend, name, value, onChange, options, error, groupRef,
}: { legend: string; name: string; value: string | null; onChange: (v: string) => void; options: [string, string][]; error?: string; groupRef: React.Ref<HTMLDivElement> }) {
  const errId = `${name}-error`;
  return (
    <fieldset className="col-span-12 min-w-0 md:col-span-6" aria-describedby={error ? errId : undefined} data-question={name}>
      <legend className="mb-2 text-sm font-semibold text-navy">{legend}</legend>
      <div ref={groupRef} className={`grid h-11 grid-cols-2 gap-0.5 rounded-xl border p-0.5 ${error ? "border-act-line bg-act-bg" : "border-line-strong bg-white"}`} data-pills>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <label key={v}
              className={`flex min-w-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-1.5 text-center text-[14px] font-semibold transition-colors sm:px-2 sm:text-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold ${on ? "bg-navy text-white" : "text-navy hover:bg-fill"}`}>
              <input type="radio" name={name} value={v} checked={on} onChange={() => onChange(v)} required className="sr-only" />
              {on && <CheckIcon size={15} strokeWidth={2.6} />}
              {l}
            </label>
          );
        })}
      </div>
      {error && <p id={errId} role="alert" className="mt-1.5 text-sm font-semibold text-act-fg">{error}</p>}
    </fieldset>
  );
}
