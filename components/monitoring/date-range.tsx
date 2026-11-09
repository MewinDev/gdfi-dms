"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PRESETS, presetRange, rangeLabel, rangeNote, rangeParams, rangeSummary, ymdAdd, ymdDiff, type Preset } from "@/lib/monitoring/rules";

/**
 * Monitoring's date range: one button that says the range in words ("11 Oct to 9 Nov 2026"). It opens a
 * popover (a bottom sheet on phones) with the presets and a two-month calendar (one month on phones).
 * Philippine dates; future days cannot be picked. Apply goes to the same page with the range in the URL
 * (the existing range / from / to format), keeping the other filters. Esc or Cancel closes it and focus
 * returns to the button. Arrow keys move between days; Enter or Space picks one.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthOf = (ymd: string) => ymd.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};
const dayName = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function DateRangeButton(p: {
  preset: Preset;
  from: string;
  to: string;
  today: string;
  /** Holidays (YYYY-MM-DD) for the "22 business days" line. */
  holidays: string[];
  /** The other filters to keep in the URL when applying (no range, from or to). */
  keep: Record<string, string>;
}) {
  const router = useRouter();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>(p.preset);
  const [from, setFrom] = useState(p.from);
  const [to, setTo] = useState<string | null>(p.to);
  const [left, setLeft] = useState(addMonths(monthOf(p.to), -1));
  const [focusDay, setFocusDay] = useState(p.to);
  /** Move focus to the focused day on the next render (on open, and after an arrow key). */
  const wantFocus = useRef(false);
  const holidays = useMemo(() => new Set(p.holidays), [p.holidays]);

  const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
  const show = (ymd: string) => setLeft(addMonths(monthOf(ymd), wide() ? -1 : 0));

  function openPanel() {
    setPreset(p.preset); setFrom(p.from); setTo(p.to); setFocusDay(p.to); show(p.to);
    wantFocus.current = true;
    setOpen(true);
  }
  function close() {
    setOpen(false);
    btn.current?.focus();
  }
  function pickPreset(k: Preset) {
    setPreset(k);
    if (k === "custom") return;
    const [f, t] = presetRange(k, p.today);
    setFrom(f); setTo(t); setFocusDay(t); show(t);
  }
  function pickDay(ymd: string) {
    if (ymd > p.today) return;
    setPreset("custom");
    setFocusDay(ymd);
    if (to !== null) { setFrom(ymd); setTo(null); return; }
    if (ymd < from) { setTo(from); setFrom(ymd); } else setTo(ymd);
  }
  function apply() {
    if (!to) return;
    const qs = new URLSearchParams({ ...p.keep, ...rangeParams({ preset, from, to }) }).toString();
    setOpen(false);
    router.push(`/monitoring${qs ? `?${qs}` : ""}`);
  }

  // Focus: the chosen day (or the first preset) when it opens; the moved day after arrow keys.
  useEffect(() => {
    if (!open || !wantFocus.current) return;
    wantFocus.current = false;
    const el = panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`) ?? panel.current?.querySelector<HTMLButtonElement>("[data-preset]");
    el?.focus();
  }, [open, left, focusDay]);

  function onDayKey(e: React.KeyboardEvent, ymd: string) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in step)) return;
    e.preventDefault();
    let next = ymdAdd(ymd, step[e.key]);
    if (next > p.today) next = p.today;
    setFocusDay(next);
    const lastShown = addMonths(left, wide() ? 1 : 0);
    if (monthOf(next) < left) setLeft(monthOf(next));
    else if (monthOf(next) > lastShown) setLeft(addMonths(monthOf(next), wide() ? -1 : 0));
    wantFocus.current = true;
  }

  const end = to ?? from;
  const days = ymdDiff(from, end) + 1;
  const note = rangeNote(days);
  const canNext = addMonths(left, 1) <= monthOf(p.today) && (!wide() || addMonths(left, 2) <= monthOf(p.today));

  return (
    <div className="relative" onKeyDown={(e) => { if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <button
        ref={btn} type="button" onClick={() => (open ? close() : openPanel())} aria-expanded={open} aria-controls={`${id}-panel`} aria-haspopup="dialog"
        className="inline-flex min-h-11 w-full items-center gap-2 rounded-xl border border-line-input bg-white px-3.5 text-[14px] font-semibold text-navy hover:bg-fill sm:w-auto"
        data-date-range-button
      >
        <CalendarIcon size={18} />
        <span className="sr-only">Date range: </span>
        <span className="truncate">{rangeLabel(p.from, p.to)}</span>
      </button>
      <input type="hidden" name="range" value={p.preset === "custom" ? "custom" : p.preset} />
      {p.preset === "custom" && <><input type="hidden" name="from" value={p.from} /><input type="hidden" name="to" value={p.to} /></>}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-navy/40 sm:bg-transparent" onClick={close} aria-hidden="true" />
          <div
            ref={panel} id={`${id}-panel`} role="dialog" aria-modal="false" aria-label="Date range"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-line bg-white p-4 shadow-xl motion-safe:animate-[fadein_120ms_ease-out] sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[600px] sm:rounded-2xl"
            data-date-range-panel
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <div role="group" aria-label="Presets" className="flex flex-wrap gap-1.5 sm:w-36 sm:flex-col sm:flex-nowrap">
                {PRESETS.map(([k, l]) => (
                  <button key={k} type="button" data-preset={k} aria-pressed={preset === k} onClick={() => pickPreset(k)}
                    className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] font-semibold sm:min-h-9 sm:rounded-lg ${preset === k ? "border-navy bg-navy text-white" : "border-line-input bg-white text-navy hover:bg-fill"}`}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" onClick={() => setLeft(addMonths(left, -1))} className="flex h-11 w-11 items-center justify-center rounded-xl text-navy hover:bg-fill" aria-label="Previous month">
                    <span className="rotate-180"><ChevronRightIcon size={18} /></span>
                  </button>
                  <button type="button" onClick={() => setLeft(addMonths(left, 1))} disabled={!canNext} className="flex h-11 w-11 items-center justify-center rounded-xl text-navy hover:bg-fill disabled:opacity-30" aria-label="Next month">
                    <ChevronRightIcon size={18} />
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[left, addMonths(left, 1)].map((ym, i) => (
                    <Month key={ym} ym={ym} className={i === 1 ? "hidden sm:block" : ""} today={p.today} from={from} to={to} focusDay={focusDay} onPick={pickDay} onKey={onDayKey} />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ink-2" aria-live="polite" data-range-summary>
                {to ? <><strong className="text-navy">{rangeLabel(from, to)}</strong> · {rangeSummary(from, to, holidays)}</> : <>From {rangeLabel(from, from).split(" to ")[0]}: now pick the last day.</>}
                {note && <span className="block" data-range-note>{note}</span>}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={close} className="btn-ghost min-h-11 flex-1 sm:flex-none">Cancel</button>
                <button type="button" onClick={apply} disabled={!to} className="btn-gold min-h-11 flex-1 sm:flex-none">Apply</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Month({ ym, className, today, from, to, focusDay, onPick, onKey }: {
  ym: string; className: string; today: string; from: string; to: string | null; focusDay: string;
  onPick: (ymd: string) => void; onKey: (e: React.KeyboardEvent, ymd: string) => void;
}) {
  const first = `${ym}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const last = ymdAdd(`${addMonths(ym, 1)}-01`, -1);
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = first; d <= last; d = ymdAdd(d, 1)) cells.push(d);
  const end = to ?? from;
  const title = `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  return (
    <div className={className} data-month={ym}>
      <p className="mb-1 text-center text-[14px] font-bold text-navy">{title}</p>
      <div className="grid grid-cols-7 text-center text-[12px] font-semibold text-ink-2" aria-hidden="true">
        {DOW.map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7" role="group" aria-label={title}>
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const future = d > today;
          const edge = d === from || d === end;
          const inside = d > from && d < end;
          return (
            <button
              key={d} type="button" data-day={d} disabled={future} tabIndex={d === focusDay ? 0 : -1}
              aria-label={dayName(d)} aria-pressed={edge || inside}
              onClick={() => onPick(d)} onKeyDown={(e) => onKey(e, d)}
              className={`flex h-11 items-center justify-center text-[13px] tabular-nums sm:h-9 ${
                edge ? "rounded-lg bg-navy font-bold text-white" : inside ? "bg-wait-bg text-navy" : future ? "text-ink-2/40" : "rounded-lg text-navy hover:bg-fill"
              } ${d === today && !edge ? "font-bold underline decoration-gold decoration-2 underline-offset-4" : ""} focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy`}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
