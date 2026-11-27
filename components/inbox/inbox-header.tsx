"use client";

import { useId, useState } from "react";
import { InfoIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { AwayForm } from "./inbox-rows";

/**
 * D-063: the Inbox header's (i): what My items and Branch pool mean. Shown on hover or keyboard focus, and on a tap
 * (phones have no hover); Esc hides it.
 */
export function InboxInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    // On a phone the tip is placed from the start of the line (the wrapper is not its anchor there), so it never runs off the screen.
    <span className="group/info inline-flex sm:relative" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <button type="button" aria-label="About My items and Branch pool" aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-2 before:absolute before:-inset-2.5 before:content-[''] hover:bg-fill hover:text-navy focus-visible:outline-2 focus-visible:outline-navy sm:before:-inset-1" data-inbox-info>
        <InfoIcon size={15} />
      </button>
      <span id={id} role="tooltip"
        className={`absolute left-1/2 top-full z-30 mt-1.5 w-max max-w-[min(260px,calc(100vw-32px))] -translate-x-1/2 whitespace-normal rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-lg max-sm:left-0 max-sm:translate-x-0 ${open ? "block" : "hidden group-hover/info:block group-has-[:focus-visible]/info:block"}`}
        data-inbox-info-tip>
        {/* The user's review: My items on top, Branch pool below. */}
        <span className="block" data-tip-mine>My items = work you&apos;ve taken.</span>
        <span className="mt-0.5 block" data-tip-pool>Branch pool = new work nobody has taken yet.</span>
      </span>
    </span>
  );
}

/**
 * D-063: "Set away" in the header (it was a card above the list): opens the same Away form in a sheet. When the person
 * is marked away it says "Away until <date>"; the sheet then has Change and I am back. The away rules are unchanged.
 */
export function SetAway({ me, current, until }: { me: string; current: string | null; until: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-set-away
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold sm:min-h-8 ${until ? "border-hold-line bg-hold-bg text-hold-fg" : "border-line-strong bg-white text-navy hover:bg-fill"}`}>
        {until ? `Away until ${until}` : "Set away"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Set away" compact>
        <p className="mb-2 text-[13px] text-ink-2">While you are away you are not given new work by name; your items can be moved by a supervisor.</p>
        {open && <AwayForm me={me} current={current} startOpen={!current} />}
      </Sheet>
    </>
  );
}
