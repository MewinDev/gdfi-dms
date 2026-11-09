"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CheckIcon, XIcon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DISCARD_BODY, dirtyState, type DirtyResult, type FormValues } from "@/lib/ui/dirty";

/** Fired by an edit form after a successful save (clears "unsaved changes", shows the toast). */
export const SAVED_EVENT = "settings:saved";

export type ModalFooter =
  | { kind: "done" }
  | { kind: "save"; formId: string; cancelHref: string };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const valuesOf = (form: HTMLFormElement): FormValues => [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]);

/** Plain name of a field for "Changed: Name, Branches." */
function fieldLabel(form: HTMLFormElement, name: string): string {
  if (name === "permissions") return "Permissions";
  const item = form.elements.namedItem(name);
  const el = (item instanceof RadioNodeList ? item[0] : item) as HTMLInputElement | null;
  if (!el) return name;
  const legend = el.closest("fieldset")?.querySelector("legend")?.textContent;
  if ((el.type === "checkbox" || el.type === "radio") && legend && el.closest("fieldset")?.querySelectorAll(`[name="${name}"]`).length !== 1) return legend.trim();
  const label = el.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  if (label) {
    label.querySelectorAll("span.block + span, .help").forEach((x) => x.remove());
    return (label.querySelector("span")?.textContent ?? label.textContent ?? name).trim();
  }
  return legend?.trim() ?? name;
}

type Leave = { href: string } | { browserBack: true };

/**
 * Settings / Users pop-up. Centred window on tablet/desktop, full-screen sheet on phone. Header and
 * footer stay put; the body scrolls. Closes with X, Cancel/Done, Esc or a click outside; Back goes
 * one step back. When something really changed (a form differs from the values it opened with, or an
 * import file was chosen and not imported) a small "Discard your changes?" window asks first, also
 * for the browser Back button. The URL (?open=...) is the source of truth, so refresh and Back work.
 */
