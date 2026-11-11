"use client";

import { MISSING_NOTE, MissingPaperRow, type MissingPaperLine } from "./missing-paper-row";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckIcon } from "@/components/ui/icons";
import {
  completeJobAction, finishStageAction, forwardJobAction, somethingMissingAction, startStageAction, verifyPaperAction,
} from "@/app/actions/jobs";
import type { ActionState } from "@/lib/action";
import type { EvidenceField } from "@/lib/stages/rules";

const Hidden = ({ v }: { v: Record<string, string> }) => <>{Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>;

/** Submit without React clearing the form: a refused try keeps what was typed. */
function keepValues(e: React.FormEvent<HTMLFormElement>, action: (fd: FormData) => void) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => action(fd));
}
function useCloseOnOk(state: ActionState, close: () => void) {
  useEffect(() => { if (state?.ok) close(); }, [state, close]);
}

export interface StageView {
  id: string;
  name: string;
  kind: "OWN" | "LTO_DROP" | "LTO_PICKUP" | "VERIFY";
  status: "LATER" | "STARTED" | "DONE";
  fields: EvidenceField[];
  startedText: string | null;
}
/** missing: a paper the LA marked Missing with remarks (shown in its place, nothing to verify). */
export interface PaperView { id: string; label: string; original: boolean; tickedText: string | null; missing?: MissingPaperLine | null }

/** Start (a system time). Disabled with the reason beside it when the stage is blocked (At the LTO, not funded). */
export function StartStageButton({ assignmentId, stage, blocked }: { assignmentId: string; stage: StageView; blocked?: string }) {
  const [state, action] = useActionState(startStageAction, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <Hidden v={{ assignmentId, stageId: stage.id }} />
      <div><SubmitButton id="stage-primary" disabled={!!blocked} aria-describedby={blocked ? "stage-blocked" : undefined}>Start {stage.name}</SubmitButton></div>
      {blocked && <p id="stage-blocked" className="text-[13px] font-semibold text-act-fg">{blocked}</p>}
      <FormMessage state={state} />
    </form>
  );
}

