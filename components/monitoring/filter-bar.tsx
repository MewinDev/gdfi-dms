"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilterIcon, XIcon } from "@/components/ui/icons";
import type { Preset } from "@/lib/monitoring/rules";
import { DateRangeButton } from "./date-range";

/**
 * The filters at the top of Monitoring, kept in the URL (a GET form): the date range (its own button and
 * popover), area, branch ("Name (code)"), transaction type, and in the By day view one processor or office.
 * Desktop: one row; 820: two rows; phone: the date range stays visible next to a Filters button (with a
 * count) that opens the other filters in a bottom sheet. Apply is the only gold button; Reset shows only
 * when a filter is not at its default.
 */
export function FilterBar(p: {
  tab: "dp" | "lto";
  view: "totals" | "day";
  preset: Preset;
  from: string;
  to: string;
  today: string;
  holidays: string[];
  area: string;
  branch: string;
  type: string;
  areas: { id: string; name: string }[];
  branches: { id: string; name: string; areaId: string | null }[];
  types: { code: string; name: string }[];
  /** By day: processors or offices to pick one of. */
  who: { name: "dp" | "office"; label: string; value: string; options: { id: string; name: string }[] } | null;
  /** The other query parts to keep when the date range is applied. */
  keep: Record<string, string>;
  /** Where Reset goes (the same tab and view, every filter at its default); null when nothing to reset. */
  resetHref: string | null;
}) {
  const [area, setArea] = useState(p.area);
  const [sheet, setSheet] = useState(false);
  // The branch list follows the Area picked (a branch of another area is not offered).
  const branches = area ? p.branches.filter((b) => b.areaId === area) : p.branches;
  const count = [p.area, p.branch, p.type, p.who?.value ?? ""].filter(Boolean).length;
  useEffect(() => {
    if (!sheet) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sheet]);

  const field = "flex min-w-0 flex-col gap-1 sm:w-[calc(50%-4px)] md:w-auto md:min-w-[150px] md:flex-1 lg:w-52 lg:flex-none";
  return (
    <form action="/monitoring" className="flex flex-wrap items-end gap-2" data-filters>
      <input type="hidden" name="tab" value={p.tab} />
      {p.view === "day" && <input type="hidden" name="view" value="day" />}
      <div className="flex w-full items-end gap-2 lg:w-auto">
        <div className="min-w-0 flex-1 sm:flex-none">
          <span className="label hidden sm:block">Dates</span>
          <DateRangeButton preset={p.preset} from={p.from} to={p.to} today={p.today} holidays={p.holidays} keep={p.keep} />
        </div>
        <button type="button" onClick={() => setSheet(true)} className="relative inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-input bg-white px-3.5 text-[14px] font-semibold text-navy sm:hidden" aria-haspopup="dialog" aria-expanded={sheet} data-filters-button>
          <FilterIcon size={18} /> Filters
          {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[12px] font-bold text-navy" data-filter-count>{count}<span className="sr-only"> on</span></span>}
        </button>
      </div>
      {sheet && <div className="fixed inset-0 z-40 bg-navy/40 sm:hidden" onClick={() => setSheet(false)} aria-hidden="true" />}
      <div
        role={sheet ? "dialog" : undefined} aria-label={sheet ? "Filters" : undefined} aria-modal={sheet ? true : undefined}
        className={`${sheet ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-line bg-white p-4 shadow-xl" : "hidden"} sm:static sm:z-auto sm:flex sm:max-h-none sm:flex-1 sm:flex-row sm:flex-wrap sm:items-end sm:gap-2 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
        data-filters-sheet
      >
        {sheet && (
          <div className="flex items-center justify-between sm:hidden">
            <h2 className="text-lg font-bold text-navy">Filters</h2>
            <button type="button" onClick={() => setSheet(false)} className="-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2" aria-label="Close"><XIcon /></button>
          </div>
        )}
        <div className={field}>
          <label htmlFor="mf-area" className="label">Area</label>
          <select id="mf-area" name="area" className="input" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All</option>
            {p.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="mf-branch" className="label">Branch</label>
          <select key={area} id="mf-branch" name="branch" className="input" defaultValue={branches.some((b) => b.id === p.branch) ? p.branch : ""}>
            <option value="">All</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="mf-type" className="label">Transaction</label>
          <select id="mf-type" name="type" className="input" defaultValue={p.type}>
            <option value="">All</option>
            {p.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
        {p.who && (
          <div className={field}>
            <label htmlFor="mf-who" className="label">{p.who.label}</label>
            <select id="mf-who" name={p.who.name} className="input" defaultValue={p.who.value}>
              <option value="">All, by group</option>
              {p.who.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-gold min-h-11 flex-1 sm:flex-none">Apply</button>
          {p.resetHref && <Link href={p.resetHref} className="inline-flex min-h-11 items-center text-[14px] font-medium text-ink-2 hover:text-navy hover:underline" data-reset>Reset</Link>}
        </div>
      </div>
    </form>
  );
}
