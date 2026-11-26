"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { RefreshIcon } from "@/components/ui/icons";
import {
  overrideAction,
  refreshLoanAction,
  simulateAction,
} from "@/app/actions/loan";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { plainMessage } from "@/lib/ui/plain";

// ---------------------------------------------------------------------------
// Refresh from MyLoans
// ---------------------------------------------------------------------------

/**
 * D-062: Refresh from myloans as an icon button in the loan summary header (the preview's look, D-060): a 28 px
 * square (44 px to tap on a phone), its name and the last check in a small navy popover on hover or keyboard focus,
 * and for screen readers (aria-label, aria-describedby). The answer ("No changes.") shows beside it.
 */
export function RefreshIconButton({ loanId, lastChecked }: { loanId: string; lastChecked: string }) {
  const [state, action] = useActionState(refreshLoanAction, null);
  const tipId = useId();
  return (
    <form action={action} className="flex min-w-0 flex-wrap items-center gap-2" data-refresh-form>
      <input type="hidden" name="loanId" value={loanId} />
      <RefreshSubmit tipId={tipId} lastChecked={lastChecked} />
      {state && (
        <span role={state.ok ? "status" : "alert"} className={`min-w-0 text-xs font-semibold ${state.ok ? "text-ok-fg" : "text-bad-fg"}`} data-refresh-result>
          {state.ok ? plainMessage(state.message) : plainMessage(state.error)}
        </span>
      )}
    </form>
  );
}

function RefreshSubmit({ tipId, lastChecked }: { tipId: string; lastChecked: string }) {
  const { pending } = useFormStatus();
  const name = pending ? "Asking myloans..." : "Refresh from myloans";
  return (
    <span className="group/refresh relative inline-flex">
      <button type="submit" aria-label={name} aria-describedby={tipId} disabled={pending}
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-input bg-white text-navy hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 before:absolute before:-inset-2 before:content-[''] md:before:hidden"
        data-refresh-loan>
        <RefreshIcon size={15} className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />
      </button>
      <span id={tipId} role="tooltip"
        className="pointer-events-none hidden absolute right-0 top-full z-30 mt-1.5 w-max max-w-[min(240px,calc(100vw-48px))] whitespace-normal rounded-lg bg-navy px-2.5 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/20 group-hover/refresh:block group-has-[:focus-visible]/refresh:block"
        data-refresh-tooltip>
        {name} · last checked {lastChecked}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Supervisor override
// ---------------------------------------------------------------------------

export function OverrideForm({ loanId, current }: { loanId: string; current: { classification: string; financingType: string | null; orcrStatus: string | null; mortgage: string } }) {
  const [state, action] = useActionState(overrideAction, null);
  const [cls, setCls] = useState(current.classification);
  const [orcr, setOrcr] = useState(current.orcrStatus ?? "TRANSFERRED");
  const needsMortgage = !(cls === "FINANCING" && orcr === "UNTRANSFERRED");
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-navy">Override automatic result (Supervisor)</summary>
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="loanId" value={loanId} />
        <div>
          <label htmlFor="ov-cls" className="label">Classification</label>
          <select id="ov-cls" name="classification" value={cls} onChange={(e) => setCls(e.target.value)} className="input">
            <option value="FINANCING">Financing</option>
            <option value="REFINANCING">Refinancing</option>
          </select>
        </div>
        {cls === "FINANCING" && (
          <>
            <div>
              <label htmlFor="ov-ft" className="label">Financing type</label>
              <select id="ov-ft" name="financingType" defaultValue={current.financingType ?? "UNDERTAKING"} className="input">
                <option value="UNDERTAKING">Undertaking</option>
                <option value="NON_UNDERTAKING">Non-Undertaking</option>
              </select>
            </div>
            <div>
              <label htmlFor="ov-orcr" className="label">ORCR</label>
              <select id="ov-orcr" name="orcrStatus" value={orcr} onChange={(e) => setOrcr(e.target.value)} className="input">
                <option value="TRANSFERRED">Transferred</option>
                <option value="UNTRANSFERRED">Untransferred</option>
              </select>
            </div>
          </>
        )}
        {needsMortgage && (
          <div>
            <label htmlFor="ov-m" className="label">Mortgage result</label>
            <select id="ov-m" name="mortgage" defaultValue={current.mortgage === "NOT_MORTGAGE" ? "NOT_MORTGAGE" : "MORTGAGE"} className="input">
              <option value="MORTGAGE">Mortgage (4 transactions)</option>
              <option value="NOT_MORTGAGE">Not Mortgage (Notary, For EDST)</option>
            </select>
          </div>
        )}
        <div className="md:col-span-2">
          <label htmlFor="ov-reason" className="label">Reason <span className="text-err-fg">*</span></label>
          <textarea id="ov-reason" name="reason" required minLength={10} rows={2} maxLength={1000} className="input" />
          <p className="help">Audited. Transactions already with a DP are never changed.</p>
        </div>
        <div className="md:col-span-2 space-y-2">
          <FormMessage state={state} />
          <SubmitButton className="btn-danger">Apply override</SubmitButton>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Test simulator
// ---------------------------------------------------------------------------

export interface SimButton {
  action: string;
  targetId?: string;
  label: string;
}

export function SimulatorPanel({ loanId, groups }: { loanId: string; groups: { title: string; buttons: SimButton[] }[] }) {
  const [state, action] = useActionState(simulateAction, null);
  return (
    <section aria-labelledby="sim-title" className="card border-dashed p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="sim-title" className="h2">Test-mode simulator</h3>
        <span className="chip bg-warn-bg text-warn-fg">Simulated events</span>
      </div>
      <p className="mt-1 text-xs text-ink-2">Pushes steps owned by roles without a login yet (Finance, DP, receiving LA, Vault). Every event is labelled Simulated in the trail.</p>
      <div className="mt-3 space-y-3">
        {groups.length === 0 && <p className="text-sm text-ink-2">No simulated step is available at this stage.</p>}
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-xs font-semibold text-ink-2">{g.title}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {g.buttons.map((b) => (
                <form key={`${b.action}-${b.targetId ?? ""}`} action={action}>
                  <input type="hidden" name="loanId" value={loanId} />
                  <input type="hidden" name="action" value={b.action} />
                  {b.targetId && <input type="hidden" name="targetId" value={b.targetId} />}
                  <SubmitButton className="btn-secondary btn-sm" pendingText="Working...">{b.label}</SubmitButton>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3"><FormMessage state={state} /></div>
    </section>
  );
}
