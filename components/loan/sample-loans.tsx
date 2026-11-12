"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SampleCard {
  pn: string;
  tests: string;
  name: string;
  branch: string;
  product: string;
  loanType: string;
  amountText: string;
  opened: boolean;
}

/** Puts the PN in the search box on this page and focuses it. */
function fillSearch(pn: string): boolean {
  const box = document.getElementById("find-loan");
  if (!(box instanceof HTMLInputElement) || box.offsetParent === null) return false;
  // The native setter, so a controlled input (live MyLoans suggestions) sees the change too.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, pn);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  return true;
}

/**
 * Selectable sample loan cards (TEST_MODE only; the server decides whether to render this).
 * Pressing a card only fills the PN box. The tester still presses "Find loan".
 */
export function SampleLoans({ title, intro, samples, compact = false, row = false, collapsed = false, id }: { title: string; intro: string; samples: SampleCard[]; compact?: boolean; row?: boolean; collapsed?: boolean; id: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState(false); // phone only (the slim list)
  const router = useRouter();
  // Home has no search box: open My loans with the PN already in its box (nothing is searched).
  const pick = (pn: string) => {
    if (fillSearch(pn)) setPicked(pn);
    else router.push(`/loans?fill=${encodeURIComponent(pn)}`);
  };
  const pill = <span className="inline-flex h-6 items-center rounded-full bg-navy px-2.5 text-[11px] font-bold tracking-[0.04em] text-white">TEST MODE</span>;
  const chip = (s: SampleCard) => (s.opened ? <span className="chip c-ok">Opened</span> : <span className="chip c-act">Try it</span>);
  const pickedNote = <span className="text-xs font-semibold text-navy">PN added to the search box. Press Find loan.</span>;

  if (row) {
    // My loans: one tight row under the search (scrolls sideways on phone).
    return (
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 id={id} className="text-[15px] font-bold text-navy">{title}</h2>
          {pill}
          <p className="text-sm text-ink-2">{intro}</p>
        </div>
        <ul className="seg-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">
          {samples.map((s) => {
            const on = picked === s.pn;
            return (
              <li key={s.pn} className="min-w-[230px] sm:min-w-0">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(s.pn)}
                  className={`flex h-full w-full min-h-11 flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${on ? "border-2 border-navy bg-fill-soft px-[13px] py-[9px]" : "border-[rgb(12_35_64/0.14)] bg-white hover:bg-fill"}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-[15px] font-bold text-navy">{s.pn}</span>
                    {chip(s)}
                  </span>
                  <span className="text-sm font-semibold text-navy">{s.name}</span>
                  <span className="text-xs text-ink-2">{s.branch} · {s.loanType} · {s.amountText}</span>
                  <span className="text-xs leading-snug text-ink-2">{s.tests}</span>
                  {on && pickedNote}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (collapsed) {
    // Home: one slim row, closed by default; inside, one line per sample (PN · name, then its chip). What each
    // sample tests is in the tooltip.
    return (
      <details className="group rounded-lg border border-line bg-white" data-home-samples>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 sm:px-4 [&::-webkit-details-marker]:hidden">
          <h2 id={id} className="text-[15px] font-semibold text-navy">{title}</h2>
          <span className="text-ink-2">·</span>
          <span className="text-[11px] font-bold tracking-[0.04em] text-navy">TEST MODE</span>
          <span aria-hidden="true" className="ml-auto text-ink-2 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <p className="border-t border-line px-3 pt-2 text-[13px] text-ink-2 sm:px-4" aria-live="polite">{intro}</p>
        <ul className="px-1.5 pb-1.5 pt-1 sm:px-2.5">
          {samples.map((s) => (
            <li key={s.pn}>
              <button type="button" onClick={() => pick(s.pn)} title={`${s.tests} ${s.branch} · ${s.loanType} · ${s.amountText}`}
                className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[13px] hover:bg-fill">
                <span className="font-mono font-semibold text-navy">{s.pn}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {chip(s)}
              </button>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  if (compact) {
    // Home: a card with compact rows (desktop side column, phone) or three tiles (tablet).
    return (
      <section aria-labelledby={id} className="card flex flex-col gap-3.5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="text-lg font-bold text-navy">{title}</h2>
          {pill}
        </div>
        <p className="-mt-1.5 text-sm leading-relaxed text-ink-2">{intro}</p>
        <ul className="grid gap-3 sm:max-xl:grid-cols-3">
          {samples.map((s) => {
            const on = picked === s.pn;
            return (
              <li key={s.pn}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(s.pn)}
                  className={`flex h-full w-full min-h-11 flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-colors ${on ? "border-2 border-navy bg-fill-soft px-[15px] py-[11px]" : "border-[rgb(12_35_64/0.14)] bg-white hover:bg-fill"}`}
                >
                  <span className="flex w-full items-center gap-3 sm:max-xl:flex-col sm:max-xl:items-start sm:max-xl:gap-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-navy">{s.pn}<span className="sm:max-xl:hidden"> · {s.name}</span></span>
                      <span className="hidden text-sm text-ink-2 sm:max-xl:block">{s.name}</span>
                      <span className="block text-[13px] leading-snug text-ink-2 sm:max-xl:hidden">{s.tests}</span>
                    </span>
                    {chip(s)}
                  </span>
                  {on && pickedNote}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // Find a loan: one slim row of chips (PN and name only). The branch and what each sample tests are in the tooltip.
  // On a phone the list folds away under one "Show" button.
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5" data-samples-slim>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={id} className="text-sm font-bold text-navy">{title}</h2>
        {pill}
        <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={shown} aria-controls={`${id}-list`} className="ml-auto inline-flex min-h-9 items-center rounded-lg px-2 text-[13px] font-semibold text-navy underline underline-offset-2 sm:hidden">
          {shown ? "Hide" : `Show ${samples.length}`}
        </button>
        <p className="w-full text-[13px] text-ink-2 sm:w-auto" aria-live="polite">{picked ? "PN added to the search box. Press Find loan." : intro}</p>
      </div>
      <ul id={`${id}-list`} className={`${shown ? "flex" : "hidden"} flex-col gap-1.5 sm:flex sm:flex-row sm:flex-wrap`}>
        {samples.map((s) => {
          const on = picked === s.pn;
          return (
            <li key={s.pn} className="min-w-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => pick(s.pn)}
                title={`${s.tests} ${s.branch} · ${s.loanType} · ${s.amountText}`}
                className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded-full border px-3.5 text-left text-[13px] transition-colors sm:w-auto ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.16)] bg-white text-navy hover:bg-fill"}`}
              >
                <span className="font-mono text-[13px] font-bold">{s.pn}</span>
                <span className="min-w-0 truncate font-semibold">{s.name}</span>
                {s.opened && <span className={`shrink-0 text-xs font-semibold ${on ? "text-white" : "text-ok-fg"}`}>· Opened</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
