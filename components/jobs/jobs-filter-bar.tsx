"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FilterIcon, SearchIcon } from "@/components/ui/icons";
import { CHOICE_ROW, FilterCount, PILL, PILL_OFF, PILL_ON } from "@/components/ui/filter-pills";
import { FUNDS_KEYS, FUNDS_KEY_LABELS, JOB_STATUS_KEYS, JOB_STATUS_LABELS, jobListUrl, shownStatus, toggleStatus, type FundsKey, type JobFacets, type JobListParams, type JobSort, type JobStatusKey } from "@/lib/jobs/list";

const DEBOUNCE_MS = 450;

/**
 * D-064: the Jobs page's search and filters, the same as the Loans page's (D-059): one search box (part of the name,
 * part of the PN, the CIN; as you type after a short pause, and on Enter), status chips with counts in place of the
 * tabs (none chosen: To review and In process), and a Filters button (Transaction, Funds, Late only, Sort) whose
 * choices apply at once. Every change is a new address, so Back and a shared link show the same list.
 */
export function JobsFilterBar({ params: server, counts, types }: { params: JobListParams; counts: JobFacets; types: { code: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [params, setParams] = useState(server);
  const [text, setText] = useState(server.q);
  const serverKey = jobListUrl(server);
  const [seen, setSeen] = useState(serverKey);
  if (seen !== serverKey) { setSeen(serverKey); setParams(server); setText(server.q); }
  const latest = useRef(server);
  useEffect(() => { latest.current = server; }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef<number | null>(null);
  const go = (change: Partial<JobListParams>, replace = false) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setParams(next);
    const href = jobListUrl(next);
    start(() => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })));
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const onType = (v: string) => {
    setText(v);
    if (timer.current) window.clearTimeout(timer.current);
    const t = v.trim();
    if (t === latest.current.q || (t.length > 0 && t.length < 3)) return;
    timer.current = window.setTimeout(() => go({ q: t }, true), DEBOUNCE_MS);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timer.current) window.clearTimeout(timer.current);
    go({ q: text.trim() });
  };
  // With no tab chip in the address, To review and In process show as chosen (the default list).
  const toggle = (k: JobStatusKey) => go({ status: toggleStatus(latest.current.status, k) });
  const chosen = shownStatus(params.status);
  const anyFilter = params.status.length > 0 || !!params.type || !!params.funds || params.late;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-jobs-filters aria-busy={pending || undefined}>
      <form role="search" aria-label="Search jobs" onSubmit={submit} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap" data-jobs-search>
        <div className="relative flex h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-line-input bg-white px-3 focus-within:border-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy sm:h-11 sm:flex-1" data-search-box>
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <label htmlFor="find-job" className="sr-only">Search jobs</label>
          <input id="find-job" type="search" name="q" value={text} onChange={(e) => onType(e.target.value)} autoComplete="off" enterKeyHint="search"
            placeholder="Search PN or borrower" className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none sm:text-[15px]" />
        </div>
        <button type="submit" className="btn-navy h-11 min-h-11 w-full rounded-lg px-5 text-[15px] sm:w-auto" data-search-submit>Search</button>
      </form>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-3.5 sm:gap-y-2" data-filter-row>
        <div className="contents" role="group" aria-label="Status" data-filter="status">
          {JOB_STATUS_KEYS.map((k) => {
            const sel = chosen.includes(k);
            return (
              <button key={k} type="button" aria-pressed={sel} onClick={() => toggle(k)} className={`${PILL} ${sel ? PILL_ON : PILL_OFF}`} data-status-option={k}>
                {JOB_STATUS_LABELS[k]} <FilterCount n={counts.status[k]} on={sel} />
              </button>
            );
          })}
        </div>
        <MoreFilters params={params} counts={counts} types={types} go={go} />
        {anyFilter && <Link href={jobListUrl(params, { status: [], type: null, funds: null, late: false })} className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-navy underline underline-offset-2 sm:min-h-0" data-clear-filters>Clear filters</Link>}
      </div>
    </div>
  );
}

/**
 * Transaction, Funds, Late only and Sort in one "Filters" button (as the Loans page); each choice applies at once.
 * The panel opens to the right of the button (the button can wrap to the start of a line on a tablet).
 */
function MoreFilters({ params, counts, types, go }: { params: JobListParams; counts: JobFacets; types: { code: string; name: string }[]; go: (c: Partial<JobListParams>) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const on = (params.type ? 1 : 0) + (params.funds ? 1 : 0) + (params.late ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-expanded={open} aria-controls="job-filters" onClick={() => setOpen((v) => !v)}
        aria-label={on ? `Filters, ${on} on` : "Filters"} className={`${PILL} ${on ? "border-navy text-navy" : PILL_OFF}`} data-more-filters>
        <FilterIcon size={14} /> Filters
        {on > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1.5 text-[11px] font-bold text-white" data-filter-count>{on}</span>}
      </button>
      {open && (
        <div id="job-filters" className="absolute left-0 top-full z-40 mt-2 flex max-h-[70dvh] w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:w-auto" data-more-filters-panel>
          <label className="flex flex-col gap-1 text-sm font-semibold text-navy" data-filter="type">
            Transaction
            <select value={params.type ?? ""} onChange={(e) => go({ type: e.target.value || null })} className="input h-11 min-h-11 py-0 text-base font-normal sm:h-10 sm:min-h-10 sm:text-sm">
              <option value="">All transactions</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.name} ({counts.type[t.code] ?? 0})</option>)}
            </select>
          </label>
          <fieldset className="flex flex-col gap-0.5" data-filter="funds">
            <legend className="mb-1 text-sm font-semibold text-navy">Funds</legend>
            {([null, ...FUNDS_KEYS] as (FundsKey | null)[]).map((f) => {
              const sel = params.funds === f;
              return (
                <button key={f ?? "any"} type="button" aria-pressed={sel} onClick={() => go({ funds: f })} className={`${CHOICE_ROW} ${sel ? "bg-fill font-semibold text-navy" : "text-ink"}`} data-funds-option={f ?? "any"}>
                  <span>{f ? FUNDS_KEY_LABELS[f] : "Any"}</span>{f && <span className="tabular-nums text-ink-2" data-filter-n>{counts.funds[f]}</span>}
                </button>
              );
            })}
          </fieldset>
          <label className={`${CHOICE_ROW} cursor-pointer border-t border-line-soft pt-2`} data-filter="late">
            <span className="flex items-center gap-2"><input type="checkbox" checked={params.late} onChange={() => go({ late: !params.late })} className="h-5 w-5 accent-navy" /> Late only</span>
            <span className="tabular-nums text-ink-2" data-filter-n>{counts.late}</span>
          </label>
          <label className="flex flex-col gap-1 border-t border-line-soft pt-2 text-sm font-semibold text-navy" data-filter="sort">
            Sort
            <select value={`${params.sort}:${params.dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); go({ sort: s as JobSort, dir: d as "asc" | "desc" }); }} className="input h-11 min-h-11 py-0 text-base font-normal sm:h-10 sm:min-h-10 sm:text-sm">
              <option value="due:asc">Late first, then soonest due</option>
              <option value="borrower:asc">Borrower A to Z</option>
              <option value="borrower:desc">Borrower Z to A</option>
              <option value="branch:asc">Branch A to Z</option>
              <option value="branch:desc">Branch Z to A</option>
              <option value="due:desc">Latest due first</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
