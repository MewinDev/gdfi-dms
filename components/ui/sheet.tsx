"use client";

import { useEffect, useRef } from "react";
import { XIcon } from "./icons";
import { SheetHandle, useDragToClose } from "./sheet-drag";

/**
 * Modal sheet: a centered card on tablet/desktop, a bottom sheet on phone.
 * Uses the native <dialog> (focus trap, Esc to close). `side` makes it a right-hand panel on desktop.
 * The user's review (27 November 2026): the header (grab handle, title, X) stays pinned at the top with a line under
 * it; only the body scrolls (up to 85% of a phone's height, the window's height for a side panel, the window less a
 * margin for a centred card).
 */
export function Sheet({
  open, onClose, title, children, side = false, labelledBy, dragToClose = true, compact = false, wide = false,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; side?: boolean; labelledBy?: string;
  /** D-062: on a phone, a grab handle instead of the X; drag down to close (components/ui/sheet-drag.tsx). On by default. */
  dragToClose?: boolean;
  /** D-062: smaller title and padding (Report a problem). */
  compact?: boolean;
  /** D-063: a wider side panel (480 px instead of 400 px; the Inbox's loan preview). */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { dragProps, onHandleClick } = useDragToClose(ref, onClose, open);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = labelledBy ?? `sheet-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const pos = side
    ? `sm:ml-auto sm:mr-0 sm:h-[100dvh] sm:max-h-[100dvh] ${wide ? "sm:w-[min(480px,100vw)]" : "sm:w-[400px]"} sm:rounded-none sm:rounded-l-2xl`
    : "sm:m-auto sm:max-h-[calc(100dvh-32px)] sm:w-[min(520px,calc(100vw-32px))] sm:rounded-2xl";
  const padX = compact ? "px-4 sm:px-5" : "px-5 sm:px-6";
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      // Only this dialog's own close: a confirm opened inside it (Accept's question) also fires "close", and React passes
      // it up through the portal; that must not close the sheet too.
      onClose={(e) => { if (e.target === ref.current) onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-line bg-white p-0 text-ink backdrop:bg-navy/40 open:flex open:flex-col sm:max-w-none ${pos}`}
      data-sheet
    >
      <div className={`shrink-0 border-b border-line ${padX} ${compact ? "pb-2.5 pt-4 sm:pt-5" : "pb-3 pt-5 sm:pt-6"} ${dragToClose ? "max-sm:pt-2" : ""}`} data-sheet-header>
        {dragToClose && <SheetHandle dragProps={dragProps} onClick={onHandleClick} />}
        <div className={`flex items-start justify-between gap-3 ${dragToClose ? "max-sm:touch-none" : ""}`} {...(dragToClose ? dragProps : {})}>
          <h2 id={id} className={`font-bold text-navy ${compact ? "text-base" : "text-xl"}`}>{title}</h2>
          <button type="button" onClick={onClose} className={`-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:bg-hover ${dragToClose ? "max-sm:hidden" : ""}`} aria-label="Close">
            <XIcon />
          </button>
        </div>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${padX} ${compact ? "pb-4 pt-3 sm:pb-5" : "pb-5 pt-4 sm:pb-6"}`} data-sheet-body>
        {children}
      </div>
    </dialog>
  );
}
