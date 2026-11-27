"use client";

import { useState } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { Sheet } from "@/components/ui/sheet";
import { AwayForm } from "./inbox-rows";

/** D-063: the Inbox header's (i): what My items and Branch pool mean, on two lines (the shared InfoTip). */
export function InboxInfo() {
  return (
    <InfoTip label="About My items and Branch pool" data="inbox" lines={[
      { text: "My items = work you've taken.", data: "mine" },
      { text: "Branch pool = new work nobody has taken yet.", data: "pool" },
    ]} />
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
