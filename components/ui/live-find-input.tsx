"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit { pn: string; borrowerName: string; stage: string }
type Result =
  | { kind: "hits"; hits: Hit[] }
  | { kind: "outside"; pn: string }
  | { kind: "unsaved"; pn: string }
  | { kind: "none" };

const MIN = 3;
const DEBOUNCE_MS = 150;
const OUTSIDE = "Outside your branches. You can only open loans of your branches.";
const UNSAVED = "Not opened in the DMS yet. Press Find loan to look it up in MyLoans.";

/**
 * The Find loan input with suggestions from the DMS only (typing never calls MyLoans): 150 ms after
 * typing stops, at least 3 characters, at most 8 loan files of the person's branches (PN, borrower,
 * stage, "In DMS"). A complete PN outside the person's branches says so; a complete PN not saved yet
 * gets one quiet hint (Find loan looks it up in MyLoans); anything else shows nothing.
 * Arrow keys move, Enter picks (the "Already in the DMS" card), Esc closes; Enter alone presses Find loan.
 */
export function LiveFindInput({
  defaultValue = "", autoFocus, required, placeholder, className, panelAlign,
}: {
  defaultValue?: string; autoFocus?: boolean; required?: boolean; placeholder: string; className: string;
  /** "row": the panel takes the edges of the nearest positioned parent (Find a loan's search box or row). */
  panelAlign?: "row";
}) {
  const [q, setQ] = useState(defaultValue);
  const [res, setRes] = useState<{ text: string; r: Result } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;

  useEffect(() => {
    const text = q.trim();
    if (text.length < MIN) return; // the panel only shows from 3 characters
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/loans/suggest?q=${encodeURIComponent(text)}`, { signal: ctl.signal });
        const body = (await r.json()) as Result | { error: string };
        setRes({ text, r: "error" in body ? { kind: "none" } : body });
        setActive(-1);
      } catch {
        if (!ctl.signal.aborted) setRes({ text, r: { kind: "none" } });
      }
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Only the answer for the text in the box (never an older one).
  const r = res && res.text === q.trim() ? res.r : null;
  const hits = r?.kind === "hits" ? r.hits : [];
  const go = (pn: string) => { setOpen(false); router.push(`/search?q=${encodeURIComponent(pn)}`); };
  const showPanel = open && q.trim().length >= MIN && !!r && r.kind !== "none";
  const status = !showPanel ? "" : r.kind === "hits" ? `${hits.length} loan file${hits.length === 1 ? "" : "s"} in the DMS.` : r.kind === "outside" ? OUTSIDE : UNSAVED;

  return (
    <div ref={box} className={`${panelAlign ? "" : "relative "}min-w-0 flex-1`}>
      <input
        id="find-loan" name="q" value={q} autoFocus={autoFocus} required={required} autoComplete="off" placeholder={placeholder}
        role="combobox" aria-expanded={showPanel && hits.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined} aria-describedby={`${uid}-status`}
        className={className}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setActive(-1); return; }
          if (!showPanel || !hits.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(hits[active].pn); }
        }}
      />
      <p id={`${uid}-status`} role="status" aria-live="polite" className="sr-only">{status}</p>
      {showPanel && (
        <div className={`absolute z-40 overflow-hidden rounded-xl border border-line bg-white shadow-lg ${panelAlign ? "-left-px -right-px top-[calc(100%+8px)] sm:left-0 sm:right-0" : "left-[-18px] right-[-18px] top-[calc(100%+10px)] sm:left-[-20px] sm:right-0"}`} data-find-results>
          {r.kind === "outside" && <p className="px-4 py-3 text-sm text-ink-2" data-find-empty data-find-outside>{OUTSIDE}</p>}
          {r.kind === "unsaved" && <p className="px-4 py-3 text-sm text-ink-2" data-find-empty data-find-unsaved>{UNSAVED}</p>}
          {hits.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Loan files in the DMS" className="max-h-[360px] overflow-y-auto">
              {hits.map((h, i) => (
                <li key={h.pn} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-0 ${i === active ? "bg-select-bg" : "hover:bg-fill"}`}
                  onMouseDown={(e) => { e.preventDefault(); go(h.pn); }} data-find-hit={h.pn}>
                  <span className="mono text-[14px] font-bold text-navy">{h.pn}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{h.borrowerName || "No name"}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="chip c-navy h-6 text-xs" data-find-stage>{h.stage}</span>
                    <span className="text-[12px] text-ink-2" data-find-in-dms>In DMS</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
