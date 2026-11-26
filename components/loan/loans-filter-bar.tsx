"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FilterIcon, SearchIcon } from "@/components/ui/icons";
import { listUrl, STATUS_KEYS, STATUS_LABELS, type FacetCounts, type LoanListParams, type StatusKey, type WithKey } from "@/lib/ui/loan-list";

/** The one placeholder of the loan search box. */
export const SEARCH_PLACEHOLDER = "Search PN, name or CIN";
const DEBOUNCE_MS = 450;

/**
 * D-059: the Loans page's search and filters, in place of the tabs. Every change is a new address (the server
 * filters, counts and pages), so Back and a shared link show the same list. The search runs as you type (after a
 * short pause, from 3 characters) and on Enter or Search; a full PN not in the DMS is looked up in myloans by the
 * server. Each filter option shows how many loans it would show. The status chips and a Filters button (Branch,
 * With, Late only) share one row.
 */
export function LoansFilterBar({ params: server, counts, branches, autoFocus }: {
  params: LoanListParams;
  counts: FacetCounts;
  branches: { id: string; name: string }[];
  autoFocus: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // The choices shown: the address's, updated at once on each click (so quick clicks build on each other before
  // the new page arrives), and set back to the address's whenever a new one arrives (Back, a link, Find loan).
  const [params, setParams] = useState(server);
  const [text, setText] = useState(server.q);
  const serverKey = listUrl(server, { page: server.page });
  const [seen, setSeen] = useState(serverKey);
  // The address of the last click. While it is still loading, a page from an earlier click that arrives late is
  // not taken as the choice (it would undo the newer clicks); Back, a link or the last page are.
  const [pushed, setPushed] = useState<string | null>(null);
  const stale = pending && pushed !== null && serverKey !== pushed;
  if (seen !== serverKey) {
    setSeen(serverKey);
    if (!stale) { setParams(server); setText(server.q); setPushed(null); }
  }
  const latest = useRef(server);
  useEffect(() => { if (!stale) latest.current = server; }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef<number | null>(null);
  const go = (change: Partial<LoanListParams>, replace = false) => {
    const next = { ...latest.current, ...change, page: 1 };
    latest.current = next;
    setParams(next);
    const href = listUrl(next);
    setPushed(listUrl(next, { page: 1 }));
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

  const toggleStatus = (k: StatusKey) => {
    const cur = latest.current.status;
    go({ status: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
  };
  const anyFilter = params.status.length > 0 || !!params.branch || !!params.with || params.late;
  // Compact (the user's review): 30px pills; on a phone an invisible margin keeps the tap area 44px tall.
  const pill = "relative inline-flex h-[30px] items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium before:absolute before:-inset-y-[7px] before:inset-x-0 before:content-[''] sm:before:hidden";
  const on = "border-navy bg-navy text-white";
  const off = "border-line-input bg-white text-ink hover:bg-fill";
  const n = (x: number, sel: boolean) => <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${sel ? "bg-white/20 text-white" : "bg-fill text-ink-2"}`} data-filter-n>{x}</span>;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-loans-filters aria-busy={pending || undefined}>
      <form role="search" aria-label="Search loans" onSubmit={submit} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap" data-loans-search>
        <div className="relative flex h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-line-input bg-white px-3 focus-within:border-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy sm:h-11 sm:flex-1" data-search-box>
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <label htmlFor="find-loan" className="sr-only">Search loans</label>
          <input id="find-loan" type="search" name="q" value={text} onChange={(e) => onType(e.target.value)} autoFocus={autoFocus} autoComplete="off" enterKeyHint="search"
            placeholder={SEARCH_PLACEHOLDER} className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none sm:text-[15px]" />
        </div>
        <button type="submit" className="btn-navy h-11 min-h-11 w-full rounded-lg px-5 text-[15px] sm:w-auto" data-search-submit>Search</button>
      </form>

      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-3.5 sm:gap-y-2" data-filter-row>
        <div className="contents" role="group" aria-label="Status" data-filter="status">
          {STATUS_KEYS.map((k) => {
            const sel = params.status.includes(k);
            return (
              <button key={k} type="button" aria-pressed={sel} onClick={() => toggleStatus(k)} className={`${pill} ${sel ? on : off}`} data-status-option={k}>
                {STATUS_LABELS[k]} {n(counts.status[k], sel)}
              </button>
            );
          })}
        </div>
        <MoreFilters params={params} counts={counts} branches={branches} go={go} pill={pill} />
        {anyFilter && <Link href={listUrl(params, { status: [], branch: null, with: null, late: false })} className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-navy underline underline-offset-2 sm:min-h-0" data-clear-filters>Clear filters</Link>}
      </div>
    </div>
  );
}

/**
 * Branch, With and Late only, in one "Filters" button at the end of the status row (the user's review, 25 November
 * 2026). It opens a small panel under the button; each choice applies at once (a new address). Esc or a click
 * outside closes it. The button shows how many of the three are on.
 */
function MoreFilters({ params, counts, branches, go, pill }: {
  params: LoanListParams; counts: FacetCounts; branches: { id: string; name: string }[]; go: (change: Partial<LoanListParams>) => void; pill: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const on = (params.branch ? 1 : 0) + (params.with ? 1 : 0) + (params.late ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const choice = "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm hover:bg-fill sm:min-h-9";
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-expanded={open} aria-controls="more-filters" onClick={() => setOpen((v) => !v)}
        aria-label={on ? `Filters, ${on} on` : "Filters"} className={`${pill} ${on ? "border-navy text-navy" : "border-line-input bg-white text-ink hover:bg-fill"}`} data-more-filters>
        <FilterIcon size={14} /> Filters
        {on > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1.5 text-[11px] font-bold text-white" data-filter-count>{on}</span>}
      </button>
      {open && (
        <div id="more-filters" className="absolute right-0 top-full z-40 mt-2 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:w-auto" data-more-filters-panel>
          <label className="flex flex-col gap-1 text-sm font-semibold text-navy" data-filter="branch">
            Branch
            <select value={params.branch ?? ""} onChange={(e) => go({ branch: e.target.value || null })} className="input h-11 min-h-11 py-0 text-base font-normal sm:h-10 sm:min-h-10 sm:text-sm">
              <option value="">All my branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({counts.branch[b.id] ?? 0})</option>)}
            </select>
          </label>
          <fieldset className="flex flex-col gap-0.5" data-filter="with">
            <legend className="mb-1 text-sm font-semibold text-navy">Assigned to</legend>
            {([[null, "Anyone", counts.with.any], ["me", "Me", counts.with.me], ["pool", "Branch pool", counts.with.pool]] as const).map(([w, label, x]) => {
              const sel = params.with === w;
              return (
                <button key={label} type="button" aria-pressed={sel} onClick={() => go({ with: w as WithKey | null })} className={`${choice} ${sel ? "bg-fill font-semibold text-navy" : "text-ink"}`} data-with-option={w ?? "any"}>
                  <span>{label}</span><span className="tabular-nums text-ink-2" data-filter-n>{x}</span>
                </button>
              );
            })}
          </fieldset>
          <label className={`${choice} cursor-pointer border-t border-line-soft pt-2`} data-filter="late">
            <span className="flex items-center gap-2"><input type="checkbox" checked={params.late} onChange={() => go({ late: !params.late })} className="h-5 w-5 accent-navy" /> Late only</span>
            <span className="tabular-nums text-ink-2" data-filter-n>{counts.late}</span>
          </label>
        </div>
      )}
    </div>
  );
}