/** Finish: the evidence pop-up. Required fields are checked here and again on the server; times are the server's. */
export function FinishStageButton({ assignmentId, stage, today, office }: { assignmentId: string; stage: StageView; today: string; office: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(finishStageAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" id="stage-primary" className="btn-primary" onClick={() => setOpen(true)}>Finish {stage.name}</button>
      <FormMessage state={state && !open ? state : null} />
      <GuardedSheet open={open} onClose={close} title={`Finish: ${stage.name}`}>
        <form onSubmit={(e) => keepValues(e, action)} className="flex flex-col gap-3" data-evidence-form>
          <Hidden v={{ assignmentId, stageId: stage.id }} />
          <p className="text-[13px] text-ink-2">Started {stage.startedText}. The finish time is recorded when you save.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {stage.fields.map((f) => {
              const id = `${uid}-${f.key}`;
              const bad = state?.field === f.key;
              if (f.type === "tick") {
                return (
                  <label key={f.key} className="inline-flex min-h-11 items-center gap-2 text-[15px] sm:col-span-2">
                    <input id={id} type="checkbox" name={f.key} required={f.required} className="h-5 w-5 accent-[var(--navy)]" aria-invalid={bad} />{f.label}
                  </label>
                );
              }
              return (
                <div key={f.key}>
                  <label htmlFor={id} className="label">{f.label}{f.required ? "" : " (optional)"}</label>
                  <input
                    id={id} name={f.key} required={f.required} aria-invalid={bad} className="input"
                    type={f.type === "date" ? "date" : f.type === "file" ? "file" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    max={f.type === "date" ? today : undefined}
                    accept={f.type === "file" ? "image/png,image/jpeg,image/webp,application/pdf" : undefined}
                    defaultValue={f.key === "office" && office ? office : f.key === "series" ? today.slice(0, 4) : undefined}
                  />
                </div>
              );
            })}
          </div>
          {stage.fields.length === 0 && <p className="text-[15px]">Nothing to record for this stage.</p>}
          <FormMessage state={state} />
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Save and finish</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

/** Check and verify: tick every paper "Received back and complete", or say what is missing. */
export function VerifyPapers({ assignmentId, stage, papers: rows, problemOpen }: { assignmentId: string; stage: StageView; papers: PaperView[]; problemOpen: boolean }) {
  const papers = rows.filter((p) => !p.missing);
  const missingCount = rows.length - papers.length;
  const left = papers.filter((p) => !p.tickedText).length;
  const [fin, finAction] = useActionState(finishStageAction, null);
  return (
    <div className="flex flex-col gap-3" data-verify>
      <p className="text-[15px]">Check that every paper is back and complete. {left > 0 ? `${left} of ${papers.length} left.` : "All papers are back."}</p>
      <ul className="flex flex-col overflow-hidden rounded-xl border border-line" aria-label="Papers to verify">
        {rows.map((p) => p.missing ? <MissingPaperRow key={p.id} p={p.missing} /> : <VerifyRow key={p.id} assignmentId={assignmentId} stageId={stage.id} paper={p} />)}
      </ul>
      {missingCount > 0 && <p className="help -mt-2" data-missing-note>{MISSING_NOTE}</p>}
      {problemOpen && <p className="rounded-xl bg-bad-bg px-3 py-2 text-[14px] font-semibold text-bad-fg" data-verify-blocked>A problem is open. Resolve it when the paper is found, then finish Check and verify.</p>}
      <div className="flex flex-wrap items-start gap-2">
        <form onSubmit={(e) => keepValues(e, finAction)} className="flex flex-col gap-2">
          <Hidden v={{ assignmentId, stageId: stage.id }} />
          <label className="sr-only" htmlFor="verify-note">Note (optional)</label>
          <input id="verify-note" name="note" maxLength={500} placeholder="Note (optional)" className="input w-full sm:w-72" />
          <div><SubmitButton id="stage-primary" disabled={left > 0 || problemOpen}>Finish Check and verify</SubmitButton></div>
          <FormMessage state={fin} />
        </form>
        {!problemOpen && left > 0 && <SomethingMissing assignmentId={assignmentId} stageId={stage.id} papers={papers.filter((p) => !p.tickedText)} />}
      </div>
    </div>
  );
}

function VerifyRow({ assignmentId, stageId, paper }: { assignmentId: string; stageId: string; paper: PaperView }) {
  const [state, action] = useActionState(verifyPaperAction, null);
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0" data-verify-paper={paper.tickedText ? "done" : "open"}>
      <span className="min-w-0 flex-1 text-[15px]">{paper.label} <span className="tag">{paper.original ? "Original" : "Copy"}</span></span>
      {paper.tickedText ? (
        <span className="chip c-ok h-7 text-xs"><CheckIcon size={14} />Received back · {paper.tickedText}</span>
      ) : (
        <form action={action}>
          <Hidden v={{ assignmentId, stageId, documentItemId: paper.id }} />
          <SubmitButton className="btn-secondary btn-sm min-h-11" aria-label={`${paper.label}: received back and complete`}>Received back and complete</SubmitButton>
        </form>
      )}
      {state && !state.ok && <div className="basis-full"><FormMessage state={state} /></div>}
    </li>
  );
}

function SomethingMissing({ assignmentId, stageId, papers }: { assignmentId: string; stageId: string; papers: PaperView[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(somethingMissingAction, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseOnOk(state, close);
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>Something is missing</button>
      <GuardedSheet open={open} onClose={close} title="Something is missing">
        <form onSubmit={(e) => keepValues(e, action)} className="flex flex-col gap-3">
          <Hidden v={{ assignmentId, stageId }} />
          <p className="text-[15px]">This opens a Problem (Missing paper) on Check and verify. The clock keeps counting. Resolve it when the paper is found, then verify again. If the Loan Associate must supply it, use Return to LA instead.</p>
          <fieldset className="flex flex-col gap-1">
            <legend className="label">Which papers are not back?</legend>
            {papers.map((p) => (
              <label key={p.id} className="inline-flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" name="papers" value={p.id} className="h-5 w-5 accent-[var(--navy)]" />{p.label}</label>
            ))}
          </fieldset>
          <div><label htmlFor="missing-note" className="label">Note (optional)</label><input id="missing-note" name="note" maxLength={300} className="input" /></div>
          <FormMessage state={state} />
          <div className="flex justify-end gap-2"><SheetCancel /><SubmitButton>Open the problem</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

/** Complete job: only when every stage is done. Never forwards by itself. */
export function CompleteJobButton({ assignmentId }: { assignmentId: string }) {
  const [state, action] = useActionState(completeJobAction, null);
  return (
    <form action={action} className="flex flex-col gap-1" data-complete-job>
      <Hidden v={{ assignmentId }} />
      <div><SubmitButton id="stage-primary">Complete job</SubmitButton></div>
      <p className="text-[13px] text-ink-2">Every stage is done. Completing does not forward the package; you choose the branch next.</p>
      <FormMessage state={state} />
    </form>
  );
}

export interface ForwardBranch { id: string; name: string; las: { id: string; name: string }[] }

/** Forward to branch: the DP chooses the branch, then the named LA. Nothing is pre-selected. */
export function ForwardToBranchForm({ assignmentId, branches, loanBranch, paperCount }: { assignmentId: string; branches: ForwardBranch[]; loanBranch: string; paperCount: number }) {
  const [state, action] = useActionState(forwardJobAction, null);
  const [branchId, setBranchId] = useState("");
  const [laId, setLaId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const branch = branches.find((b) => b.id === branchId);
  const la = branch?.las.find((l) => l.id === laId);
  const uid = useId();
  const formId = `${uid}-fwd`;
  return (
    <form id={formId} action={action} className="flex flex-col gap-3" data-forward>
      <Hidden v={{ assignmentId }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-b`} className="label">1. Branch</label>
          <select id={`${uid}-b`} name="branchId" value={branchId} onChange={(e) => { setBranchId(e.target.value); setLaId(""); }} className="input" aria-describedby={`${uid}-bh`}>
            <option value="">Choose the branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <p id={`${uid}-bh`} className="help">The loan&apos;s branch is {loanBranch}.</p>
        </div>
        <div>
          <label htmlFor={`${uid}-la`} className="label">2. Loan Associate</label>
          <select id={`${uid}-la`} name="receivingLaId" value={laId} onChange={(e) => setLaId(e.target.value)} className="input" disabled={!branch}>
            <option value="">{branch ? "Choose the Loan Associate" : "Choose the branch first"}</option>
            {branch?.las.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      <div><label htmlFor={`${uid}-n`} className="label">Note (optional)</label><input id={`${uid}-n`} name="note" maxLength={300} className="input" /></div>
      <FormMessage state={state} />
      <div>
        <button type="button" id="forward-primary" className="btn-primary" disabled={!branch || !la} onClick={() => setConfirming(true)}>Forward to branch</button>
      </div>
      <ConfirmDialog
        open={confirming && !!la && !!branch}
        title="Forward the package?"
        body={<>Forward {paperCount} paper{paperCount === 1 ? "" : "s"} to <strong>{la?.name}</strong> at <strong>{branch?.name}</strong>? They are told now.</>}
        confirmLabel={`Forward ${paperCount} paper${paperCount === 1 ? "" : "s"}`}
        confirmForm={formId}
        onCancel={() => setConfirming(false)}
      />
    </form>
  );
}

/** Phone: the main next action pinned above the bottom navigation (large target). */
export function PinnedAction({ label, targetId, href }: { label: string; targetId: string; href?: string }) {
  if (href) {
    return (
      <div className="no-print fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white px-4 py-2 sm:hidden" data-pinned-action>
        <Link href={href} className="btn-primary flex h-12 w-full items-center justify-center text-[16px] no-underline">{label}</Link>
      </div>
    );
  }
  return (
    <div className="no-print fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white px-4 py-2 sm:hidden" data-pinned-action>
      <button
        type="button" className="btn-primary h-12 w-full text-[16px]"
        onClick={() => {
          const el = document.getElementById(targetId);
          if (!el) return;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          if (el instanceof HTMLButtonElement && !el.disabled) el.click();
          else el.focus();
        }}
      >
        {label}
      </button>
    </div>
  );
}
