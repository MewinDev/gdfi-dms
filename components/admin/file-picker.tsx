"use client";

import { useRef, useState } from "react";
import { FileTextIcon, XIcon } from "@/components/ui/icons";

export interface PickedFile { name: string; size: number; rows: number }

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`);

/**
 * Choosing a file for an import (Settings, Import / Export and Branches, Import from MyLoans). Before a
 * file: one compact drop row with "Choose file". After: a card with the file's name, size and row count,
 * Change and Remove, and the check button beside it, so the chosen file is always in view next to what
 * to do with it. The real <input type="file"> stays in the page (screen readers and tests use it).
 */
export function FilePicker({ id, accept, hint, file, onPick, onClear, action, disabled }: {
  id: string;
  accept: string;
  /** What files are taken ("A .csv file, up to 2 MB"). */
  hint: string;
  file: PickedFile | null;
  onPick: (f: File | undefined) => void;
  onClear: () => void;
  /** The button next to the file (Check file). */
  action: React.ReactNode;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => { onPick(f); if (input.current) input.current.value = ""; };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
      className={`rounded-xl border p-3 transition-colors motion-reduce:transition-none ${file ? "border-line bg-white" : "border-dashed border-line-input"} ${drag ? "border-navy bg-fill" : ""}`}
      data-file-picker={file ? "chosen" : "empty"}
    >
      <input ref={input} id={id} type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={disabled} />
      {file ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fill text-navy" aria-hidden="true"><FileTextIcon size={20} /></span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink" title={file.name} data-chosen-file>{file.name}</p>
              <p className="text-[13px] text-ink-2">{kb(file.size)} · {file.rows.toLocaleString("en-PH")} row{file.rows === 1 ? "" : "s"} after the header</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className="btn-ghost btn-sm cursor-pointer">Change</label>
            <button type="button" className="btn-ghost btn-sm" onClick={onClear} aria-label={`Remove ${file.name}`}><XIcon size={16} /> Remove</button>
            {action}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <label htmlFor={id} className="btn-secondary btn-sm cursor-pointer"><FileTextIcon size={16} /> Choose file</label>
          <p className="text-[13px] text-ink-2">or drop it here. {hint}</p>
        </div>
      )}
    </div>
  );
}

/** Rows after the header line (blank lines at the end not counted). */
export const dataRows = (text: string) => Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1);
