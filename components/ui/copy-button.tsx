"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

/**
 * D-058: a small "Copy" button beside a PN. As compact as possible (the user's review, D-059): 20px with a 13px
 * icon; under 768px an invisible margin (::before) keeps a 44px tap area. It sits above a card's stretched link
 * (relative z-10), so pressing it copies and does not open the loan. Says "Copied" for a moment.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" aria-label={done ? "Copied" : label} title={done ? "Copied" : label} data-copy={text}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch { /* no clipboard permission: the PN text can still be selected */ }
      }}
      className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-2 before:absolute before:-inset-3 before:content-[''] hover:bg-fill hover:text-navy md:before:hidden" data-copy-button
    >
      {done ? <CheckIcon size={13} strokeWidth={2.6} /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
