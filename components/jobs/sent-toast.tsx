"use client";

import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { sentKey } from "@/components/loan/send-panel";

/** Right after Send: "Sent to Grace Tan" for a few seconds, and the job card scrolls into view. Once only. */
export function SentToast({ txnId, targetId }: { txnId: string; targetId: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let name: string | null = null;
    try {
      name = sessionStorage.getItem(sentKey(txnId));
      if (name !== null) sessionStorage.removeItem(sentKey(txnId));
    } catch { /* storage blocked: no toast */ }
    if (name === null) return;
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const show = window.setTimeout(() => setText(name ? `Sent to ${name}` : "Sent"), 0);
    const hide = window.setTimeout(() => setText(null), 4000);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [txnId, targetId]);
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white shadow-lg sm:bottom-6">
      <CheckIcon size={16} /> {text}
    </div>
  );
}
