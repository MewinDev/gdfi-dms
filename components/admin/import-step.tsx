"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { importAction, type ImportState } from "@/app/actions/admin";
import { IMPORT_LISTS, MAX_BYTES, MAX_ROWS, dataFileName, templateFileName, type ImportListKey } from "@/lib/import/columns";
import { SAVED_EVENT } from "./settings-modal";

const REQUIRED = { yes: "Yes", new: "For new rows", no: "No" } as const;
const ACTION_TEXT = { new: "New", changed: "Changed", unchanged: "Unchanged", problem: "Problem" } as const;
const ACTION_TONE = { new: "c-ok", changed: "c-act", unchanged: "c-mute", problem: "c-bad" } as const;

/**
 * Import / Export, the second step inside a list's window. A: download the template or the
 * current data. B: how to import (the column table comes from lib/import/columns.ts, the same
 * definition the importer uses). C: choose a file, Check file (nothing saved), then Import.
 */
export function ImportStep({ list }: { list: ImportListKey }) {
  const def = IMPORT_LISTS[list];
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A result belongs to the file it was made for; choosing another file hides it until checked.
  const result = state?.ok && (state.imported || state.plan.fileName === file?.name) ? state : null;

  useEffect(() => {
    if (state?.ok && state.imported) window.dispatchEvent(new Event(SAVED_EVENT));
  }, [state]);

  async function choose(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setFile(null); setFileError("Choose a .csv file. In Excel use File > Save As > CSV (Comma delimited)."); return; }
    if (f.size > MAX_BYTES) { setFile(null); setFileError("The file is larger than 2 MB. Split it into smaller files."); return; }
    setFile({ name: f.name, text: await f.text() });
  }

  const base = `/api/settings/csv?list=${list}`;
  const imported = result?.imported ? result.plan.counts : null;
  const canImport = !!result && !result.imported && result.plan.counts.new + result.plan.counts.changed > 0;

  return (
    // A chosen (or checked) file that is not imported yet counts as unsaved: leaving asks first.
    <div className="flex flex-col gap-6" data-unsaved-import={file && !(state?.ok && state.imported) ? "true" : "false"}>
      {/* A. Download */}
      <section aria-labelledby="imp-download" className="flex flex-col gap-3">
        <h3 id="imp-download" className="text-base font-bold text-navy">1. Download</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href={`${base}&mode=template`} download={templateFileName(list)} className="btn-ghost">Download template</a>
          <a href={`${base}&mode=data`} download={dataFileName(list)} className="btn-ghost">Download current data</a>
        </div>
        <p className="text-sm text-ink-2">The template has the column names and 2 example rows. Current data has the same columns filled with what is in the system now, so you can edit it and import it back.</p>
      </section>

      {/* B. How to import */}
      <section aria-labelledby="imp-how" className="flex flex-col gap-3">
        <h3 id="imp-how" className="text-base font-bold text-navy">2. How to import</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px]">
          <li>Download the template.</li>
          <li>Open it in Excel. Keep the first row. Delete the example rows.</li>
          <li>Fill one row per item, using the columns below.</li>
          <li>Save as CSV (Comma delimited) and choose it below.</li>
          <li>Press <strong>Check file</strong>. You will see what will happen. Nothing is saved yet.</li>
          <li>If it looks right, press <strong>Import</strong>.</li>
        </ol>
        <p className="text-sm text-ink-2">{def.keyHelp}</p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="table text-sm" aria-label="Columns">
            <thead><tr><th scope="col">Column</th><th scope="col">What to type</th><th scope="col">Required?</th><th scope="col">Allowed values</th><th scope="col">Example</th></tr></thead>
            <tbody>
              {def.columns.map((c) => (
                <tr key={c.name}>
                  <td className="mono whitespace-nowrap font-semibold">{c.name}</td>
                  <td className="min-w-48">{c.what}</td>
                  <td className="whitespace-nowrap">{REQUIRED[c.required]}</td>
                  <td className="min-w-40">{c.allowed}</td>
                  <td className="mono whitespace-nowrap">{c.example || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Do not change the column names.</li>
          <li>Dates are YYYY-MM-DD.</li>
          <li>Yes/No columns accept Yes or No.</li>
          <li>To make something inactive, set Status to Inactive. Rows are never deleted.</li>
          <li>At most {MAX_ROWS.toLocaleString("en-PH")} rows and 2 MB per file. Text that starts with = + - or @ is refused.</li>
        </ul>
      </section>

      {/* C. Upload and check */}
      <section aria-labelledby="imp-upload" className="flex flex-col gap-3">
        <h3 id="imp-upload" className="text-base font-bold text-navy">3. Choose a file and check it</h3>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]); }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 text-center ${drag ? "border-navy bg-fill" : "border-line-input"}`}
        >
          <p className="text-[15px]">{file ? <>Chosen: <strong>{file.name}</strong></> : "Drop a .csv file here, or"}</p>
          <label htmlFor={`import-file-${list}`} className="btn-ghost btn-sm cursor-pointer">{file ? "Choose another file" : "Choose file"}</label>
          <input
            ref={inputRef} id={`import-file-${list}`} type="file" accept=".csv,text/csv" className="sr-only"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </div>
        {fileError && <p role="alert" className="text-sm text-bad-fg">{fileError}</p>}

        <form action={action} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="fileName" value={file?.name ?? ""} />
          <input type="hidden" name="text" value={file?.text ?? ""} />
          <input type="hidden" name="step" value="check" />
          <button type="submit" disabled={!file || pending} className="btn-navy">{pending ? "Working..." : "Check file"}</button>
        </form>

        {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-[15px] text-bad-fg">{state.error}</p>}

        {imported && (
          <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-[15px] font-semibold text-ok-fg">
            Imported {imported.new} new and {imported.changed} updated.{imported.problem ? ` ${imported.problem} row${imported.problem === 1 ? " was" : "s were"} skipped.` : ""}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-[15px] font-semibold text-navy">
              {result.imported ? "Result: " : ""}{result.plan.counts.new} new, {result.plan.counts.changed} changed, {result.plan.counts.unchanged} unchanged, {result.plan.counts.problem} with problems
            </p>
            {!result.imported && result.plan.counts.problem > 0 && (
              <p className="rounded-xl bg-cream px-4 py-3 text-sm">
                Rows with problems are skipped. You can import the other rows now, or fix the file and check it again.
              </p>
            )}
            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="table text-sm" aria-label="Preview">
                <thead><tr><th scope="col">Row</th><th scope="col">Item</th><th scope="col">What will happen</th></tr></thead>
                <tbody>
                  {result.plan.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="tabular-nums">{r.line}</td>
                      <td className="mono whitespace-nowrap">{def.keyColumns.map((k) => r.cells[k]).filter(Boolean).join(" · ") || "-"}</td>
                      <td>
                        <span className={`chip h-6 text-xs ${ACTION_TONE[r.action]}`}>{ACTION_TEXT[r.action]}</span>
                        {r.changes.length > 0 && <span className="ml-2 text-ink-2">{r.changes.join(", ")}</span>}
                        {r.problems.map((p) => <p key={p} className="mt-1 text-bad-fg">{p}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canImport && file && (
              <form action={action}>
                <input type="hidden" name="list" value={list} />
                <input type="hidden" name="fileName" value={file.name} />
                <input type="hidden" name="text" value={file.text} />
                <input type="hidden" name="step" value="import" />
                <button type="submit" disabled={pending} className="btn-gold w-full sm:w-auto">
                  {pending ? "Importing..." : `Import ${result.plan.counts.new + result.plan.counts.changed} row${result.plan.counts.new + result.plan.counts.changed === 1 ? "" : "s"}`}
                </button>
              </form>
            )}
            {!result.imported && !canImport && <p className="text-sm text-ink-2">Nothing to import: no new or changed rows.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
