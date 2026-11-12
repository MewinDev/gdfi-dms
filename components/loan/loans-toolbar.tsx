"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { countLoansAction } from "@/app/actions/loan";
import { FilterIcon, SearchIcon, XIcon } from "@/components/ui/icons";
import { LiveFindInput } from "@/components/ui/live-find-input";
import type { FilterField } from "@/lib/ui/loan-filters";

/**
 * Loans toolbar: one row with the search (PN, CIN or CIF; "/" focuses it), one Filters button with a
 * count, and Export CSV where allowed. Filters open as a popover under the button on desktop and as
 * a bottom sheet on tablet and phone. Esc or a click outside closes it without changing anything.
 */
export function LoansToolbar({
  search, filters, resultCount,
}: {
  search: { action: string; defaultValue?: string; autoFocus?: boolean; hidden?: Record<string, string | undefined>; buttonLabel?: string; required?: boolean; suggest?: boolean };
  filters: { fields: FilterField[]; hidden: Record<string, string | undefined>; activeCount: number; clearHref: string };
  /** Loan files the current filters show (the panel starts from this). */
  resultCount: number;
}) {
  return (
    <div className="flex items-center gap-2" data-loans-toolbar>
      <form action={search.action} method="get" role="search" aria-label="Search" className="min-w-0 flex-1">
        {Object.entries(search.hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {/* One 40px row: the box with its button inside the right end (32px). */}
        <div className="flex h-10 items-center gap-2 rounded-lg border border-line-input bg-white pl-3 pr-1 focus-within:border-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy" data-search-box>
          <span className="text-ink-2"><SearchIcon size={16} /></span>
          <label htmlFor="find-loan" className="sr-only">Find a loan</label>
          {search.suggest ? (
            <LiveFindInput
              defaultValue={search.defaultValue} autoFocus={search.autoFocus} required={search.required ?? true}
              placeholder="PN, borrower name, CIN or CIF"
              className="h-9 w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none"
            />
          ) : (
            <input
              id="find-loan" name="q" defaultValue={search.defaultValue} autoFocus={search.autoFocus} required={search.required ?? true} autoComplete="off"
              placeholder="Search by PN, CIN or CIF"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none"
            />
          )}
          <button type="submit" className="btn-navy h-8 min-h-8 shrink-0 rounded-md px-3 text-[13px]">{search.buttonLabel ?? "Search"}</button>
        </div>
      </form>
      <FiltersButton {...filters} resultCount={resultCount} />
    </div>
  );
}

function FiltersButton({ fields, hidden, activeCount, clearHref, resultCount }: { fields: FilterField[]; hidden: Record<string, string | undefined>; activeCount: number; clearHref: string; resultCount: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"closed" | "popover" | "sheet">("closed");
  const [count, setCount] = useState<number>(resultCount);
  const [, startCount] = useTransition();

  const close = () => {
    form.current?.reset(); // nothing changes unless "Show results" is pressed
    setCount(resultCount);
    dlg.current?.close();
    setMode("closed");
    btn.current?.focus();
  };
  const open = () => {
    const d = dlg.current;
    if (!d) return;
    if (window.matchMedia("(min-width: 1024px)").matches) { d.show(); setMode("popover"); }
    else { d.showModal(); setMode("sheet"); }
    window.setTimeout(() => d.querySelector<HTMLElement>("select")?.focus(), 0);
  };

  // Popover: a click outside closes it.
  useEffect(() => {
    if (mode !== "popover") return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });

  const recount = () => {
    if (!form.current) return;
    const fd = new FormData(form.current);
    startCount(async () => { const n = await countLoansAction(fd); if (n !== null) setCount(n); });
  };

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={btn} type="button" onClick={() => (mode === "closed" ? open() : close())} aria-haspopup="dialog" aria-expanded={mode !== "closed"}
        aria-label={activeCount ? `Filters, ${activeCount} on` : "Filters"}
        className="btn-ghost h-10 min-h-10 gap-2 rounded-lg px-2.5 text-sm max-sm:min-w-11 sm:px-3.5"
      >
        <FilterIcon size={18} />
        <span className="hidden sm:inline">Filters</span>
        {activeCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1.5 text-[11px] font-bold text-white" data-filter-count>{activeCount}</span>}
      </button>
      <dialog
        ref={dlg}
        aria-labelledby="filters-title"
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
        onCancel={(e) => { e.preventDefault(); close(); }}
        onClick={(e) => { if (e.target === dlg.current) close(); }}
        className={
          mode === "popover"
            ? "absolute right-0 left-auto top-full z-40 m-0 mt-2 w-[420px] rounded-2xl border border-line bg-white p-0 text-ink shadow-xl"
            : "mb-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl border border-line bg-white p-0 text-ink backdrop:bg-navy/40"
        }
      >
        <form ref={form} method="get" action="/loans" onChange={recount} className="flex max-h-[inherit] flex-col">
          {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <h2 id="filters-title" className="text-lg font-bold text-navy">Filters</h2>
            <button type="button" onClick={close} aria-label="Close filters" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:bg-fill"><XIcon size={20} /></button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-5 pb-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.name}>
                <label htmlFor={`flt-${f.name}`} className="label">{f.label}</label>
                <select id={`flt-${f.name}`} name={f.name} defaultValue={f.value ?? ""} className="input">
                  <option value="">Any</option>
                  {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-white px-5 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <a href={clearHref} className="link inline-flex min-h-11 items-center text-sm">Clear all</a>
            <button type="submit" className="btn-navy ml-auto">Show results ({count})</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
