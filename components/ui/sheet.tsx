"use client";

import { useEffect, useRef } from "react";
import { XIcon } from "./icons";

/**
 * Modal sheet: a centered card on tablet/desktop, a bottom sheet on phone.
 * Uses the native <dialog> (focus trap, Esc to close). `side` makes it a right-hand panel on desktop.
 */
export function Sheet({
  open, onClose, title, children, side = false, labelledBy,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; side?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = labelledBy ?? `sheet-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const pos = side
    ? "sm:ml-auto sm:mr-0 sm:h-[100dvh] sm:max-h-[100dvh] sm:w-[400px] sm:rounded-none sm:rounded-l-2xl"
    : "sm:m-auto sm:w-[min(520px,calc(100vw-32px))] sm:rounded-2xl";
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`mb-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-white p-0 text-ink backdrop:bg-navy/40 sm:max-w-none ${pos}`}
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5 sm:max-h-none sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={id} className="text-xl font-bold text-navy">{title}</h2>
          <button type="button" onClick={onClose} className="-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:bg-hover" aria-label="Close">
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
