"use client";

import { useActionState, useId, useState } from "react";
import { FormMessage } from "@/components/form-status";
import { myLoansMockAction } from "@/app/actions/myloans-mock";
import { ENDPOINT_WORDS, FAILURE_WORDS, MOCK_ENDPOINTS, MOCK_FAILURES, type MockFailure } from "@/lib/myloans/v1/failures";

/**
 * Settings, System: the myloans mock (piece 6, D-048). Failure switches (which call, how it fails, next call only or
 * until switched off), the scenarios, and Reset the mock data. Not shown in production; refused there on the server.
 */
export function MyLoansMockPanel({ failures, scenarios, loans }: { failures: MockFailure[]; scenarios: [string, string][]; loans: number }) {
  const [state, action, pending] = useActionState(myLoansMockAction, null);
  const [kind, setKind] = useState<string>("unavailable");
  const id = useId();
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-act-line p-3" aria-labelledby={`${id}-h`} data-myloans-mock>
      <div>
        <h3 id={`${id}-h`} className="text-[15px] font-bold text-navy">myloans mock</h3>
        <p className="text-[13px] text-ink-2">The sample myloans the app talks to while MYLOANS_MODE is mock ({loans} loans). Never in production.</p>
      </div>

      <div className="flex flex-col gap-1" data-mock-failures>
        <p className="text-[13px] font-semibold text-ink-2">Failures on now</p>
        {failures.length === 0 ? <p className="text-[15px]">None: every call answers normally.</p> : (
          <ul className="flex flex-col gap-1">
            {failures.map((f, i) => (
              <li key={i} className="text-[15px]" data-mock-failure={`${f.endpoint}:${f.kind}`}>
                <span className="chip c-bad mr-1.5">{ENDPOINT_WORDS[f.endpoint]}</span>{FAILURE_WORDS[f.kind]}{f.page ? ` (page ${f.page})` : ""}{f.once ? ", next call only" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="fail" />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-e`} className="label">Which call</label>
          <select id={`${id}-e`} name="endpoint" className="input" defaultValue="all">
            {(["all", ...MOCK_ENDPOINTS] as const).map((e) => <option key={e} value={e}>{ENDPOINT_WORDS[e]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-k`} className="label">How it fails</label>
          <select id={`${id}-k`} name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {MOCK_FAILURES.map((k) => <option key={k} value={k}>{FAILURE_WORDS[k]}</option>)}
          </select>
        </div>
        {kind === "pageFails" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-p`} className="label">Page</label>
            <input id={`${id}-p`} name="page" type="number" min={1} max={100} defaultValue={2} className="input w-24" />
          </div>
        )}
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="once" defaultChecked className="h-5 w-5 accent-[var(--navy)]" /> Next call only
        </label>
        <button type="submit" className="btn-secondary btn-sm" disabled={pending}>Switch on</button>
      </form>

      <div className="flex flex-wrap gap-2">
        <form action={action}><input type="hidden" name="intent" value="clear" /><button type="submit" className="btn-ghost btn-sm" disabled={pending || failures.length === 0}>Switch every failure off</button></form>
        <form action={action}><input type="hidden" name="intent" value="reset" /><button type="submit" className="btn-ghost btn-sm" disabled={pending}>Reset the mock data</button></form>
      </div>

      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="scenario" />
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-s`} className="label">Add a scenario</label>
          <select id={`${id}-s`} name="scenario" className="input">
            {scenarios.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-secondary btn-sm" disabled={pending}>Add</button>
      </form>
      <FormMessage state={state} />
    </section>
  );
}