export function SettingsModal({
  id, title, help, closeHref, backHref, headerLink, returnFocusId, footer, children,
}: {
  id: string;
  title: string;
  help: string;
  closeHref: string;
  /** Second step (edit form): "Back" goes to this list address. */
  backHref?: string;
  /** Small button in the header, e.g. Import / Export (opens a second step in the same window). */
  headerLink?: { href: string; label: string };
  returnFocusId: string;
  footer: ModalFooter;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [ask, setAsk] = useState<{ leave: Leave; why: Exclude<DirtyResult, { dirty: false }> } | null>(null);
  const [toast, setToast] = useState(false);
  const titleId = `${id}-title`;
  const helpId = `${id}-help`;

  const go = useCallback((href: string) => router.push(href, { scroll: false }), [router]);

  /** Each edit form's values when it opened (React keeps defaultValue in step with typing, so it cannot be used). */
  const initial = useRef(new WeakMap<HTMLFormElement, FormValues>());
  const trackedForms = () => [...(ref.current?.querySelectorAll<HTMLFormElement>("form[data-track-dirty]") ?? [])];
  const remember = useCallback((force = false) => {
    for (const form of trackedForms()) if (force || !initial.current.has(form)) initial.current.set(form, valuesOf(form));
  }, []);
  /** What is unsaved now (nothing on list steps and read-only pop-ups). */
  const check = useCallback((): DirtyResult => {
    const forms = trackedForms().filter((f) => initial.current.has(f));
    const r = dirtyState({
      forms: forms.map((f) => ({ initial: initial.current.get(f)!, current: valuesOf(f) })),
      importPending: !!ref.current?.querySelector('[data-unsaved-import="true"]'),
    });
    if (r.dirty && r.kind === "form") {
      const labels = forms.flatMap((f) => r.changed.filter((n) => f.elements.namedItem(n) || n === "permissions").map((n) => fieldLabel(f, n)));
      return { ...r, changed: [...new Set(labels)] };
    }
    return r;
  }, []);

  const requestLeave = useCallback((href: string) => {
    const r = check();
    if (r.dirty) setAsk({ leave: { href }, why: r });
    else go(href);
  }, [check, go]);

  // Browser Back: while something is unsaved, a guard entry (same address) sits on top of the
  // history. Back lands on it, and the question is asked instead of leaving.
  const armed = useRef(false);
  const leavingBack = useRef(false);
  const arm = useCallback(() => {
    if (armed.current || !check().dirty) return;
    window.history.pushState(window.history.state, "", window.location.href);
    armed.current = true;
  }, [check]);
  useEffect(() => {
    const onPop = () => {
      if (!armed.current || leavingBack.current) return;
      armed.current = false;
      const r = check();
      if (r.dirty) setAsk({ leave: { browserBack: true }, why: r });
      else window.history.back();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [check]);

  const keepEditing = useCallback(() => {
    if (ask && "browserBack" in ask.leave) arm();
    setAsk(null); // the confirm returns focus to where it was (the field, or the X)
  }, [ask, arm]);
  const discard = useCallback(() => {
    if (!ask) return;
    const leave = ask.leave;
    setAsk(null);
    // Drop the unsaved values: the next step loads fresh ones from the server.
    for (const f of trackedForms()) initial.current.delete(f);
    if ("browserBack" in leave) { leavingBack.current = true; window.history.back(); }
    else go(leave.href);
  }, [ask, go]);

  // Open as a modal; lock the background; return focus to the card or row on close.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      window.setTimeout(() => document.getElementById(returnFocusId)?.focus(), 0);
    };
  }, [returnFocusId]);

  // Remember each edit form's values as soon as it is on screen (and, as a fallback, on the first
  // focus/press/key inside, before the browser applies the input). Arm the Back guard on a change.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const take = () => remember();
    take();
    const mo = new MutationObserver(take);
    mo.observe(d, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-unsaved-import"] });
    const events = ["focusin", "pointerdown", "keydown", "beforeinput"] as const;
    for (const ev of events) d.addEventListener(ev, take, true);
    const onChange = () => window.setTimeout(arm, 0);
    d.addEventListener("input", onChange);
    d.addEventListener("change", onChange);
    const mo2 = new MutationObserver(onChange);
    mo2.observe(d, { subtree: true, attributes: true, attributeFilter: ["data-unsaved-import"] });
    return () => {
      mo.disconnect();
      mo2.disconnect();
      for (const ev of events) d.removeEventListener(ev, take, true);
      d.removeEventListener("input", onChange);
      d.removeEventListener("change", onChange);
    };
  }, [remember, arm]);

  // Saved: the saved values are the new starting point; show the toast.
  useEffect(() => {
    const onSaved = () => {
      remember(true);
      setToast(true);
      window.setTimeout(() => setToast(false), 2500);
    };
    window.addEventListener(SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SAVED_EVENT, onSaved);
  }, [remember]);

  // Keep keyboard focus inside the window (the confirm and nested windows handle their own keys).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    const d = ref.current;
    if (!d || !d.contains(e.target as Node) || ask) return;
    if ([...d.querySelectorAll("dialog")].some((x) => (x as HTMLDialogElement).open)) return;
    // Handle Esc ourselves: the browser's own cancel can force-close on a second Esc.
    if (e.key === "Escape") {
      e.preventDefault();
      requestLeave(closeHref);
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !d.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !d.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onKeyDown={onKeyDown}
      onCancel={(e) => { e.preventDefault(); if (e.target === ref.current && !ask) requestLeave(closeHref); }}
      onClose={() => {
        // Closed by the browser while still on screen (should not happen): open again; the URL decides.
        const d = ref.current;
        if (d && d.isConnected && !d.open) d.showModal();
      }}
      onClick={(e) => { if (e.target === ref.current && !ask) requestLeave(closeHref); }}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden bg-white p-0 text-ink backdrop:bg-navy/45 open:flex sm:m-auto sm:h-fit sm:max-h-[85vh] sm:w-[min(900px,calc(100vw-32px))] sm:rounded-2xl sm:border sm:border-line"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          {backHref && (
            <button type="button" onClick={() => requestLeave(backHref)} className="mb-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy">
              <ArrowLeftIcon size={16} /> Back
            </button>
          )}
          <h2 id={titleId} className="text-xl font-bold text-navy">{title}</h2>
          <p id={helpId} className="mt-0.5 text-sm text-ink-2">{help}</p>
          {headerLink && (
            <button type="button" onClick={() => requestLeave(headerLink.href)} className="btn-ghost btn-sm mt-2 sm:hidden">{headerLink.label}</button>
          )}
        </div>
        {headerLink && (
          <button type="button" onClick={() => requestLeave(headerLink.href)} className="btn-ghost btn-sm mt-1 hidden shrink-0 sm:inline-flex">{headerLink.label}</button>
        )}
        <button type="button" onClick={() => requestLeave(closeHref)} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy hover:bg-fill">
          <XIcon size={22} />
        </button>
      </div>

      {/* Body (scrolls) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

      {/* Footer */}
      <div className="shrink-0 border-t border-line px-5 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] sm:px-6 sm:pb-3.5">
        {footer.kind === "save" ? (
          <div key="save" className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className="btn-ghost" onClick={() => requestLeave(footer.cancelHref)}>Cancel</button>
            <button type="submit" form={footer.formId} className="btn-gold">Save</button>
          </div>
        ) : (
          <div key="done" className="flex justify-end">
            <button type="button" className="btn-navy w-full sm:w-auto" onClick={() => requestLeave(closeHref)}>Done</button>
          </div>
        )}
      </div>

      {toast && (
        <div role="status" className="pointer-events-none fixed bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white sm:bottom-6">
          <CheckIcon size={16} /> Saved
        </div>
      )}

      <ConfirmDialog
        open={!!ask}
        title="Discard your changes?"
        body={ask?.why.kind === "import" ? DISCARD_BODY.import : DISCARD_BODY.form}
        detail={ask?.why.kind === "form" && ask.why.changed.length ? `Changed: ${ask.why.changed.join(", ")}.` : undefined}
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onCancel={keepEditing}
        onConfirm={discard}
      />
    </dialog>
  );
}
