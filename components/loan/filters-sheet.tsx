"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FilterIcon } from "@/components/ui/icons";

export interface FilterField {
  name: string;
  label: string;
  value?: string;
  options: [string, string][];
}

/** "Filters" button that opens a side panel (desktop) or bottom sheet (phone) with a GET form. */
export function FiltersSheet({ tab, q, fields, activeCount }: { tab: string; q?: string; fields: FilterField[]; activeCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <FilterIcon size={18} /> Filters{activeCount ? <span className="chip c-act h-6 text-xs">{activeCount}</span> : null}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filters" side>
        <form method="get" action="/loans" className="flex flex-col gap-4">
          <input type="hidden" name="tab" value={tab} />
          {q && <input type="hidden" name="q" value={q} />}
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={`f-${f.name}`} className="label">{f.label}</label>
              <select id={`f-${f.name}`} name={f.name} defaultValue={f.value ?? ""} className="input">
                <option value="">Any</option>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button type="submit" className="btn-navy btn-lg flex-1">Show loans</button>
            <a href={`/loans?tab=${tab}`} className="btn-ghost btn-lg flex-1">Clear filters</a>
          </div>
        </form>
      </Sheet>
    </>
  );
}
