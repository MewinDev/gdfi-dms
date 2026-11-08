"use client";

import { useState, useTransition } from "react";
import { markLabelsPrintedAction } from "@/app/actions/loan";

export function PrintLabelsButton({ ids, canMark }: { ids: string[]; canMark: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-gold"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (canMark) {
              const r = await markLabelsPrintedAction(ids);
              setMsg(r?.ok ? "Recorded as printed." : r?.error ?? null);
            }
            window.print();
          })
        }
      >
        {pending ? "Preparing..." : "Print labels"}
      </button>
      {msg && <span role="status" className="text-xs text-ink-2">{msg}</span>}
    </div>
  );
}
