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
export function SampleLoans({ title, intro, samples, compact = false, row = false, id }: { title: string; intro: string; samples: SampleCard[]; compact?: boolean; row?: boolean; id: string }) {
  const [picked, setPicked] = useState<string | null>(null);
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

  // Find a loan: a heading row and a grid of sample cards (no outer card).
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={id} className="text-lg font-bold text-navy">{title}</h2>
        {pill}
        <p className="w-full text-sm text-ink-2 lg:w-auto">{intro}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {samples.map((s) => {
          const on = picked === s.pn;
          return (
            <li key={s.pn}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => pick(s.pn)}
                className={`flex h-full w-full min-h-11 flex-col gap-2.5 rounded-2xl border px-[22px] py-5 text-left transition-colors ${on ? "border-2 border-navy bg-fill-soft px-[21px] py-[19px]" : "border-[rgb(12_35_64/0.14)] bg-white hover:bg-fill"}`}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="text-base font-bold text-navy">{s.pn}</span>
                  {chip(s)}
                </span>
                <span className="text-[15px] font-semibold text-navy">{s.name}</span>
                <span className="text-[13px] leading-relaxed text-ink-2">
                  {s.branch} · {s.loanType} · {s.amountText}
                  <br />
                  {s.tests}
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
