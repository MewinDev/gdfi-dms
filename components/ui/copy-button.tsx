"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

/**
 * D-058: a small "Copy" button beside a PN (44px tap area, the icon 16px). It sits above a card's stretched
 * link (relative z-10), so pressing it copies and does not open the loan. Says "Copied" for a moment.
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
      className="relative z-10 -my-3 -ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-fill hover:text-navy"
    >
      {done ? <CheckIcon size={16} strokeWidth={2.6} /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
