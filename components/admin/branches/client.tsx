"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { FilePicker } from "@/components/admin/file-picker";
import {
  branchHiddenAction, branchImportAction, branchScheduleAction, branchSyncAction, reviewDecisionAction, reviewImpactAction, type BranchImportState,
} from "@/app/actions/branches";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SAVED_EVENT } from "@/components/admin/settings-modal";
import { BRANCH_FILE_MAX_BYTES } from "@/lib/branches/file";
import type { DiffItem } from "@/lib/branches/diff";

const STATUS_TEXT = { new: "New", changed: "Changed", unchanged: "Unchanged" } as const;
const STATUS_TONE = { new: "c-ok", changed: "c-act", unchanged: "c-mute" } as const;

function Note({ state }: { state: { ok: boolean; message?: string; error?: string } | null }) {
  if (!state) return null;
  return state.ok
    ? <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">{state.message}</p>
    : <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{state.error}</p>;
}

/**
 * Import from MyLoans: choose the MyLoans branch file (the tab-separated dump or a CSV with a header),
 * Check (a preview, nothing saved), then Confirm. Test-looking rows come first: Admin may switch them on
 * and may hide them from the DMS (suggested, never ticked for them).
 */
export function MyLoansImport() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<BranchImportState, FormData>(branchImportAction, null);
  const [leave, setLeave] = useState<Set<string>>(new Set());
  const [activate, setActivate] = useState<Set<string>>(new Set());
  const [hide, setHide] = useState<Set<string>>(new Set());
  const [showUnchanged, setShowUnchanged] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const preview = state?.ok && state.step === "preview" ? state.preview : null;
  const done = state?.ok && state.step === "done" ? state.result : null;

  useEffect(() => { if (done) window.dispatchEvent(new Event(SAVED_EVENT)); }, [done]);
  // The check's result (or the error) appears under the file: bring it into view.
  useEffect(() => {
    if (state) resultRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [state]);

  const choose = (f: File | undefined) => {
    setFileError(null);
    setLeave(new Set()); setActivate(new Set()); setHide(new Set());
    if (!f) { setFile(null); return; }
    if (f.size > BRANCH_FILE_MAX_BYTES) { setFile(null); setFileError("The file is larger than 5 MB."); return; }
    setFile(f);
    // Rows: every non-blank line, less a header row when the file has one (the MyLoans dump has none).
    void f.text().then((t) => { const ls = t.split(/\r?\n/).filter((l) => l.trim()); setRows(Math.max(0, ls.length - (/division/i.test(ls[0] ?? "") ? 1 : 0))); });
  };
  const toggle = (set: Set<string>, upd: (s: Set<string>) => void, code: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(code); else n.delete(code);
    upd(n);
  };
  const submit = (step: "check" | "confirm") => {
    if (!file) { setFileError("Choose the MyLoans branch file first."); return; }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("step", step);
    if (step === "confirm" && preview) {
      fd.set("fingerprint", preview.fingerprint);
      for (const c of leave) fd.append("leave", c);
      for (const c of activate) fd.append("activate", c);
      for (const c of hide) fd.append("hide", c);
    }
    startTransition(() => action(fd)); // inside a transition, so pending shows
  };
  const items = preview?.diff.items ?? [];
  const shown = items.filter((i) => showUnchanged || i.status !== "unchanged");

  return (
    <div className="flex flex-col gap-5" data-myloans-import data-unsaved-import={file && !done ? "true" : "false"}>
      <section aria-labelledby="mli-1" className="flex flex-col gap-2">
        <h3 id="mli-1" className="text-base font-bold text-navy">1. The MyLoans branch file</h3>
        <p className="text-sm text-ink-2">
          Either the tab-separated list exactly as MyLoans gives it (no header; columns division_id, division, area_id, area, branch_id, branch_code, an unknown column that is skipped, branch_name, address), or a CSV with a header row:
          <span className="mono"> division_id, division, area_id, area, branch_id, code, name, address</span>, optional <span className="mono">is_active</span> and <span className="mono">updated_at</span>.
          Rows are matched by the MyLoans ids, the code only when there is no id. A row without a status is Active. Nothing is deleted.
        </p>
        <a href="/api/settings/branches-template" download className="btn-ghost self-start">Download template</a>
      </section>

      <section aria-labelledby="mli-2" className="flex flex-col gap-3">
        <h3 id="mli-2" className="text-base font-bold text-navy">2. Check, then confirm</h3>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit("check"); }}>
          <label htmlFor="mli-file" className="label">MyLoans branch file (.csv, .tsv or .txt)</label>
          <FilePicker
            id="mli-file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" hint="A .csv, .tsv or .txt file, up to 5 MB."
            file={file ? { name: file.name, size: file.size, rows } : null}
            onPick={choose} onClear={() => choose(undefined)} disabled={pending}
            action={<button type="submit" className="btn-navy btn-sm" disabled={pending || !file}>{pending ? "Checking..." : "Check file"}</button>}
          />
        </form>
        {fileError && <p role="alert" className="text-sm text-bad-fg">{fileError}</p>}
        {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg" data-import-error>{state.error}</p>}
      </section>
      <div ref={resultRef} className="-mt-5 scroll-mt-4" aria-hidden="true" />

      {done && (
        <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-[15px] font-semibold text-ok-fg" data-import-done>
          Imported: {done.applied} applied, {done.left} left in the Branch review, {done.unchanged} unchanged, {done.missing} not in this file (in the Branch review, never deleted). {done.ms} ms.
          {done.problems.length > 0 && <span className="mt-1 block font-normal text-bad-fg">{done.problems.join(" ")}</span>}
        </p>
      )}

      {preview && !done && (
        <section aria-labelledby="mli-3" className="flex flex-col gap-4" data-import-preview>
          <h3 id="mli-3" className="text-base font-bold text-navy">3. What will happen ({preview.fileName})</h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-preview-counts>
            {([["New", preview.diff.counts.new], ["Changed", preview.diff.counts.changed], ["Unchanged", preview.diff.counts.unchanged], ["Not in this file", preview.diff.counts.missing], ["Look like test", preview.diff.counts.suggestions]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-fill px-3 py-2"><dt className="text-xs text-ink-2">{k}</dt><dd className="text-xl font-bold text-navy">{v}</dd></div>
            ))}
          </dl>
          {preview.problems.length > 0 && (
            <div role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg" data-preview-problems>
              <p className="font-semibold">{preview.problems.length} row{preview.problems.length === 1 ? "" : "s"} cannot be read and will be left out:</p>
              <ul className="mt-1 list-disc pl-5">{preview.problems.slice(0, 20).map((p) => <li key={p.line}>Line {p.line}: {p.message}</li>)}</ul>
            </div>
          )}
          {preview.diff.newGroups.length + preview.diff.renamedGroups.length > 0 && (
            <p className="text-sm" data-preview-groups>
              {preview.diff.newGroups.map((g) => `New ${g.key.startsWith("area") ? "area" : "division"}: ${g.name}`).concat(preview.diff.renamedGroups.map((g) => `${g.level === "area" ? "Area" : "Division"} renamed: ${g.was} -> ${g.name}`)).join(" · ")}
            </p>
          )}
          <details className="rounded-xl border border-line" data-preview-per-group>
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-navy">Branches per Division and Area ({preview.diff.perGroup.length})</summary>
            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead><tr><th scope="col">Division</th><th scope="col">Area</th><th scope="col">Branches</th><th scope="col">New</th><th scope="col">Changed</th></tr></thead>
                <tbody>{preview.diff.perGroup.map((g) => <tr key={`${g.division}|${g.area}`}><td>{g.division}</td><td>{g.area}</td><td>{g.total}</td><td>{g.new}</td><td>{g.changed}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
          {preview.impact.length > 0 && (
            <div className="rounded-xl bg-act-bg px-4 py-2.5 text-sm text-act-fg" data-preview-impact>
              <p className="font-semibold">Branch access changes for {preview.impact.length} {preview.impact.length === 1 ? "person" : "people"} (their Area or Division grants):</p>
              <ul className="mt-1 list-disc pl-5">{preview.impact.map((u) => <li key={u.name}>{u.name}: {u.gained ? `gains ${u.gained}` : ""}{u.gained && u.lost ? ", " : ""}{u.lost ? `loses ${u.lost}` : ""} branch{u.gained + u.lost === 1 ? "" : "es"}</li>)}</ul>
            </div>
          )}
          <label className="inline-flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" /> Show unchanged rows too
          </label>
          <ul className="divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line" data-preview-rows>
            {shown.slice(0, 500).map((i) => (
              <PreviewRow key={`${i.row.code}-${i.row.branchId ?? ""}`} i={i}
                leave={leave.has(i.row.code)} onLeave={(on) => toggle(leave, setLeave, i.row.code, on)}
                activate={activate.has(i.row.code)} onActivate={(on) => toggle(activate, setActivate, i.row.code, on)}
                hide={hide.has(i.row.code)} onHide={(on) => toggle(hide, setHide, i.row.code, on)} />
            ))}
            {preview.diff.missing.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-3" data-preview-missing>
                <span className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{b.name} {b.code && <span className="mono">({b.code})</span>}</span>
                <span className="chip c-bad h-6 text-xs">Not in this file</span>
                <span className="basis-full text-sm text-ink-2">Never deleted: it goes to the Branch review, where Admin decides whether to switch it off.</span>
              </li>
            ))}
            {shown.length === 0 && preview.diff.missing.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">Nothing changes: the DMS already matches this file.</li>}
            {shown.length > 500 && <li className="px-4 py-3 text-sm text-ink-2">And {shown.length - 500} more rows (all are imported).</li>}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" className="btn-gold" disabled={pending} onClick={() => submit("confirm")} data-confirm-import>
              {pending ? "Importing..." : `Confirm import (${preview.diff.counts.new + preview.diff.counts.changed - leave.size} to apply)`}
            </button>
            <p className="text-sm text-ink-2">Rows you leave for later and every &quot;Not in this file&quot; go to the Branch review. Preview took {preview.ms} ms.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewRow({ i, leave, onLeave, activate, onActivate, hide, onHide }: {
  i: DiffItem; leave: boolean; onLeave: (on: boolean) => void; activate: boolean; onActivate: (on: boolean) => void; hide: boolean; onHide: (on: boolean) => void;
}) {
  const id = `pv-${i.row.code}`;
  return (
    <li className={`flex flex-col gap-1.5 px-4 py-3 ${i.suggestHide ? "bg-act-bg/40" : ""}`} data-preview-row={i.status} data-code={i.row.code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{i.row.name} <span className="mono">({i.row.code})</span></span>
        <span className={`chip h-6 text-xs ${STATUS_TONE[i.status]}`}>{STATUS_TEXT[i.status]}</span>
        {i.status === "new" && !i.importActive && <span className="chip c-mute h-6 text-xs">Inactive</span>}
      </div>
      <p className="text-sm text-ink-2">{i.division.name} · {i.area.name}{i.row.address ? ` · ${i.row.address}` : ""}</p>
      {i.fields.length > 0 && <p className="text-sm">{i.fields.map((f) => `${f.label}: ${f.was} -> ${f.now}`).join("; ")}</p>}
      {i.suggestHide && <p className="text-sm font-semibold text-act-fg" data-test-note>{i.note}. Imported as Inactive unless you switch it on; you may also hide it from the DMS.</p>}
      {i.status !== "unchanged" && (
        <div className="flex flex-wrap gap-x-5">
          {i.status === "new" && !i.importActive && (
            <label htmlFor={`${id}-on`} className="inline-flex min-h-11 items-center gap-2 text-sm"><input id={`${id}-on`} type="checkbox" checked={activate} onChange={(e) => onActivate(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />Switch on (Active)</label>
          )}
          {i.suggestHide && (
            <label htmlFor={`${id}-hide`} className="inline-flex min-h-11 items-center gap-2 text-sm"><input id={`${id}-hide`} type="checkbox" checked={hide} onChange={(e) => onHide(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />Hide from DMS (suggested)</label>
          )}
          <label htmlFor={`${id}-leave`} className="inline-flex min-h-11 items-center gap-2 text-sm"><input id={`${id}-leave`} type="checkbox" checked={leave} onChange={(e) => onLeave(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />Leave for the Branch review</label>
        </div>
      )}
    </li>
  );
}

/** "Branches from MyLoans": reads the list through the MyLoans API now; differences go to the review. */
export function BranchSyncButton({ supported }: { supported: boolean }) {
  const [state, action, pending] = useActionState(branchSyncAction, null);
  return (
    <form action={action} className="flex flex-col gap-2" data-branch-sync>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Reading MyLoans..." : "Branches from MyLoans"}</button>
        <p className="text-sm text-ink-2">{supported ? "Reads the whole branch list through the MyLoans API. Every difference goes to the Branch review; nothing changes until Admin accepts." : "The MyLoans API has no branch list yet: use Import from MyLoans (a file). The button says so if pressed."}</p>
      </div>
      <Note state={state} />
    </form>
  );
}

export function BranchScheduleForm({ time, paused }: { time: string; paused: boolean }) {
  const [state, action, pending] = useActionState(branchScheduleAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" data-branch-schedule>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="bs-time" className="label">Daily at (PHT)</label>
          <input id="bs-time" name="time" type="time" defaultValue={time} className="input h-11 w-36" />
        </div>
        <label htmlFor="bs-paused" className="inline-flex min-h-11 items-center gap-3 text-[15px]">
          <input id="bs-paused" name="paused" type="checkbox" defaultChecked={paused} className="h-5 w-5 accent-[var(--navy)]" /> Pause the daily run
        </label>
        <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
      </div>
      <Note state={state} />
    </form>
  );
}

export interface ReviewItemView {
  id: string; kindLabel: string; title: string; fields: { label: string; was: string; now: string }[]; detected: string; source: string;
  pn: string | null; area: string | null; division: string | null; suggestHide: boolean; note: string | null; kind: string;
  linkable: { id: string; name: string; code: string | null }[];
}

/** One open Branch review item: Accept (after the impact preview), Ignore (optional note), Same branch. */
/** canDecide: Accept, Ignore and Same branch (branches:review). Without it the item is read only. */
export function ReviewItem({ r, canDecide = true }: { r: ReviewItemView; canDecide?: boolean }) {
  const [state, action, pending] = useActionState(reviewDecisionAction, null);
  const [impact, setImpact] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [checking, setChecking] = useState(false);
  const formId = `rv-accept-${r.id}`;
  useEffect(() => { if (state?.ok) window.dispatchEvent(new Event(SAVED_EVENT)); }, [state]);
  const ask = async () => {
    setChecking(true);
    const x = await reviewImpactAction(r.id);
    setChecking(false);
    setImpact(x.ok ? x.text : x.error);
    setAsking(true);
  };
  if (state?.ok) return <li className="px-4 py-3"><Note state={state} /></li>;
  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-review-item={r.kind} data-review-id={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip c-act h-6 text-xs">{r.kindLabel}</span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{r.title}</span>
        <span className="text-xs text-ink-2">{r.detected} · {r.source}</span>
      </div>
      {(r.division || r.area) && <p className="text-sm text-ink-2">{[r.division, r.area].filter(Boolean).join(" · ")}</p>}
      {r.fields.length > 0 && <ul className="text-sm">{r.fields.map((f) => <li key={f.label}>{f.label}: <span className="text-ink-2">{f.was}</span> -&gt; <span className="font-semibold">{f.now}</span></li>)}</ul>}
      {r.pn && <p className="text-sm">Seen in <span className="mono">{r.pn}</span>. The lookup went on; accepting adds a branch made in the DMS with this code (MyLoans fills the rest later).</p>}
      {r.note && <p className="text-sm text-act-fg">{r.note}</p>}
      {canDecide && <>
      <form id={formId} action={action} className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="cmd" value="accept" />
        {r.suggestHide && <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="hide" className="h-5 w-5 accent-[var(--navy)]" />Hide from DMS (suggested)</label>}
        {r.kind === "NEW_BRANCH" && r.suggestHide && <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="activate" className="h-5 w-5 accent-[var(--navy)]" />Switch on (Active)</label>}
      </form>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={ask} disabled={pending || checking} aria-label={`Accept ${r.kindLabel}: ${r.title}`}>{checking ? "Checking..." : "Accept"}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setIgnoring(!ignoring)} aria-expanded={ignoring} aria-label={`Ignore ${r.kindLabel}: ${r.title}`}>Ignore</button>
      </div>
      {ignoring && (
        <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="cmd" value="ignore" />
          <div className="min-w-0 flex-1"><label htmlFor={`rv-note-${r.id}`} className="label">Why (optional)</label><input id={`rv-note-${r.id}`} name="note" maxLength={300} className="input" /></div>
          <button type="submit" className="btn-ghost" disabled={pending}>Ignore it</button>
        </form>
      )}
      {r.linkable.length > 0 && (
        <form action={action} className="flex flex-col gap-2 rounded-xl bg-fill px-3 py-2 sm:flex-row sm:items-end" data-same-branch>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="cmd" value="link" />
          <div className="min-w-0 flex-1">
            <label htmlFor={`rv-link-${r.id}`} className="label">Same branch, code changed: it is</label>
            <select id={`rv-link-${r.id}`} name="branchId" className="input">{r.linkable.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code ?? "no code"})</option>)}</select>
          </div>
          <button type="submit" className="btn-ghost" disabled={pending}>Link them</button>
        </form>
      )}
      </>}
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg">{state.error}</p>}
      <ConfirmDialog open={asking && !state?.ok} title={`Accept: ${r.kindLabel}?`} body={<span data-review-impact>{impact}</span>} detail={r.title}
        confirmLabel="Accept and apply" cancelLabel="Not now" confirmForm={formId} pending={pending} onCancel={() => setAsking(false)} />
    </li>
  );
}

/** Hide from DMS (branches:manage or branches:review): not in pickers, trees, filters or counts; stays on old loans. */
export function HidePanel({ id, hidden, name }: { id: string; hidden: boolean; name: string }) {
  const [state, action, pending] = useActionState(branchHiddenAction, null);
  useEffect(() => { if (state?.ok) window.dispatchEvent(new Event(SAVED_EVENT)); }, [state]);
  return (
    <section aria-label="Hide from DMS" className="mt-4 rounded-xl border border-line p-4" data-hide-panel>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="hidden" value={hidden ? "false" : "true"} />
        <p className="min-w-0 flex-1 text-[15px]">
          <span className="font-semibold text-navy">Hide from DMS: </span>{hidden ? <span className="chip c-mute h-6 text-xs">Hidden</span> : <span className="text-ink-2">Shown</span>}
          <span className="mt-1 block text-sm text-ink-2">A hidden branch is not offered anywhere for new work and is left out of pickers, trees, filters and counts. Old loans keep it. It stays hidden after every import.</span>
        </p>
        <button type="submit" disabled={pending} className="btn-ghost btn-sm" aria-label={`${hidden ? "Show" : "Hide"} ${name}`}>{pending ? "Saving..." : hidden ? "Show in the DMS" : "Hide from DMS"}</button>
      </form>
      <Note state={state} />
    </section>
  );
}
