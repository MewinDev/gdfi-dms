"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * The one "are you sure" window: a small centred card on top of whatever is open, with a darker
 * dimmed background. Role alertdialog. Focus goes to the safe button (Keep editing / Cancel), stays
 * inside, and returns to where it was on close. Esc and a click on the dimmed background mean
 * "cancel"; it never closes the window underneath by itself. While it is open, the windows
 * underneath are hidden from screen readers (aria-hidden).
 * Tone "gold" (money: Approve): Cancel is white, the confirm button gold; while it works both buttons are
 * disabled and the confirm button says `pendingLabel` ("Approving..."), so a double tap cannot act twice.
 * `sheetOnPhone`: below 640 px it is a bottom sheet with 44 px buttons.
 */
export function ConfirmDialog({
  open, title, body, detail, confirmLabel, cancelLabel = "Cancel", tone = "navy", pending = false, onConfirm, onCancel, confirmForm,
  confirmName, confirmValue, pendingLabel = "Working...", sheetOnPhone = false, data,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  /** One extra line, e.g. "Changed: Name, Branches." */
  detail?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" only for Discard and Reset test data; "gold" for approving money. */
  tone?: "navy" | "danger" | "gold";
  pending?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  /** When set, the confirm button submits this form (id) instead of calling onConfirm. */
  confirmForm?: string;
  /** The confirm button's name and value when it submits a form (decision=approve). */
  confirmName?: string;
  confirmValue?: string;
  /** What the confirm button says while it works. */
  pendingLabel?: string;
  /** A bottom sheet on a phone (below 640 px), 44 px buttons. */
  sheetOnPhone?: boolean;
  /** A data attribute on the window, for tests ("approve-confirm"). */
  data?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const hidden = useRef<Element[]>([]);
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  // Portal only after hydration (the server renders nothing here), so server and browser agree.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      // Hide the windows underneath from screen readers while the question is open.
      hidden.current = [...document.querySelectorAll("dialog[open]")].filter((x) => x !== d && x.getAttribute("aria-hidden") !== "true");
      for (const x of hidden.current) x.setAttribute("aria-hidden", "true");
      d.showModal();
      cancelRef.current?.focus();
    }
    if (!open && d.open) {
      d.close();
      for (const x of hidden.current) x.removeAttribute("aria-hidden");
      hidden.current = [];
      const el = returnTo.current;
      window.setTimeout(() => { if (el && el.isConnected) el.focus(); }, 0);
    }
  }, [open]);
  useEffect(() => () => { for (const x of hidden.current) x.removeAttribute("aria-hidden"); }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation(); // never reaches the window underneath (React bubbles through portals)
    if (e.key === "Escape") { e.preventDefault(); if (!pending) onCancel(); return; }
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={onKeyDown}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); if (!pending) onCancel(); }}
      onClick={(e) => { e.stopPropagation(); if (e.target === ref.current && !pending) onCancel(); }}
      data-confirm-dialog={data}
      className={`m-auto w-[calc(100vw-32px)] max-w-[420px] rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-navy/70 ${sheetOnPhone ? "max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none" : ""}`}
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="text-lg font-bold text-navy">{title}</h2>
        <div id={bodyId} className="mt-2 text-[15px] leading-relaxed">
          {body}
          {detail && <p className="mt-2 text-sm text-ink-2">{detail}</p>}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={tone === "gold" && pending}
            className={tone === "gold" ? "btn-secondary h-11 min-h-11 w-full" : "btn-navy h-[52px] w-full sm:h-11"} data-confirm-cancel>{cancelLabel}</button>
          <button
            type={confirmForm ? "submit" : "button"}
            form={confirmForm}
            name={confirmForm ? confirmName : undefined}
            value={confirmForm ? confirmValue : undefined}
            onClick={confirmForm ? undefined : onConfirm}
            disabled={pending}
            aria-busy={pending}
            data-confirm-ok
            className={tone === "gold" ? "btn-gold h-11 min-h-11 w-full" : `h-[52px] w-full rounded-xl border-2 px-4 text-[15px] font-semibold sm:h-11 ${tone === "danger" ? "border-bad-fg bg-white text-bad-fg hover:bg-bad-bg" : "border-navy bg-white text-navy hover:bg-fill"} disabled:opacity-60`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
