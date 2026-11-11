"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/time";

interface Hit { pn: string; borrowerName: string; status: string | null; releaseDate: string | null; opened: boolean; changed: boolean }
type Result = { ok: true; exactOnly: boolean; hits: Hit[]; outside?: number } | { ok: false; exactOnly: boolean; message: string };

const MIN = 3;

/** "Released Nov 7, 2026", or "Cancelled · released Nov 7, 2026". */
function statusLine(h: Hit) {
  const date = h.releaseDate ? fmtDate(h.releaseDate) : null;
  if ((h.status ?? "").toUpperCase() === "RELEASED") return date ? `Released ${date}` : "Released";
  const st = (h.status ?? "No status").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return date ? `${st} · released ${date}` : st;
}
const DEBOUNCE_MS = 300;

/**
 * The Find loan input with live MyLoans suggestions: 300 ms after typing stops, at least 3 characters,
 * at most 10 results (PN, borrower, status, release date). Arrow keys move, Enter opens, Esc closes.
 * With exact-PN-only sources it says so and still finds a whole PN.
 */
export function LiveFindInput({
  defaultValue = "", autoFocus, required, placeholder, className, exactOnly, panelAlign,
}: {
  defaultValue?: string; autoFocus?: boolean; required?: boolean; placeholder: string; className: string; exactOnly: boolean;
  /** "row": the panel takes the edges of the nearest positioned parent (Find a loan's search box or row). */
  panelAlign?: "row";
}) {
  const [q, setQ] = useState(defaultValue);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "done"; r: Result }>({ kind: "idle" });
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
      setState({ kind: "loading" });
      try {
        const res = await fetch(`/api/myloans/search?q=${encodeURIComponent(text)}`, { signal: ctl.signal });
        const r = (await res.json()) as Result | { error: string };
        setState({ kind: "done", r: "error" in r ? { ok: false, exactOnly, message: r.error } : r });
        setActive(-1);
      } catch {
        if (!ctl.signal.aborted) setState({ kind: "done", r: { ok: false, exactOnly, message: "MyLoans did not answer. Try again in a moment." } });
      }
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [q, exactOnly]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const hits = state.kind === "done" && state.r.ok ? state.r.hits : [];
  const go = (pn: string) => { setOpen(false); router.push(`/search?q=${encodeURIComponent(pn)}`); };
  const showPanel = open && q.trim().length >= MIN;
  let status = "";
  if (state.kind === "loading") status = "Looking in MyLoans…";
  else if (state.kind === "done" && !state.r.ok) status = state.r.message;
  // Found in MyLoans, but in a branch outside the person's access: say so (the same as Find loan says).
  else if (state.kind === "done" && hits.length === 0 && state.r.ok && (state.r.outside ?? 0) > 0) status = "Outside your branches. You can only open loans of your branches.";
  else if (state.kind === "done" && hits.length === 0) status = exactOnly ? "No match. MyLoans here finds the whole PN only, for example GD1012026901001." : "No match in MyLoans.";
  else if (hits.length) status = `${hits.length} match${hits.length === 1 ? "" : "es"} in MyLoans.`;

  return (
    <div ref={box} className={`${panelAlign ? "" : "relative "}min-w-0 flex-1`}>
      <input
        id="find-loan" name="q" value={q} autoFocus={autoFocus} required={required} autoComplete="off" placeholder={placeholder}
        role="combobox" aria-expanded={showPanel && hits.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} aria-describedby={`${uid}-status`}
        className={className}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (!hits.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(hits[active].pn); }
        }}
      />
      <p id={`${uid}-status`} role="status" aria-live="polite" className="sr-only">{showPanel ? status : ""}</p>
      {showPanel && state.kind !== "idle" && (
        <div className={`absolute z-40 overflow-hidden rounded-xl border border-line bg-white shadow-lg ${panelAlign ? "-left-px -right-px top-[calc(100%+8px)] sm:left-0 sm:right-0" : "left-[-18px] right-[-18px] top-[calc(100%+10px)] sm:left-[-20px] sm:right-0"}`} data-find-results>
          {state.kind === "loading" && (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-ink-2" data-find-loading>
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-navy" /> Looking in MyLoans…
            </p>
          )}
          {state.kind === "done" && hits.length === 0 && <p className="px-4 py-3 text-sm text-ink-2" data-find-empty data-find-outside={state.r.ok && state.r.outside ? "" : undefined}>{status}</p>}
          {hits.length > 0 && (
            <ul id={listId} role="listbox" aria-label="MyLoans matches" className="max-h-[360px] overflow-y-auto">
              {hits.map((h, i) => (
                <li key={h.pn} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line-soft px-4 py-2.5 last:border-0 ${i === active ? "bg-select-bg" : "hover:bg-fill"}`}
                  onMouseDown={(e) => { e.preventDefault(); go(h.pn); }}>
                  <span className="mono text-[14px] font-bold text-navy">{h.pn}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{h.borrowerName || "No name"}</span>
                  {h.changed && <span className="chip c-bad h-6 text-xs">MyLoans changed</span>}
                  {h.opened && !h.changed && <span className="chip c-mute h-6 text-xs">Open here</span>}
                  <span className="basis-full text-[12px] text-ink-2">{statusLine(h)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
