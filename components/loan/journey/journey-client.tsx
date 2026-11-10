"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";

/**
 * Story · By document · Full log: a tablist (arrow keys, Home and End move and open the view). The
 * choice is kept in the address (?journey=story), so a refresh keeps it.
 */
export function JourneySwitch({ items, current }: { items: { key: string; label: string; href: string }[]; current: string }) {
  const router = useRouter();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + items.length) % items.length;
    refs.current[n]?.focus();
    router.push(items[n].href, { scroll: false });
  };
  const at = items.findIndex((x) => x.key === current);
  return (
    <div role="tablist" aria-label="Journey view" className="inline-flex w-full self-start rounded-xl border border-line-strong bg-white p-0.5 sm:w-auto" data-journey-switch>
      {items.map((x, i) => {
        const on = x.key === current;
        return (
          <Link key={x.key} ref={(el) => { refs.current[i] = el; }} id={`journey-tab-${x.key}`} href={x.href} scroll={false}
            role="tab" aria-selected={on} aria-controls="journey-panel" tabIndex={on ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(at + 1); }
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(at - 1); }
              else if (e.key === "Home") { e.preventDefault(); go(0); }
              else if (e.key === "End") { e.preventDefault(); go(items.length - 1); }
            }}
            className={`inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-2 text-sm font-semibold no-underline sm:min-h-9 sm:flex-none sm:px-4 ${on ? "bg-navy text-white" : "text-navy hover:bg-fill"}`}>
            {x.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A milestone of By document: the whole milestone is one button; it opens its details (the same text
 * the Full log has for it) in a panel. Closing returns focus to the milestone.
 */
export function MilestoneButton({ title, details, children, className }: { title: string; details: { when: string; text: string }[]; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => { setOpen(false); window.setTimeout(() => btn.current?.focus(), 0); };
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className} data-milestone-button>
        {children}
      </button>
      <Sheet open={open} onClose={close} title={title} labelledBy={titleId}>
        {details.length ? (
          <ol className="flex flex-col gap-2" data-milestone-details>
            {details.map((d, i) => (
              <li key={i} className="text-sm">
                <span className="text-ink">{d.text}</span>{" "}
                <span className="whitespace-nowrap text-ink-2">{d.when}</span>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-ink-2" data-milestone-details>Nothing was recorded for this step yet.</p>}
      </Sheet>
    </>
  );
}

const WHO: [string, string][] = [["", "Everyone"], ["LA", "LA"], ["DP", "DP"], ["FIN", "Finance"], ["SYS", "System"]];

/**
 * Full log filters: search, Who, and the two switches (Show system steps, Show not applicable; both off
 * at first). They only show or hide rows already on the page; nothing is fetched or saved.
 */
export function LogControls({ sys: sys0, na: na0 }: { sys: boolean; na: boolean }) {
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [sys, setSys] = useState(sys0);
  const [na, setNa] = useState(na0);
  const [shown, setShown] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const root = ref.current?.closest("[data-log-root]") as HTMLElement | null;
    if (!root) return;
    root.toggleAttribute("data-sys-off", !sys);
    root.toggleAttribute("data-na-off", !na);
    const needle = q.trim().toLowerCase();
    let count = 0;
    root.querySelectorAll<HTMLElement>("[data-log-row]").forEach((row) => {
      const hide = (!sys && row.hasAttribute("data-log-sys")) || (!na && row.hasAttribute("data-log-na"))
        || (!!who && !(row.dataset.logWho ?? "").split(" ").includes(who))
        || (!!needle && !(row.dataset.logText ?? "").includes(needle));
      row.hidden = hide;
      if (!hide) count += 1;
    });
    // A phase with nothing left to show is hidden too.
    root.querySelectorAll<HTMLElement>("[data-phase]").forEach((p) => { p.hidden = !p.querySelector("[data-log-row]:not([hidden])"); });
    setShown(count);
  }, [q, who, sys, na]);
  return (
    <div ref={ref} className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:px-4" data-log-controls>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5 text-xs font-semibold text-ink-2">
          Search
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A step, a name, a word" className="input min-h-11 text-sm sm:min-h-9" data-log-search />
        </label>
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink-2" htmlFor={`${id}-who`}>
          Who
          <select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} className="input min-h-11 text-sm sm:min-h-9" data-log-who-filter>
            {WHO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Switch label="Show system steps" on={sys} set={setSys} data="sys" />
        <Switch label="Show not applicable" on={na} set={setNa} data="na" />
      </div>
      <p role="status" aria-live="polite" className="sr-only">{shown === null ? "" : `${shown} step${shown === 1 ? "" : "s"} shown`}</p>
      {shown === 0 && <p className="text-sm text-ink-2" data-log-empty>No steps match. Clear the search or change Who.</p>}
    </div>
  );
}

function Switch({ label, on, set, data }: { label: string; on: boolean; set: (v: boolean) => void; data: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-navy sm:min-h-9" data-log-switch={data}>
      <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors motion-reduce:transition-none ${on ? "border-navy bg-navy" : "border-line-strong bg-fill-strong"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}
