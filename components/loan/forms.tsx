"use client";

import { useActionState, useMemo, useState } from "react";
import {
  assignToDpAction,
  overrideAction,
  recordEdstAction,
  refreshLoanAction,
  requestMissingAction,
  resolveExceptionAction,
  saveChecklistAction,
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
// Checklist
// ---------------------------------------------------------------------------

export interface ChecklistLine {
  id: string;
  label: string;
  kind: "REQUIRED" | "ONE_OF" | "OPTIONAL" | "OTHER";
  group: string | null;
  originality: string;
  checked: boolean;
  documentId: string | null;
}

const KIND_TITLE: Record<string, string> = { REQUIRED: "Required", ONE_OF: "One of", OPTIONAL: "Optional", OTHER: "Others" };

export function ChecklistForm({ transactionId, lines, editable }: { transactionId: string; lines: ChecklistLine[]; editable: boolean }) {
  const [others, setOthers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveChecklistAction>>, fd: FormData) => {
    const r = await saveChecklistAction(prev, fd);
    if (r?.ok) setOthers([]);
    return r;
  }, null);
  const sections = (["REQUIRED", "ONE_OF", "OPTIONAL", "OTHER"] as const)
    .map((k) => ({ k, items: lines.filter((l) => l.kind === k) }))
    .filter((s) => s.items.length > 0 || (s.k === "OTHER" && editable));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="transactionId" value={transactionId} />
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((s) => (
          <fieldset key={s.k} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-2">{KIND_TITLE[s.k]}</legend>
            <ul className="space-y-1.5">
              {groupLines(s.items).map(([group, items]) => (
                <li key={group ?? "none"}>
                  {group && <p className="mb-1 text-xs font-semibold text-ink-2">{group} (tick at least one)</p>}
                  <ul className="space-y-1.5">
                    {items.map((l) => (
                      <li key={l.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name="checked" value={l.id} defaultChecked={l.checked} disabled={!editable} className="mt-0.5 h-4 w-4 accent-[var(--navy)]" />
                          <span>
                            {l.label} <span className="text-xs text-ink-2">({l.originality === "ORIGINAL" ? "original" : "copy"})</span>
                            {l.documentId && <span className="mono ml-1 block text-xs text-info-fg">{l.documentId}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {s.k === "OTHER" && others.map((o, i) => (
                <li key={`new-${i}`} className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="newOther" value={o} />
                  <span className="chip bg-chip-sys">New</span> {o}
                  <button type="button" className="text-xs text-err-fg underline" onClick={() => setOthers(others.filter((_, j) => j !== i))}>Remove</button>
                </li>
              ))}
            </ul>
            {s.k === "OTHER" && editable && (
              <div className="mt-2 flex gap-2">
                <label htmlFor={`other-${transactionId}`} className="sr-only">Other document</label>
                <input id={`other-${transactionId}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} placeholder="Other document received" className="input" />
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => { if (draft.trim()) { setOthers([...others, draft.trim()]); setDraft(""); } }}>
                  Add
                </button>
              </div>
            )}
          </fieldset>
        ))}
      </div>
      <FormMessage state={state} />
      {editable && <SubmitButton>Save checklist</SubmitButton>}
    </form>
  );
}

function groupLines(items: ChecklistLine[]): [string | null, ChecklistLine[]][] {
  const map = new Map<string | null, ChecklistLine[]>();
  for (const i of items) map.set(i.group, [...(map.get(i.group) ?? []), i]);
  return [...map.entries()];
}

export function RequestMissingForm({ transactionId }: { transactionId: string }) {
  const [state, action] = useActionState(requestMissingAction, null);
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-semibold">Request missing documents</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="transactionId" value={transactionId} />
        <label htmlFor={`note-${transactionId}`} className="label">Note to the borrower or branch (optional)</label>
        <textarea id={`note-${transactionId}`} name="note" rows={2} maxLength={500} className="input" />
        <FormMessage state={state} />
        <SubmitButton className="btn-secondary">Raise Legal Docs Completion</SubmitButton>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------
// EDST
// ---------------------------------------------------------------------------

export function EdstForm({ transactionId }: { transactionId: string }) {
  const [state, action] = useActionState(recordEdstAction, null);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-line bg-cream p-3">
      <input type="hidden" name="transactionId" value={transactionId} />
      <p className="text-sm font-semibold">Enter the account in EDST, then record the reference. No DP needed.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={`edst-${transactionId}`} className="label">EDST reference</label>
          <input id={`edst-${transactionId}`} name="reference" required maxLength={60} className="input" aria-invalid={state?.field === "reference"} />
        </div>
        <SubmitButton>Confirm EDST</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Assign to DP
// ---------------------------------------------------------------------------

export interface AssignOptions {
  branches: { id: string; name: string }[];
  dps: { id: string; name: string; branchIds: string[]; open: number }[];
  recommended: Record<string, string | null>; // branchId -> dp id
  ltoOffices: { id: string; name: string }[];
  defaultBranchId: string;
  pastDay2: boolean;
  deadline: string;
  hasReleasedCa: boolean;
}

export function AssignForm({ transactionId, typeName, ltoRequired, o }: { transactionId: string; typeName: string; ltoRequired: boolean; o: AssignOptions }) {
  const [state, action] = useActionState(assignToDpAction, null);
  const [branchId, setBranchId] = useState(o.defaultBranchId);
  const rec = o.recommended[branchId] ?? null;
  const [dpId, setDpId] = useState<string>(rec ?? "");
  const [pasuyo, setPasuyo] = useState(false);
  const dpsHere = useMemo(() => o.dps.filter((d) => d.branchIds.includes(branchId)), [o.dps, branchId]);
  const err = (f: string) => (state?.field === f ? state.error : undefined);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-cream p-3">
      <input type="hidden" name="transactionId" value={transactionId} />
      <p className="text-sm font-semibold">Assign {typeName} to a DP</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`b-${transactionId}`} className="label">DP branch</label>
          <select id={`b-${transactionId}`} name="dpBranchId" value={branchId} onChange={(e) => { setBranchId(e.target.value); setDpId(o.recommended[e.target.value] ?? ""); }} className="input">
            {o.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`dp-${transactionId}`} className="label">Document Processor</label>
          <select id={`dp-${transactionId}`} name="dpUserId" value={dpId} onChange={(e) => setDpId(e.target.value)} required className="input" aria-invalid={!!err("dpUserId")}>
            <option value="">Pick a DP</option>
            {dpsHere.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.open} open){d.id === rec ? " - recommended" : ""}
              </option>
            ))}
          </select>
          {rec && <p className="help">System recommends {o.dps.find((d) => d.id === rec)?.name} (fewest open assignments).</p>}
          {dpsHere.length === 0 && <p className="help text-err-fg">No active DP in this branch.</p>}
          {err("dpUserId") && <p className="mt-1 text-xs text-err-fg">{err("dpUserId")}</p>}
        </div>
        <div>
          <label htmlFor={`lto-${transactionId}`} className="label">LTO office {ltoRequired ? <span className="text-err-fg">*</span> : <span className="font-normal text-ink-2">(optional)</span>}</label>
          <select id={`lto-${transactionId}`} name="ltoOfficeId" required={ltoRequired} defaultValue="" className="input" aria-invalid={!!err("ltoOfficeId")}>
            <option value="">{ltoRequired ? "Pick an LTO office" : "None"}</option>
            {o.ltoOffices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {err("ltoOfficeId") && <p className="mt-1 text-xs text-err-fg">{err("ltoOfficeId")}</p>}
        </div>
        <div>
          <label htmlFor={`fund-${transactionId}`} className="label">Fund status</label>
          <select id={`fund-${transactionId}`} name="fundStatus" defaultValue={o.hasReleasedCa ? "FUNDED" : "NOT_REQUIRED"} className="input" aria-invalid={!!err("fundStatus")}>
            <option value="NOT_REQUIRED">No funds needed</option>
            <option value="FOR_FUNDING">For funding (waiting for the cash advance)</option>
            <option value="FUNDED" disabled={!o.hasReleasedCa}>Funded{o.hasReleasedCa ? "" : " (needs a released cash advance)"}</option>
          </select>
          {err("fundStatus") && <p className="mt-1 text-xs text-err-fg">{err("fundStatus")}</p>}
        </div>
        {o.pastDay2 && (
          <div className="md:col-span-2">
            <label htmlFor={`btat-${transactionId}`} className="label">Beyond-TAT reason <span className="text-err-fg">*</span></label>
            <textarea id={`btat-${transactionId}`} name="beyondTatReason" required rows={2} maxLength={500} className="input" aria-invalid={!!err("beyondTatReason")} />
            <p className="help">This is past the Day 2 TAT ({o.deadline}).</p>
          </div>
        )}
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pasuyo" checked={pasuyo} onChange={(e) => setPasuyo(e.target.checked)} className="h-4 w-4 accent-[var(--navy)]" />
            Pasuyo (secondary DP)
          </label>
        </div>
        {pasuyo && (
          <>
            <div>
              <label htmlFor={`sdp-${transactionId}`} className="label">Secondary DP</label>
              <select id={`sdp-${transactionId}`} name="secondaryDpUserId" required className="input" defaultValue="">
                <option value="">Pick a DP</option>
                {o.dps.filter((d) => d.id !== dpId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`pr-${transactionId}`} className="label">Pasuyo reason</label>
              <input id={`pr-${transactionId}`} name="pasuyoReason" required maxLength={300} className="input" />
            </div>
          </>
        )}
      </div>
      <FormMessage state={state} />
      <SubmitButton className="btn-accent" pendingText="Assigning...">Assign to DP</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export function ResolveExceptionForm({ exceptionId }: { exceptionId: string }) {
  const [state, action] = useActionState(resolveExceptionAction, null);
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <label htmlFor={`res-${exceptionId}`} className="label">How was it resolved?</label>
      <textarea id={`res-${exceptionId}`} name="resolution" required rows={2} maxLength={1000} className="input" />
      <FormMessage state={state} />
      <SubmitButton className="btn-secondary btn-sm">Resolve exception</SubmitButton>
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
