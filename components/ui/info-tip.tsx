"use client";

import { useId, useState } from "react";
import { InfoIcon } from "./icons";

/**
 * An (i) beside a page's short line (D-063 Inbox, D-064 Jobs): its lines show on hover, keyboard focus or a tap
 * (phones have no hover); Esc hides it. On a phone the tip is placed from the start of the line (the parent is
 * `relative`), so it never runs off the screen.
 */
export function InfoTip({ label, lines, data }: { label: string; lines: { text: React.ReactNode; data?: string }[]; data?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="group/info inline-flex sm:relative" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <button type="button" aria-label={label} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-2 before:absolute before:-inset-2.5 before:content-[''] hover:bg-fill hover:text-navy focus-visible:outline-2 focus-visible:outline-navy sm:before:-inset-1"
        data-info-tip={data}>
        <InfoIcon size={15} />
      </button>
      <span id={id} role="tooltip"
        className={`absolute left-1/2 top-full z-30 mt-1.5 w-max max-w-[min(280px,calc(100vw-32px))] -translate-x-1/2 whitespace-normal rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-lg max-sm:left-0 max-sm:translate-x-0 ${open ? "block" : "hidden group-hover/info:block group-has-[:focus-visible]/info:block"}`}
        data-info-tip-text={data}>
        {lines.map((l, i) => <span key={i} className={`block ${i ? "mt-0.5" : ""}`} data-tip-line={l.data}>{l.text}</span>)}
      </span>
    </span>
  );
}
