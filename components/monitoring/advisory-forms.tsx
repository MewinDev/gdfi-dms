"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing, useCloseWhenDone } from "@/components/ui/live-toast";
import { WarningIcon } from "@/components/ui/icons";
import { RemarksField } from "@/components/jobs/forms";
import { editAdvisoryAction, fileAdvisoryAction, resolveAdvisoryAction } from "@/app/actions/monitoring";
import { ADVISORY_LABEL, ADVISORY_TYPES, type AdvisoryType } from "@/lib/monitoring/advisories";
import { remarksCounter, REMARKS_LIMIT_MESSAGE } from "@/lib/ui/holds";
import type { ActionState } from "@/lib/action";

const fileAnnounced = announcing(fileAdvisoryAction);
const resolveAnnounced = announcing(resolveAdvisoryAction);
const editAnnounced = announcing(editAdvisoryAction);

/** Now, in Philippine time, as the value of a datetime-local box ("YYYY-MM-DDTHH:mm"). */
function phtNowLocal(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** The warning lines under an LTO office choice (never blocks anything). */
export function AdvisoryWarnings({ lines, id }: { lines: string[] | undefined; id?: string }) {
  if (!lines?.length) return null;
  return (
    <ul id={id} className="mt-1.5 flex flex-col gap-1" data-advisory-warning>
      {lines.map((l) => (
        <li key={l} className="flex items-start gap-2 rounded-lg border border-act-line bg-act-bg px-3 py-2 text-[13px] text-act-fg">
          <WarningIcon size={16} /> <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Report an LTO problem": from the DP job at an LTO stage (assignmentId), or from the Monitoring page
 * (offices to pick from, ltoreports:manage).
 */
export function ReportLtoProblemButton({ assignmentId, officeName, offices, buttonClass = "btn-ghost btn-sm", label = "Report an LTO problem" }: {
  assignmentId?: string; officeName?: string; offices?: { id: string; name: string }[]; buttonClass?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(fileAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)} data-report-lto><WarningIcon size={16} /> {label}</button>
      <GuardedSheet open={open} onClose={close} title="Report an LTO problem">
        {open && <ReportForm key={String(open)} uid={uid} action={action} state={state} assignmentId={assignmentId} officeName={officeName} offices={offices} />}
      </GuardedSheet>
    </>
  );
}

function ReportForm({ uid, action, state, assignmentId, officeName, offices }: { uid: string; action: (fd: FormData) => void; state: ActionState; assignmentId?: string; officeName?: string; offices?: { id: string; name: string }[] }) {
  const [type, setType] = useState<AdvisoryType | "">("");
  const [office, setOffice] = useState("");
  const [remarks, setRemarks] = useState("");
  const [start] = useState(phtNowLocal);
  const [tried, setTried] = useState(false);
  const ok = !!type && remarksCounter(remarks).ok && (!!assignmentId || !!office);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error ?? null : null);
  return (
    <form action={action} onSubmit={(e) => { if (!ok) { e.preventDefault(); setTried(true); } }} className="flex flex-col gap-3" noValidate data-advisory-form>
      {assignmentId && <input type="hidden" name="assignmentId" value={assignmentId} />}
      <p className="text-[15px] text-ink-2">Tell everyone about a problem at the office. It warns the Loan Associates choosing this office and the processors going there; it never blocks anything. Operations is told.</p>
      {assignmentId ? (
        <p className="rounded-xl bg-fill px-3 py-2 text-[15px]">Office: <strong>{officeName}</strong></p>
      ) : (
        <div>
          <label htmlFor={`${uid}-o`} className="label">LTO office (required)</label>
          <select id={`${uid}-o`} name="ltoOfficeId" className="input" value={office} onChange={(e) => setOffice(e.target.value)} aria-invalid={(tried && !office) || !!err("ltoOfficeId") || undefined}>
            <option value="" disabled>Pick the office</option>
            {offices?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {(err("ltoOfficeId") || (tried && !office)) && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("ltoOfficeId") ?? "Pick the office"}</p>}
        </div>
      )}
      <fieldset>
        <legend className="label">What is wrong? (required)</legend>
        <div className="grid grid-cols-2 gap-2">
          {ADVISORY_TYPES.map((t) => (
            <label key={t} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-[15px] ${type === t ? "border-navy bg-fill-soft font-semibold" : "border-line"}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="h-4 w-4 accent-[var(--navy)]" /> {ADVISORY_LABEL[t]}
            </label>
          ))}
        </div>
        {((tried && !type) || err("type")) && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("type") ?? "Pick what is wrong."}</p>}
      </fieldset>
      <RemarksField id={`${uid}-r`} name="remarks" label="Remarks (required): what did you see?" value={remarks} onChange={setRemarks} error={err("remarks") ?? (tried && !remarksCounter(remarks).ok ? REMARKS_LIMIT_MESSAGE : null)} />
      <div>
        <label htmlFor={`${uid}-s`} className="label">Started (PHT)</label>
        <input id={`${uid}-s`} type="datetime-local" name="startedAt" defaultValue={start} max={start} className="input" aria-invalid={!!err("startedAt") || undefined} />
        <p className={`mt-1 text-[13px] ${err("startedAt") ? "font-semibold text-bad-fg" : "text-ink-2"}`}>{err("startedAt") ?? "Now, unless it started earlier (up to 7 days back). Who and when you report it are recorded."}</p>
      </div>
      {state && !state.ok && !["type", "remarks", "startedAt", "ltoOfficeId"].includes(state.field ?? "") && <FormMessage state={state} />}
      <div className="flex justify-end gap-2">
        <SheetCancel />
        <SubmitButton disabled={!ok}>Report</SubmitButton>
      </div>
    </form>
  );
}

/** Resolve (remarks 5 to 500). */
export function ResolveAdvisoryButton({ id, label = "Resolve", summary, buttonClass = "btn-ghost btn-sm" }: { id: string; label?: string; summary: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(resolveAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  const [remarks, setRemarks] = useState("");
  const ok = remarksCounter(remarks).ok;
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)} data-resolve-advisory>{label}</button>
      <GuardedSheet open={open} onClose={close} title="Resolve the advisory">
        <form action={action} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="id" value={id} />
          <p className="rounded-xl bg-fill px-3 py-2 text-[15px]">{summary}</p>
          <RemarksField id={`${uid}-r`} name="remarks" label="Remarks (required): what changed?" value={remarks} onChange={setRemarks} error={state && !state.ok && state.field === "remarks" ? state.error ?? null : null} />
          {state && !state.ok && state.field !== "remarks" && <FormMessage state={state} />}
          <div className="flex justify-end gap-2">
            <SheetCancel />
            <SubmitButton disabled={!ok}>Resolve</SubmitButton>
          </div>
        </form>
      </GuardedSheet>
    </>
  );
}

/** Edit the type and remarks of an active advisory (ltoreports:manage, or the filer). */
export function EditAdvisoryButton({ id, type, remarks: initial }: { id: string; type: AdvisoryType; remarks: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(editAnnounced, null);
  const close = useMemo(() => () => setOpen(false), []);
  useCloseWhenDone(state, close);
  const uid = useId();
  const [t, setT] = useState<AdvisoryType>(type);
  const [remarks, setRemarks] = useState(initial);
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Edit</button>
      <GuardedSheet open={open} onClose={close} title="Edit the advisory">
        <form action={action} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="id" value={id} />
          <div>
            <label htmlFor={`${uid}-t`} className="label">What is wrong?</label>
            <select id={`${uid}-t`} name="type" className="input" value={t} onChange={(e) => setT(e.target.value as AdvisoryType)}>
              {ADVISORY_TYPES.map((x) => <option key={x} value={x}>{ADVISORY_LABEL[x]}</option>)}
            </select>
          </div>
          <RemarksField id={`${uid}-r`} name="remarks" label="Remarks" value={remarks} onChange={setRemarks} error={state && !state.ok && state.field === "remarks" ? state.error ?? null : null} />
          {state && !state.ok && state.field !== "remarks" && <FormMessage state={state} />}
          <div className="flex justify-end gap-2">
            <SheetCancel />
            <SubmitButton disabled={!remarksCounter(remarks).ok}>Save</SubmitButton>
          </div>
        </form>
      </GuardedSheet>
    </>
  );
}
