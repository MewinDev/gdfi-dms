"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, LockIcon, SearchIcon } from "@/components/ui/icons";
import { summarize, summaryParts, type ListItem } from "@/lib/funds/list-view";

/**
 * The Funds page list: the on-page search, the one-line summary and the rows. One row per request; the
 * same row is a table row on a wide screen, a two-line row on a tablet and a card on a phone (CSS
 * container queries in globals.css, "Funds list"). The search filters the rows on the page only.
 */
const Ctx = createContext<{ query: string; setQuery: (q: string) => void; shown: Set<string>; items: ListItem[] } | null>(null);
const useList = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Funds list parts must sit inside <FundsList>.");
  return c;
};

export function FundsList({ items, children }: { items: ListItem[]; children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => summarize(items, { query }).keys, [items, query]);
  const value = useMemo(() => ({ query, setQuery, shown, items }), [query, shown, items]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** "2 requests · ₱7,000.00 total" for the rows shown (type filter and search applied). */
export function FundsSummary() {
  const { items, query } = useList();
  const s = summarize(items, { query });
  const p = summaryParts(s);
  return (
    <p className="text-[13px] text-ink-2" data-funds-summary aria-live="polite">
      <span className="font-semibold text-navy tabular-nums">{p.count}</span> {p.noun} · <span className="font-semibold text-navy tabular-nums">{p.total}</span> total
      {query.trim() && s.count < items.length ? <span> (of {items.length}, search applied)</span> : null}
    </p>
  );
}

export function FundsSearch() {
  const { query, setQuery } = useList();
  const id = useId();
  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor={id} className="sr-only">Search requests by request number, PN or borrower</label>
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
      <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Request no., PN or borrower" className="input min-h-10 pl-9 text-sm" data-funds-search autoComplete="off" />
    </div>
  );
}

/** Shown when the search hides every row of a tab that has rows. */
export function NoMatch() {
  const { query, shown, items } = useList();
  if (!query.trim() || shown.size > 0 || items.length === 0) return null;
  return <p className="card p-5 text-[15px] text-ink-2" role="status">No request matches &ldquo;{query.trim()}&rdquo;.</p>;
}

/**
 * One request. `cells` are server-rendered; `details` (receipts, history, the columns a tablet hides)
 * open with the row's Details toggle ("More" on a phone; on a tablet it also opens For and Asked by).
 * The row hides itself when the search does not match.
 */
export function FundsRow({ rowKey, attrs, cells, label }: {
  rowKey: string;
  attrs?: Record<string, string | undefined>;
  /** The request's name for the toggle's label ("CA-2026-0001"). */
  label: string;
  cells: { req: React.ReactNode; loan: React.ReactNode; forKind: React.ReactNode; trail?: React.ReactNode; asked: React.ReactNode; amount: React.ReactNode; status: React.ReactNode; action?: React.ReactNode; details?: React.ReactNode };
}) {
  const { shown } = useList();
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    // A link to the request (#CA-2026-0001) opens its details: on arrival and when the link is followed.
    const check = () => { if (decodeURIComponent(window.location.hash.slice(1)) === rowKey) setOpen(true); };
    const t = window.setTimeout(check, 0);
    window.addEventListener("hashchange", check);
    return () => { window.clearTimeout(t); window.removeEventListener("hashchange", check); };
  }, [rowKey]);
  return (
    <div role="row" id={rowKey} className="fl-row" data-open={open || undefined} data-extra={cells.details ? "" : undefined} hidden={!shown.has(rowKey)} {...attrs}>
      <div role="cell" className="fl-req">{cells.req}</div>
      <div role="cell" className="fl-loan"><span className="fl-lbl">Loan</span>{cells.loan}</div>
      <div role="cell" className="fl-for"><span className="fl-lbl">For</span>{cells.forKind}</div>
      {cells.trail !== undefined && <div role="cell" className="fl-trail">{cells.trail}</div>}
      <div role="cell" className="fl-asked"><span className="fl-lbl">Asked by</span>{cells.asked}</div>
      <div role="cell" className="fl-amt">{cells.amount}</div>
      <div role="cell" className="fl-status">{cells.status}</div>
      {cells.action != null && <div role="cell" className="fl-act">{cells.action}</div>}
      <div className="fl-tog">
        <button type="button" className="fl-tog-btn" aria-expanded={open} aria-controls={cells.details ? `${id}-d` : undefined} onClick={() => setOpen((o) => !o)} aria-label={`${open ? "Hide" : "Show"} details of ${label}`}>
          <span className="fl-tog-more">More</span><span className="fl-tog-details">Details</span>
          <ChevronDownIcon size={14} className={open ? "rotate-180" : ""} />
        </button>
      </div>
      {!!cells.details && (
        <div id={`${id}-d`} className="fl-extra" hidden={!open}>
          {cells.details}
        </div>
      )}
    </div>
  );
}

