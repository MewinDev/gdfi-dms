"use client";

import { useId, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { WhereKind } from "@/lib/ui/documents-tab";

/**
 * Documents tab: one compact card per transaction. Tablet and desktop: a static header (name, "6 of 7
 * with you") and one 34 px line per paper (Paper · Type · ID · Where).
 * Phone: the header is a button that opens and closes the card, and each paper is two lines.
 * Pressing a paper (or Enter) opens its details line: who has it, where, since when (PHT), the Document ID.
 * Every status keeps its word; nothing relies on colour alone.
 */

export interface PaperRow {
  id: string;
  label: string;
  original: boolean;
  /** Full Document ID ("GD1652026901003-CHM-01") and the short one ("CHM-01"); null before the paper has one. */
  code: string | null;
  short: string | null;
  where: { kind: WhereKind; text: string };
  /** The custody sentence (tooltip and details line). */
  custody: string;
}
export interface PaperCard {
  id: string;
  code: string;
  name: string;
  /** "6 of 7 with you" (all the card's papers, whatever the filter). */
  count: string;
  /** Phone: open when it has papers in hand. */
  openOnPhone: boolean;
  rows: PaperRow[];
}

/** Paper · Type · (ID, when the card is 520 px or wider) · Where. */
const COLS = "sm:grid-cols-[minmax(0,1fr)_64px_92px] @min-[520px]:grid-cols-[minmax(0,1fr)_64px_92px_92px]";

export function DocCard({ c }: { c: PaperCard }) {
  const [open, setOpen] = useState(c.openOnPhone);
  const body = useId();
  return (
    <section aria-labelledby={`${body}-h`} className="card @container min-w-0 self-start overflow-hidden" data-doc-card={c.code} data-open={open ? "" : undefined}>
      {/* Phone: the header opens and closes the card; the count stays visible when closed. */}
      <h2 className="sm:hidden">
        <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}
          className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left hover:bg-fill/60" data-card-toggle>
          <ChevronDownIcon size={16} className={`shrink-0 text-ink-2 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          <span className="min-w-0 truncate text-[15px] font-bold text-navy">{c.name}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-2" data-card-count>{c.count}</span>
        </button>
      </h2>
      {/* Tablet and desktop: a static header. */}
      <div className="hidden min-h-11 items-center gap-2 border-b border-line px-3 py-1.5 sm:flex">
        <h2 id={`${body}-h`} className="min-w-0 truncate text-[15px] font-bold text-navy">{c.name}</h2>
        <span className="shrink-0 text-xs tabular-nums text-ink-2" data-card-count>{c.count}</span>
      </div>
      <div id={body} className={`${open ? "" : "hidden"} border-t border-line sm:block sm:border-t-0`}>
        <div aria-hidden="true" className="hidden items-center gap-2 border-b border-line bg-fill/50 px-3 py-1 text-xs text-ink-2 sm:flex">
          <span className={`grid min-w-0 flex-1 items-center gap-2 ${COLS}`}>
            <span>Paper</span><span>Type</span><span className="hidden @min-[520px]:block">ID</span><span>Where</span>
          </span>
        </div>
        <ul>{c.rows.map((r) => <PaperItem key={r.id} r={r} />)}</ul>
      </div>
    </section>
  );
}

function Where({ w }: { w: PaperRow["where"] }) {
  if (w.kind === "with-you") return <span className="inline-flex items-center gap-1.5 font-semibold text-ok-fg" data-where="with-you"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-ok-fg" />{w.text}</span>;
  if (w.kind === "not-yet") return <span className="text-ink-2" data-where="not-yet">{w.text}</span>;
  return <span className="truncate text-ink" data-where="other">{w.text}</span>;
}

function PaperItem({ r }: { r: PaperRow }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const dim = r.where.kind === "not-yet";
  return (
    <li className="border-t border-line first:border-t-0" data-paper-row data-where-kind={r.where.kind}>
      <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-fill/60 sm:h-[34px] sm:py-0" data-paper-line>
        <button type="button" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen(!open)} title={r.custody}
          className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-md text-left text-[13px] sm:grid sm:items-center sm:gap-2 ${COLS}`} data-row-toggle>
          <span className="flex min-w-0 items-center gap-1.5 sm:contents">
            <span className={`min-w-0 truncate font-semibold ${dim ? "text-ink-2" : "text-navy"}`} title={r.label} data-paper-name>{r.label}</span>
            <span className={`chip h-5 shrink-0 justify-self-start px-1.5 text-xs ${r.original ? "c-wait" : "c-mute"}`}>{r.original ? "Original" : "Copy"}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-xs sm:contents sm:text-[13px]">
            <span className="mono hidden min-w-0 truncate text-xs tabular-nums text-ink-2 max-sm:block @min-[520px]:block" title={r.code ?? "No Document ID yet"} data-doc-code>{r.short ?? "–"}</span>
            <span className="min-w-0"><Where w={r.where} /></span>
          </span>
        </button>
      </div>
      <p id={`${id}-d`} hidden={!open} className="px-3 pb-2 text-xs text-ink-2" data-row-details>
        {r.custody}{r.code ? <> Document ID <span className="mono tabular-nums text-ink">{r.code}</span>.</> : null}
      </p>
    </li>
  );
}
