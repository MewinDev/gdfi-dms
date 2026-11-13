"use client";

import { useActionState, useState } from "react";
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

export function RefreshButton({ loanId, label = "Refresh from MyLoans" }: { loanId: string; label?: string }) {
  const [state, action] = useActionState(refreshLoanAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="loanId" value={loanId} />
      <SubmitButton className="btn-secondary btn-sm" pendingText="Calling MyLoans...">{label}</SubmitButton>
      <div className="max-w-xs"><FormMessage state={state ? { ...state, message: plainMessage(state.message), error: plainMessage(state.error) } : null} /></div>
    </form>
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