/** Three dots (the More button's icon). */
function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  );
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([type=hidden]), select, textarea";

/**
 * The extra actions of a row, behind a small three-dots button ("More actions"). The list opens in a
 * portal (so the table never clips it), right-aligned to the button and flipped upward near the bottom
 * of the screen; on a phone it is a bottom sheet. Arrow keys move between items, Esc closes it and puts
 * focus back on the dots. A Sheet opened from an item keeps the list open; when that Sheet closes, the
 * list closes too.
 */
export function MoreMenu({ label, groups }: { label: string; groups: React.ReactNode[][] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const [phone, setPhone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((focus = true) => { setOpen(false); setPos(null); if (focus) btn.current?.focus(); }, []);

  // Place the list: below the button, its right edge on the button's right edge; above when it does not fit.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const p = panel.current;
      if (!b || !p) return;
      const isPhone = window.matchMedia("(max-width: 37.4999rem)").matches;
      setPhone(isPhone);
      if (isPhone) { setPos({ top: 0, left: 0, up: false }); return; }
      const h = p.offsetHeight, w = p.offsetWidth;
      const up = b.bottom + 4 + h > window.innerHeight - 8 && b.top - 4 - h > 8;
      setPos({ top: up ? b.top - 4 - h : b.bottom + 4, left: Math.max(8, b.right - w), up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const p = panel.current;
    const busy = () => !!p?.querySelector("dialog[open]");
    p?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!busy() && !p?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy()) { e.preventDefault(); close(); } };
    // A Sheet opened from an item: when it closes, the list closes too.
    let wasBusy = false;
    const mo = new MutationObserver(() => { const b = busy(); if (wasBusy && !b) close(); wasBusy = b; });
    if (p) mo.observe(p, { subtree: true, attributes: true, attributeFilter: ["open"] });
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { mo.disconnect(); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => !el.closest("dialog"));
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <button ref={btn} type="button" className="fl-dots" aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="true" onClick={() => (open ? close() : setOpen(true))} aria-label="More actions" title={`More actions for ${label}`} data-more-button>
        <DotsIcon /><span className="fl-dots-text">More</span>
      </button>
      {open && createPortal(
        <>
          {phone && <div className="fl-menu-backdrop" onMouseDown={() => close()} aria-hidden="true" />}
          <div
            ref={panel} id={id} role="group" aria-label={`More actions for ${label}`} onKeyDown={onPanelKey}
            className={`fl-menu ${phone ? "fl-menu-sheet" : ""}`} data-more-menu data-flipped={pos?.up || undefined}
            style={phone ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {groups.filter((g) => g.length).map((g, i) => <div key={i} className="fl-menu-group">{g}</div>)}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** A lock in the Action cell with the reason the person cannot act on this one row (hover or keyboard focus shows it). */
export function LockNote({ reason }: { reason: string }) {
  return (
    <span className="fl-lock group" tabIndex={0} role="note" aria-label={reason} data-row-lock>
      <LockIcon size={16} />
      <span className="fl-lock-tip" aria-hidden>{reason}</span>
    </span>
  );
}

/** Keeps the selected tab in view when the tab strip scrolls sideways (phone). */
export function KeepTabInView() {
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-funds-tabs] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" as ScrollBehavior });
  }, []);
  return null;
}
