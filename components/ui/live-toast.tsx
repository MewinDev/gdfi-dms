"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fmtShort } from "@/lib/time";
import { CheckIcon } from "./icons";

/**
 * In-page toasts: a form that saved something calls announce("Notary put on hold: Waiting on borrower").
 * <LiveToast /> shows it for a few seconds; <LiveAnnouncer /> reads it out (polite live region).
 */
export const TOAST_EVENT = "dms:live-toast";

export function announce(text: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));
}

type Act<S> = (prev: S, fd: FormData) => Promise<S>;
/**
 * Wraps a server action so a successful save says what happened (toast and live region) as soon as
 * it returns, even when the refreshed page no longer shows the form that saved it.
 */
export function announcing<S extends { ok: boolean; message?: string } | null>(action: Act<S>): Act<S> {
  return async (prev, fd) => {
    const r = await action(prev, fd);
    if (r?.ok && r.message) announce(r.message);
    return r;
  };
}

/** After a successful save: close the pop-up. */
export function useCloseWhenDone(state: { ok: boolean } | null, close: () => void) {
  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);
}

function useLastAnnouncement(clearAfter: number | null) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let hide: number | undefined;
    const on = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      if (clearAfter) { window.clearTimeout(hide); hide = window.setTimeout(() => setText(null), clearAfter); }
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => { window.removeEventListener(TOAST_EVENT, on); window.clearTimeout(hide); };
  }, [clearAfter]);
  return text;
}

/** The visible toast (bottom centre, above the phone tab bar). */
export function LiveToast() {
  const text = useLastAnnouncement(4500);
  if (!text) return null;
  return (
    <div aria-hidden="true" data-live-toast className="pointer-events-none fixed bottom-24 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white shadow-lg sm:bottom-6">
      <CheckIcon size={16} /> {text}
    </div>
  );
}

/** A polite live region that says the same words (place it inside the card that lists open items). */
export function LiveAnnouncer() {
  const text = useLastAnnouncement(null);
  return <p role="status" aria-live="polite" className="sr-only" data-live-announcer>{text ?? ""}</p>;
}

const subscribeMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 15_000);
  return () => window.clearInterval(id);
};
const minuteNow = () => Math.floor(Date.now() / 60_000);

/** "Starts now: Nov 7, 12:51 PM PHT" (read-only, from the clock; the server records the real time). */
export function NowLine({ label }: { label: string }) {
  const m = useSyncExternalStore(subscribeMinute, minuteNow, () => null);
  return (
    <p className="rounded-xl bg-fill px-3 py-2 text-[15px] text-ink" data-now-line>
      {label}: <strong className="font-semibold">{m === null ? "..." : `${fmtShort(new Date(m * 60_000))} PHT`}</strong>
    </p>
  );
}
