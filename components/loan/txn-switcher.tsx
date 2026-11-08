"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/ui/icons";
import type { TxnStatus } from "@/lib/ui/txn-status";
import { TxnStatusChips } from "./txn-status-chips";

export interface TxnItem {
  code: string;
  /** Fixed number (order on the loan file). */
  n: number;
  name: string;
  /** The one status wording (lib/ui/txn-status.ts): chip, line, papers, TAT chip, markers. */
  status: TxnStatus;
  /** Dot on strip cards: red (missing paper or problem), navy (hold). */
  dot?: "bad" | "navy" | null;
  href: string;
  done: boolean;
}

const FOCUS_KEY = "dms:txn-opened";

/** Opens a transaction: remembers to move focus to its heading, then changes ?tx= (refresh and Back keep it). */
function useSelect() {
  const router = useRouter();
  return (item: TxnItem) => {
    try { sessionStorage.setItem(FOCUS_KEY, item.name); } catch { /* focus move is a nicety */ }
    router.push(item.href, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

function Badge({ item, selected }: { item: TxnItem; selected?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.done ? "bg-ok-bg text-ok-fg" : selected ? "bg-gold text-navy" : "bg-fill-strong text-navy"}`}>
      {item.done ? <CheckIcon size={12} strokeWidth={3} /> : item.n}
    </span>
  );
}

const OpenNow = () => <span className="chip h-5 shrink-0 bg-navy px-2 text-[11px] text-white" data-open-now>Open now</span>;

export function PackageSummary({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1" data-package-summary>
      <p className="text-[13px] font-semibold text-navy">{done} of {total} required papers</p>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-fill-strong" role="progressbar" aria-label="Required papers ticked" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className="block h-full rounded-full bg-ok-fg" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/**
 * Desktop (1100 and up): "Transactions (n)", every transaction in its fixed number order. The open one
 * stays in its place and is marked (navy border, light navy background, "Open now"); the order never changes.
 */
export function TxnSideList({ items, selected, summary }: { items: TxnItem[]; selected: string; summary: { done: number; total: number } }) {
  const select = useSelect();
  return (
    <section aria-labelledby="all-txns" className="card flex shrink-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <PackageSummary {...summary} />
        <h2 id="all-txns" className="text-[15px] font-bold text-navy">Transactions ({items.length})</h2>
      </div>
      <ul>
        {items.map((i) => {
          const on = i.code === selected;
          return (
            <li key={i.code} className="border-t border-[rgb(12_35_64/0.1)] first:border-t-0">
              <button type="button" onClick={() => (on ? undefined : select(i))} data-txn={i.code} aria-current={on ? "true" : undefined}
                className={`flex min-h-16 w-full items-start gap-3 px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy ${on ? "bg-select-bg shadow-[inset_3px_0_0_var(--gold)]" : "hover:bg-fill"}`}>
                <span className="pt-0.5"><Badge item={i} selected={on} /></span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="flex items-center gap-2"><span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{i.name}</span>{on && <OpenNow />}</span>
                  <span className="block text-[13px] text-ink-2"><span data-status-line>{i.status.line}</span>{i.status.papers && <span className="text-xs"> · {i.status.papers}</span>}</span>
                  <span className="mt-0.5 block"><TxnStatusChips s={i.status} /></span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Tablet and phone: every transaction as a card in number order; only the strip scrolls, to keep the open card in view. */
export function TxnStrip({ items, selected, summary }: { items: TxnItem[]; selected: string; summary: { done: number; total: number } }) {
  const select = useSelect();
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const ul = ref.current;
    const card = ul?.querySelector<HTMLElement>("[aria-current='true']");
    if (!ul || !card) return;
    // Scroll the strip only (never the page) so the open card is fully visible.
    const left = card.offsetLeft - ul.offsetLeft;
    if (left < ul.scrollLeft || left + card.offsetWidth > ul.scrollLeft + ul.clientWidth) ul.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
  }, [selected]);
  return (
    <section aria-label="Transactions" className="flex min-w-0 flex-col gap-2">
      <PackageSummary {...summary} />
      <ul ref={ref} className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {items.map((i) => {
          const on = i.code === selected;
          return (
            <li key={i.code} className="shrink-0 snap-start">
              <button type="button" onClick={() => (on ? undefined : select(i))} aria-current={on ? "true" : undefined} data-txn={i.code}
                className={`flex h-full min-h-[72px] w-[208px] flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${on ? "border-line-soft bg-select-bg shadow-[inset_3px_0_0_var(--gold)]" : "border-line bg-white hover:border-navy/40"}`}>
                <span className="flex w-full items-center gap-2">
                  <Badge item={i} selected={on} /><span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{i.name}</span>
                  {i.dot && <span role="img" aria-label={i.dot === "bad" ? "Has an open item" : "On hold"} data-dot={i.dot} className={`h-2.5 w-2.5 shrink-0 rounded-full ${i.dot === "bad" ? "bg-[var(--bad-fg)]" : "bg-navy"}`} />}
                  {on && <OpenNow />}
                </span>
                <span className="line-clamp-1 text-xs text-ink-2" title={i.status.line} data-status-line>{i.status.line}</span>
                <TxnStatusChips s={i.status} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** After a row or card is pressed: focus the opened transaction's heading and announce it. */
export function SelectionFocus({ headingId }: { headingId: string }) {
  const [said, setSaid] = useState("");
  useEffect(() => {
    let name: string | null = null;
    try {
      name = sessionStorage.getItem(FOCUS_KEY);
      if (name !== null) sessionStorage.removeItem(FOCUS_KEY);
    } catch { /* storage blocked */ }
    if (name === null) return;
    const h = document.getElementById(headingId);
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    const t = window.setTimeout(() => setSaid(`${name} opened`), 50);
    return () => window.clearTimeout(t);
  }, [headingId]);
  return <p role="status" aria-live="polite" className="sr-only">{said}</p>;
}

/** A one-time message left by the previous screen (e.g. "Notary sent. Next: EDST"). */
export const TOAST_KEY = "dms:toast";
export function StoredToast() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let t: string | null = null;
    try {
      t = sessionStorage.getItem(TOAST_KEY);
      if (t !== null) sessionStorage.removeItem(TOAST_KEY);
    } catch { /* no toast */ }
    if (!t) return;
    const show = window.setTimeout(() => setText(t), 0);
    const hide = window.setTimeout(() => setText(null), 4500);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, []);
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none fixed bottom-24 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white shadow-lg sm:bottom-6">
      <CheckIcon size={16} /> {text}
    </div>
  );
}
