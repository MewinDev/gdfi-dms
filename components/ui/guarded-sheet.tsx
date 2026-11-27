"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { SheetHandle, useDragToClose } from "./sheet-drag";
import { XIcon } from "./icons";
import { DISCARD_BODY, dirtyState, type FormValues } from "@/lib/ui/dirty";

const valuesOf = (form: HTMLFormElement): FormValues => [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]);

/**
 * The pop-up sheet (centred card on tablet and desktop, bottom sheet on phone) with the app's
 * discard-confirm: closing with X, Cancel, Esc or a click outside asks "Discard your changes?" only
 * when the form inside differs from the values it opened with. Same words as the Settings pop-ups.
 * Put <SheetCancel /> in the form: its Cancel goes through the same check.
 */
const CloseContext = createContext<() => void>(() => {});

/** The form's Cancel button: asks first when something changed. */
export function SheetCancel({ children = "Cancel" }: { children?: React.ReactNode }) {
  const requestClose = useContext(CloseContext);
  return <button type="button" className="btn-ghost" onClick={requestClose}>{children}</button>;
}

export function GuardedSheet({
  open, onClose, title, children, dragToClose = true,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
  /** D-062: on a phone, a grab handle instead of the X; drag down to close (components/ui/sheet-drag.tsx). On by default. */
  dragToClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initial = useRef(new WeakMap<HTMLFormElement, FormValues>());
  const [ask, setAsk] = useState<string[] | null>(null);
  const id = `gsheet-${title.replace(/\W+/g, "-").toLowerCase()}`;

  const forms = () => [...(ref.current?.querySelectorAll("form") ?? [])];
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Remember the values the form opened with (after React has rendered the defaults).
      window.setTimeout(() => { for (const f of forms()) initial.current.set(f, valuesOf(f)); }, 0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const requestClose = useCallback(() => {
    const fs = forms().filter((f) => initial.current.has(f));
    const r = dirtyState({ forms: fs.map((f) => ({ initial: initial.current.get(f)!, current: valuesOf(f) })) });
    if (!r.dirty) { onClose(); return; }
    const labels = r.kind === "form"
      ? [...new Set(fs.flatMap((f) => r.changed.map((n) => {
          const el = f.elements.namedItem(n) as HTMLInputElement | null;
          return el?.labels?.[0]?.textContent?.replace(/\s*\(optional\)\s*$/i, "").trim() || n;
        })))]
      : [];
    setAsk(labels);
  }, [onClose]);

  // D-062: drag down to close on a phone (components/ui/sheet-drag.tsx).
  const { dragProps, onHandleClick } = useDragToClose(ref, requestClose, open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); requestClose(); }}
      onClick={(e) => { if (e.target === ref.current) requestClose(); }}
      className="mb-0 mt-auto w-full max-w-none overscroll-contain rounded-t-2xl border border-line bg-white p-0 text-ink backdrop:bg-navy/40 sm:m-auto sm:w-[min(520px,calc(100vw-32px))] sm:max-w-none sm:rounded-2xl"
    >
      <div className={`max-h-[85dvh] overflow-y-auto p-5 sm:max-h-none sm:p-6 ${dragToClose ? "max-sm:pt-2" : ""}`}>
        {dragToClose && <SheetHandle dragProps={dragProps} onClick={onHandleClick} />}
        <div className={`mb-4 flex items-start justify-between gap-3 ${dragToClose ? "max-sm:touch-none" : ""}`} {...(dragToClose ? dragProps : {})}>
          <h2 id={id} className="text-xl font-bold text-navy">{title}</h2>
          <button type="button" onClick={requestClose} className={`-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:bg-hover ${dragToClose ? "max-sm:hidden" : ""}`} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <CloseContext.Provider value={requestClose}>{open && children}</CloseContext.Provider>
      </div>
      <ConfirmDialog
        open={!!ask}
        title="Discard your changes?"
        body={DISCARD_BODY.form}
        detail={ask?.length ? `Changed: ${ask.join(", ")}.` : undefined}
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onCancel={() => setAsk(null)}
        onConfirm={() => { setAsk(null); onClose(); }}
      />
    </dialog>
  );
}
