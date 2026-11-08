"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * The one "are you sure" window: a small centred card on top of whatever is open, with a darker
 * dimmed background. Role alertdialog. Focus goes to the safe button (Keep editing / Cancel), stays
 * inside, and returns to where it was on close. Esc and a click on the dimmed background mean
 * "cancel"; it never closes the window underneath by itself. While it is open, the windows
 * underneath are hidden from screen readers (aria-hidden).
 */
export function ConfirmDialog({
  open, title, body, detail, confirmLabel, cancelLabel = "Cancel", tone = "navy", pending = false, onConfirm, onCancel, confirmForm,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  /** One extra line, e.g. "Changed: Name, Branches." */
  detail?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" only for Discard and Reset test data. */
  tone?: "navy" | "danger";
  pending?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  /** When set, the confirm button submits this form (id) instead of calling onConfirm. */
  confirmForm?: string;
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
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
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
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
      onClick={(e) => { e.stopPropagation(); if (e.target === ref.current) onCancel(); }}
      className="m-auto w-[calc(100vw-32px)] max-w-[420px] rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-navy/70"
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="text-lg font-bold text-navy">{title}</h2>
        <div id={bodyId} className="mt-2 text-[15px] leading-relaxed">
          {body}
          {detail && <p className="mt-2 text-sm text-ink-2">{detail}</p>}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-navy h-[52px] w-full sm:h-11">{cancelLabel}</button>
          <button
            type={confirmForm ? "submit" : "button"}
            form={confirmForm}
            onClick={confirmForm ? undefined : onConfirm}
            disabled={pending}
            className={`h-[52px] w-full rounded-xl border-2 px-4 text-[15px] font-semibold sm:h-11 ${tone === "danger" ? "border-bad-fg bg-white text-bad-fg hover:bg-bad-bg" : "border-navy bg-white text-navy hover:bg-fill"} disabled:opacity-60`}
          >
            {pending ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
