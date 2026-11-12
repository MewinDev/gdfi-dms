"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { openLoanFileAction } from "@/app/actions/loan";
import { CheckIcon } from "@/components/ui/icons";
import { plainMessage, txnName } from "@/lib/ui/plain";
import { evaluateLoanRules, ruleWording, TRANSACTION_LABEL, type LoanTypeValue, type RuleOutcome } from "@/lib/rules";

const PICK_ONE = "Please pick one to continue.";
const focusGroup = (g: HTMLDivElement | null, preventScroll = false) =>
  g?.querySelector<HTMLInputElement>("input:checked, input")?.focus({ preventScroll });

/** What the rules need to say what will be set up (the same pure rules the server runs on Open). */
export interface RuleFacts {
  productName: string | null;
  loanType: LoanTypeValue;
  amount: number;
}

/**
 * Open loan file. For Financing the LA must answer two questions first; the button stays
 * disabled until both are picked (the server checks the same thing again). A per-question message
 * shows only after they try to open with a question still empty.
 */
export function OpenLoanForm({ pn, financing, canOpen, facts }: { pn: string; financing: boolean; canOpen: boolean; facts: RuleFacts }) {
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
  /** The missing answer, named, next to the disabled button. */
  const missing = ft === null && orcr === null ? "Choose both answers" : ft === null ? "Choose the Undertaking answer" : orcr === null ? "Choose the OR/CR answer" : null;

  // After a loan is found, focus goes to the first question (once, on arrival), without scrolling the page:
  // the page title stays in view under the top bar.
  useEffect(() => {
    if (financing && canOpen) focusGroup(ftRef.current, true);
  }, [financing, canOpen]);

  const message = (field: "financingType" | "orcrStatus", value: string | null) =>
    value !== null ? undefined : state?.field === field ? plainMessage(state.error) : tried ? PICK_ONE : undefined;

  // What will be set up: shown once nothing is left to answer (Refinancing: at once).
  let outcome: RuleOutcome | null = null;
  if (answered) {
    try {
      outcome = evaluateLoanRules({
        productName: facts.productName,
        loanType: facts.loanType,
        totalReleasedAmount: facts.amount,
        financingType: financing ? (ft as "UNDERTAKING" | "NON_UNDERTAKING") : null,
        orcrStatus: financing ? (orcr as "TRANSFERRED" | "UNTRANSFERRED") : null,
      });
    } catch {
      outcome = null; // the server says what is wrong on Open
    }
  }

  return (
    <form
      action={action}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        if (ready && !pending) return;
        // The button looks and reads disabled; pressing it shows what is missing instead of sending.
        e.preventDefault();
        if (canOpen && !answered) { setTried(true); focusGroup(firstEmpty()); }
      }}
    >
      <input type="hidden" name="pn" value={pn} />
      {financing && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2" data-open-questions>
          <Choice
            groupRef={ftRef}
            legend="Is it an Undertaking?"
            name="financingType"
            value={ft}
            onChange={setFt}
            options={[["UNDERTAKING", "Undertaking"], ["NON_UNDERTAKING", "Non-Undertaking"]]}
            error={message("financingType", ft)}
          />
          <Choice
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
      {outcome && <SetUp outcome={outcome} />}
      {state && !state.ok && !state.field?.match(/financingType|orcrStatus/) && (
        <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-[15px] text-bad-fg">{plainMessage(state.error)}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-open-row>
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
        <Link href="/loans" className="inline-flex h-11 items-center rounded-xl px-3 text-[15px] font-semibold text-navy no-underline hover:bg-fill">Cancel</Link>
        {/* One muted line: what is missing while the button is disabled, otherwise that nothing is saved yet. */}
        {!canOpen ? (
          <span className="basis-full text-[13px] text-ink-2 sm:ml-auto sm:basis-auto">Your role does not allow opening loan files.</span>
        ) : missing && financing ? (
          <span id="open-hint" className="basis-full text-[13px] text-ink-2 sm:ml-auto sm:basis-auto" data-open-hint>{missing}</span>
        ) : (
          <span className="basis-full text-[13px] text-ink-2 sm:ml-auto sm:basis-auto" data-open-nothing-saved>Nothing is saved until you open the loan file.</span>
        )}
      </div>
    </form>
  );
}

/** "What will be set up": each rule that fired, its title and its one sentence (lib/rules/names.ts). */
function SetUp({ outcome }: { outcome: RuleOutcome }) {
  return (
    <section aria-labelledby="setup-title" className="rounded-xl bg-cream px-3.5 py-2.5 text-[13px] leading-snug" data-setup>
      <h3 id="setup-title" className="text-[13px] font-bold text-navy">
        What will be set up: <span className="font-semibold" data-setup-txns>{outcome.transactions.map((t) => txnName(t, TRANSACTION_LABEL[t])).join(", ")}</span>
      </h3>
      <ul className="mt-1 flex flex-col gap-0.5">
        {outcome.fired.map((f) => {
          const w = ruleWording(f);
          return (
            <li key={w.key} className={w.line.title ? "text-ink-2" : "font-semibold text-navy"} data-setup-rule={w.key}>
              {w.line.title && <><span className="font-semibold text-navy">{w.line.title}</span> · </>}{w.line.text}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A question as two separate, equal-width buttons (a radio group: the arrow keys move inside it, Space
 * chooses). Unchosen: white with a border. Chosen: filled navy, white bold text and a check icon, so the
 * choice reads without colour. Keyboard focus: a separate 2px gold ring. Clicking the chosen one keeps it.
 */
function Choice({
  legend, name, value, onChange, options, error, groupRef,
}: { legend: string; name: string; value: string | null; onChange: (v: string) => void; options: [string, string][]; error?: string; groupRef: React.Ref<HTMLDivElement> }) {
  const errId = `${name}-error`;
  const legendId = `${name}-legend`;
  return (
    <fieldset className="min-w-0" aria-describedby={error ? errId : undefined} data-question={name}>
      <legend id={legendId} className="mb-1.5 text-sm font-semibold text-navy">{legend}</legend>
      <div ref={groupRef} role="radiogroup" aria-labelledby={legendId} className="grid grid-cols-2 gap-2" data-pills>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <label key={v}
              data-choice={v}
              data-chosen={on || undefined}
              className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-1.5 text-center text-[14px] leading-tight transition-colors sm:text-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold ${
                on ? "border-navy bg-navy font-bold text-white" : `bg-white font-semibold text-navy hover:border-navy has-[:focus-visible]:border-navy ${error ? "border-act-line" : "border-line-strong"}`
              }`}>
              <input type="radio" name={name} value={v} checked={on} aria-checked={on} onChange={() => onChange(v)} required className="sr-only" />
              {on && <CheckIcon size={15} strokeWidth={2.6} />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
            </label>
          );
        })}
      </div>
      {error && <p id={errId} role="alert" className="mt-1.5 text-sm font-semibold text-act-fg">{error}</p>}
    </fieldset>
  );
}
