"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * D-062 (the user's review, 26 November 2026): on a phone (under 640 px) every bottom sheet (Sheet, GuardedSheet) has
 * a grab handle instead of the X. Dragging the handle or the title down more than 80 px, or a quick flick, closes it
 * through the sheet's own close (a GuardedSheet still asks "Discard your changes?" when something was typed); a
 * shorter drag springs back. Tapping the handle closes it (its name is "Close" for screen readers); Esc and the
 * form's Cancel work as before. Tablets and desktop keep the centred dialog with its X.
 * While a sheet is open the page behind it is locked (no scroll, no bounce, no pull-to-refresh): only the sheet moves.
 * Not used for the "are you sure" ConfirmDialog (an alert answered with its buttons), the full-screen Settings window
 * or the menu drawer.
 */
export function useDragToClose(ref: React.RefObject<HTMLDialogElement | null>, requestClose: () => void, open: boolean) {
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const lastDrag = useRef(0);

  const setY = useCallback((y: number, animate: boolean) => {
    const d = ref.current;
    if (!d) return;
    d.style.transition = animate ? "transform 180ms ease-out" : "none";
    d.style.transform = y > 0 ? `translateY(${y}px)` : "";
  }, [ref]);

  useEffect(() => { if (!open) setY(0, false); }, [open, setY]);

  // Only the sheet moves (the user's review): while a sheet is open on a phone the page behind it does not scroll, bounce or
  // pull-to-refresh. A count, so a sheet on top of a sheet releases the lock only when the last one closes.
  useEffect(() => {
    // Phones only: on wider screens hiding the scrollbar would shift the page sideways.
    if (!open || window.innerWidth >= 640) return;
    const html = document.documentElement;
    const n = Number(html.dataset.sheetLocks ?? "0") + 1;
    html.dataset.sheetLocks = String(n);
    if (n === 1) { html.style.overflow = "hidden"; html.style.overscrollBehavior = "none"; }
    return () => {
      const left = Number(html.dataset.sheetLocks ?? "1") - 1;
      if (left <= 0) { delete html.dataset.sheetLocks; html.style.overflow = ""; html.style.overscrollBehavior = ""; }
      else html.dataset.sheetLocks = String(left);
    };
  }, [open]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (window.innerWidth >= 640) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    g.dy = Math.max(0, e.clientY - g.y);
    setY(g.dy, false);
  };
  const onPointerUp = () => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    const fast = g.dy > 30 && g.dy / Math.max(1, performance.now() - g.t) > 0.6; // a quick flick
    if (g.dy > 4) lastDrag.current = performance.now();
    setY(0, true);
    if (g.dy > 80 || fast) requestClose();
  };
  /** A tap on the handle closes; the click that ends a drag does not close a second time. */
  const onHandleClick = () => { if (performance.now() - lastDrag.current > 300) requestClose(); };

  const dragProps = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  return { dragProps, onHandleClick };
}

/** The grab handle at the top of a bottom sheet (phone only). */
export function SheetHandle({ dragProps, onClick }: { dragProps: React.HTMLAttributes<HTMLElement>; onClick: () => void }) {
  return (
    <button type="button" aria-label="Close" onClick={onClick} {...dragProps}
      className="mx-auto mb-2 flex h-6 w-24 cursor-grab touch-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-navy sm:hidden" data-sheet-handle>
      <span aria-hidden="true" className="block h-1.5 w-10 rounded-full bg-line-strong" />
    </button>
  );
}
