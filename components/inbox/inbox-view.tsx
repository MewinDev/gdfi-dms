"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { moveItemAction, poolPreviewAction } from "@/app/actions/work";
import { FormMessage } from "@/components/form-status";
import { CorrectDueDate } from "@/components/jobs/due-date";
import { CopyButton } from "@/components/ui/copy-button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { listArrowKeys } from "@/components/ui/list-keys";
import { NotInDmsBadge } from "@/components/loan/not-in-dms-badge";
import { MyLoansResult, Preview } from "@/components/loan/myloans-result";
import { RefreshIconButton } from "@/components/loan/refresh-preview";
import type { InboxRow } from "@/lib/services/work-items";
import type { PoolPreview } from "@/lib/services/pool-preview";
import { groupByLoan, itemChipText, matchesFilter, waitedShort, dueStatus, type DueStatus, type InboxGroup, type QuickFilter } from "@/lib/work/inbox-groups";
import { AcceptButton, MoveForm, type RowExtras } from "./inbox-rows";

/**
 * D-063: the compact, quick Inbox. Both lists (and With people away for supervisors) come with the page, so a tab
 * switches at once (no page load; the tab stays in the address). One row per LOAN: status chip, borrower, PN, its
 * transactions as small chips, branch, due date; the whole row opens the details panel (a side panel on a tablet or
 * desktop, a bottom sheet on a phone) without leaving the Inbox. Arrow keys move between rows, Enter opens, Esc
 * closes and focus goes back to the row.
 */

export type Tab = "mine" | "pool" | "away";
export interface TabInfo { key: Tab; label: string; n: number; red?: number }

const CHIP: Record<DueStatus["tone"], string> = { bad: "c-bad", act: "c-act", ok: "c-ok", hold: "c-hold" };
const POOL_TEXT: Record<string, string> = { green: "text-ink-2", amber: "font-semibold text-act-fg", red: "font-semibold text-bad-fg" };
const SMALL_CHIP = "chip h-5 whitespace-nowrap px-1.5 text-[11px]";
/** The desktop columns, shared by the header row and the rows: name and PN, branch, transactions, amount, released, due, status, chevron. */
const COLS = "lg:grid-cols-[minmax(9rem,1.2fr)_minmax(5rem,0.7fr)_minmax(0,2fr)_6.5rem_6.5rem_6.5rem_7rem_1rem]";

export function InboxView({ tabs, initial, lists, extras, canOpenLoan, empty, awayTools, poolNote }: {
  tabs: TabInfo[]; initial: Tab; lists: Partial<Record<Tab, InboxRow[]>>; extras: Record<string, RowExtras>; canOpenLoan: boolean;
  empty: Record<Tab, string>; awayTools?: React.ReactNode; poolNote: string;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [openKey, setOpenKey] = useState<{ tab: Tab; key: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  // The Move result stays in view above the list (the moved row may leave it); a good move closes the panel.
  const [moved, move, moving] = useActionState(moveItemAction, null);
  const [seen, setSeen] = useState(moved);
  if (moved !== seen) {
    setSeen(moved);
    if (moved?.ok) setOpenKey(null);
  }

  const groups: Partial<Record<Tab, InboxGroup[]>> = {};
  for (const t of tabs) groups[t.key] = groupByLoan(lists[t.key] ?? []);

  const pick = (t: Tab, e?: React.MouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // a new tab or window: let the link work
    e?.preventDefault();
    setTab(t);
    window.history.replaceState(null, "", `/inbox?tab=${t}`);
  };
  const close = () => {
    const k = openKey;
    setOpenKey(null);
    if (k) window.setTimeout(() => rowRefs.current.get(`${k.tab}:${k.key}`)?.focus(), 0);
  };
  const open = openKey ? groups[openKey.tab]?.find((g) => g.key === openKey.key) ?? null : null;

  return (
    <>
      <nav aria-label="Inbox tabs" className="flex overflow-x-auto border-b border-line" data-scroll-row>
        {tabs.map((t) => (
          <a key={t.key} href={`/inbox?tab=${t.key}`} onClick={(e) => pick(t.key, e)} aria-current={tab === t.key ? "page" : undefined}
            className="tab min-h-11 shrink-0" data-inbox-tab={t.key}>
            {t.label} <span className="ml-1 text-ink-2" data-tab-count>{groups[t.key]?.length ?? t.n}</span>
            {(() => {
              // D-063: in loans, as the rows (a loan whose longest waiting item is red counts once).
              const red = t.key === "pool" ? (groups.pool ?? []).filter((g) => g.poolTone === "red").length : t.red ?? 0;
              return red ? <span className="chip c-bad ml-2 h-5 px-1.5 text-[11px]" title="Waiting too long" data-tab-red>{red} waiting too long</span> : null;
            })()}
          </a>
        ))}
      </nav>
      {moved && <div data-move-result><FormMessage state={moved} /></div>}
      {tabs.map((t) => {
        const all = groups[t.key] ?? [];
        const shown = t.key === "mine" ? all.filter((g) => matchesFilter(g, filter)) : all;
        return (
          <div key={t.key} hidden={tab !== t.key} className="flex flex-col gap-2" data-inbox-pane={t.key}>
            {t.key === "mine" && all.length > 0 && <QuickFilters groups={all} value={filter} onChange={setFilter} />}
            {t.key === "away" && awayTools}
            <section aria-label={t.label} className="card overflow-hidden" data-inbox-list={t.key}>
              {!shown.length
                ? <p className="px-4 py-4 text-sm text-ink-2" data-inbox-empty>{all.length ? "Nothing matches this filter." : empty[t.key]}</p>
                : (<>
                  {/* The user's review: column titles like a table, from 1024 px (the rows are stacked below that). */}
                  <div aria-hidden="true" className={`hidden border-b border-line bg-fill/60 px-3 py-1 text-xs font-semibold text-ink-2 sm:px-4 lg:grid lg:gap-x-3 ${COLS}`} data-inbox-head>
                    <span>Borrower</span><span>Branch</span><span>{t.key === "pool" ? "Status" : "Transactions"}</span><span>Amount</span><span>Released date</span><span>Due</span><span>{t.key === "pool" ? "" : "Time left"}</span><span />
                  </div>
                  <ul className="flex flex-col divide-y divide-line">
                    {shown.map((g) => (
                      <Row key={g.key} g={g} tab={t.key}
                        refFn={(el) => { if (el) rowRefs.current.set(`${t.key}:${g.key}`, el); else rowRefs.current.delete(`${t.key}:${g.key}`); }}
                        onOpen={() => setOpenKey({ tab: t.key, key: g.key })} />
                    ))}
                  </ul>
                </>)}
            </section>
            {t.key === "pool" && <p className="text-xs text-ink-2">{poolNote}</p>}
          </div>
        );
      })}
      {/* The user's review: the title says what it is ("Loan preview" in the Branch pool, "Loan details" in My items); the
          borrower's name is at the top of the body, with the PN under it. */}
      <Sheet open={!!open} onClose={close} title={open?.candidate ? "Loan preview" : "Loan details"} side compact wide={!!open?.candidate} labelledBy="inbox-panel-title">
        {open && openKey && (
          open.candidate
            ? <PoolPanel key={open.key} g={open} />
            : <ItemsPanel key={open.key} g={open} tab={openKey.tab} extras={extras} canOpenLoan={canOpenLoan} move={move} moving={moving} />
        )}
      </Sheet>
    </>
  );
}

function QuickFilters({ groups, value, onChange }: { groups: InboxGroup[]; value: QuickFilter; onChange: (f: QuickFilter) => void }) {
  const opts: { f: QuickFilter; label: string }[] = [{ f: "all", label: "All" }, { f: "late", label: "Late" }, { f: "today", label: "Due today" }, { f: "paused", label: "Paused" }];
  return (
    <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-1.5" data-quick-filters>
      {opts.map(({ f, label }) => {
        const n = groups.filter((g) => matchesFilter(g, f)).length;
        const on = value === f;
        return (
          <button key={f} type="button" aria-pressed={on} onClick={() => onChange(f)} data-quick-filter={f}
            className={`relative inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] sm:min-h-8 sm:before:hidden ${on ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-fill"}`}>
            {label} <span className={on ? "text-white/80" : "text-ink-2"}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}


function Row({ g, tab, refFn, onOpen }: { g: InboxGroup; tab: Tab; refFn: (el: HTMLButtonElement | null) => void; onOpen: () => void }) {
  const due = g.dueText; // with the year (the user's review): "Nov 28, 2026"
  const holder = tab === "away" ? g.items[0].holder : null;
  return (
    <li>
      <button ref={refFn} type="button" onClick={onOpen} onKeyDown={listArrowKeys} aria-haspopup="dialog" data-list-row
        data-inbox-row={g.key} data-state={g.items[0].state} data-status={g.status?.kind ?? "none"}
        className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-fill-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy sm:px-4 lg:min-h-12 ${COLS} lg:items-center lg:gap-y-0.5 lg:py-1.5`}>
        {/* Phone and tablet (the user's review): 1. the name with the PN under it; at the top right the status badge
            with the due date under it; 2. the transactions; 3. branch · amount released; 4. the release date.
            Desktop: one line, each in its own column: name and PN, branch, transactions, amount, released date, due
            date, status. */}
        <span className="col-start-1 row-start-1 flex min-w-0 flex-col lg:col-start-1" data-row-who>
          <span className="break-words text-sm font-bold leading-5 text-ink" data-row-name>{g.name}</span>
          {g.pn && <span className="font-mono text-[13px] leading-[18px] text-ink-2 [overflow-wrap:anywhere]" data-row-pn>{g.pn}</span>}
        </span>
        {(g.status || due) && (
          <span className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 text-right lg:contents">
            {g.status && (
              <span className="lg:col-start-7 lg:row-start-1 lg:justify-self-start" data-row-status>
                <span className={`${SMALL_CHIP} ${CHIP[g.status.tone]}`}>{g.status.text}</span>
              </span>
            )}
            {due && <span className="whitespace-nowrap text-xs leading-4 text-ink-2 tabular-nums lg:col-start-6 lg:row-start-1 lg:text-left lg:text-[13px] lg:leading-5" data-row-due><span className="lg:sr-only">Due </span>{due}</span>}
          </span>
        )}
        <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 lg:col-span-1 lg:col-start-3 lg:row-start-1" data-row-txns>
          {g.candidate ? <NotInDmsBadge className="h-5 px-1.5 text-[11px]" /> : <TxnChips items={g.items} />}
        </span>
        <span className="col-span-2 row-start-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-ink-2 lg:contents">
          <span className="lg:col-start-2 lg:row-start-1 lg:break-words" data-row-branch>{g.branchName}{holder ? ` · ${holder}` : ""}</span>
          {/* The released amount (only with "See loan amounts") beside the branch; the release date on its own line
              under them (a column each on a desktop). */}
          {g.amount && <span className="whitespace-nowrap font-semibold text-ink tabular-nums lg:col-start-4 lg:row-start-1" data-row-amount><span aria-hidden="true" className="lg:hidden">· </span>{g.amount}</span>}
          {g.releasedOn && <span className="basis-full whitespace-nowrap lg:col-start-5 lg:row-start-1 lg:basis-auto" data-row-released-on><span className="lg:sr-only">Released </span>{g.releasedOn /* with the year (the user's review): "Nov 26, 2026" */}</span>}
          {/* The user's review: an empty table cell shows a dash (no amount without the tick, no date yet, no due date in a pool). */}
          {!g.amount && <Dash col="lg:col-start-4" what="amount" />}
          {!g.releasedOn && <Dash col="lg:col-start-5" what="released" />}
          {!due && <Dash col="lg:col-start-6" what="due" />}
        </span>
        {g.poolText && (
          <span className={`col-span-2 row-start-4 text-xs leading-4 lg:col-start-1 lg:col-end-8 lg:row-start-2 ${POOL_TEXT[g.poolTone]}`} data-pool-tone={g.poolTone} data-pool-since>{g.poolText}</span>
        )}
        <span aria-hidden="true" className="hidden text-ink-2 lg:col-start-8 lg:row-start-1 lg:block"><ChevronRightIcon size={16} /></span>
      </button>
    </li>
  );
}

/** An empty desktop table cell: a dash (phones and tablets leave it out of their line). */
function Dash({ col, what }: { col: string; what: string }) {
  return <span className={`hidden text-ink-2 lg:row-start-1 lg:block ${col}`} data-row-empty={what}><span aria-hidden="true">-</span><span className="sr-only">none</span></span>;
}

/**
 * The row's transactions: "Notary · Check and send" per item; when every item is at the same step (the usual case:
 * all four just opened), the names as chips and the step said once ("Notary EDST Entry of PPSR Mortgage · Check and send").
 */
function TxnChips({ items }: { items: InboxRow[] }) {
  const step = items.every((r) => r.txn && r.kindText === items[0].kindText) && items.length > 1 ? items[0].kindText : null;
  if (!step) return <>{items.map((r) => <span key={r.id} className={`${SMALL_CHIP} c-wait`} data-row-txn>{itemChipText(r)}</span>)}</>;
  return (
    <>
      {items.map((r) => <span key={r.id} className={`${SMALL_CHIP} c-wait`} data-row-txn>{r.txn!.name}</span>)}
      <span className="whitespace-nowrap text-xs text-ink-2" data-row-step>· {step}</span>
    </>
  );
}

/** The next step of the loan's most urgent item that is already the person's: where its work is done. */
function nextAction(r: InboxRow): { label: string; href: string } {
  if (r.kind === "TRANSACTION" && r.pn) return { label: "Check papers", href: `/loans/${r.pn}?tab=todo${r.txn ? `&tx=${r.txn.code}` : ""}` };
  if (r.kind === "DP_JOB") return { label: "Open job", href: r.link };
  if (r.kind === "PACKAGE") return { label: "Receive it", href: r.link };
  if (r.kind === "FUND_REQUEST") return { label: "Open in Funds", href: r.link };
  return { label: "Open", href: r.link };
}
const acceptable = (r: InboxRow, x: RowExtras) =>
  !x.noAccept && r.kind !== "LOAN_CANDIDATE" && (r.state === "POOL" || r.state === "INBOX") && r.kind !== "FUND_REQUEST" && r.kind !== "PACKAGE";

function ItemsPanel({ g, tab, extras, canOpenLoan, move, moving }: { g: InboxGroup; tab: Tab; extras: Record<string, RowExtras>; canOpenLoan: boolean; move: (fd: FormData) => void; moving: boolean }) {
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const first = g.items.find((r) => !acceptable(r, extras[r.id] ?? {}));
  const next = first ? nextAction(first) : null;
  return (
    // The user's review: compact and small (15 px name, 11 px labels, 13 px values and lines, tight item cards).
    <div className="flex flex-col gap-2.5 text-[13px]" data-inbox-panel={g.key}>
      <div className="flex flex-col gap-1.5">
        <div data-panel-who>
          <h3 className="break-words text-[15px] font-bold leading-5 text-navy" data-panel-name>{g.name}</h3>
          {g.pn && <p className="flex items-center gap-1"><span className="font-mono text-[13px] text-ink-2" data-panel-pn>{g.pn}</span><CopyButton text={g.pn} label={`Copy PN ${g.pn}`} /></p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Fact k="Branch">{g.branchName}</Fact>
          {g.product && <Fact k="Product">{g.product}</Fact>}
          <Fact k="Released date" data="released">{g.releasedOn ?? "-"}</Fact>
          {!g.amount && g.loanId && <Fact k="Amount released" data="amount-none">-</Fact>}
          {g.amount && <Fact k="Amount released" data="amount">{g.amount}</Fact>}
          {tab === "away" && g.items[0].holder && <Fact k="With">{g.items[0].holder}</Fact>}
        </dl>
      </div>
      <ul className="flex flex-col gap-1.5" aria-label="Work on this loan">
        {g.items.map((r) => {
          const x = extras[r.id] ?? {};
          const st = dueStatus(r);
          return (
            <li key={r.id} className="rounded-lg border border-line px-2.5 py-1.5" data-panel-item={r.txn?.code ?? r.kind}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <h3 className="text-[13px] font-bold leading-[18px] text-navy">{r.txn?.name ?? r.label}</h3>
                {st && <span className={`${SMALL_CHIP} ${CHIP[st.tone]}`} data-panel-status>{st.text}</span>}
              </div>
              {/* The user's review: the details in three labelled columns, lined up in every card. */}
              <dl className="mt-1 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-x-3" data-panel-item-facts>
                <div className="min-w-0"><dt className="text-[11px] leading-[14px] text-ink-2">Step</dt><dd className="break-words text-xs leading-4 text-ink" data-panel-step>{r.kindText}</dd></div>
                <div className="min-w-0"><dt className="text-[11px] leading-[14px] text-ink-2">Due</dt><dd className="text-xs leading-4 text-ink tabular-nums" data-panel-due>{r.dueText ?? (r.state !== "HELD" ? "Starts at accept" : "-")}</dd></div>
                <div className="min-w-0"><dt className="text-[11px] leading-[14px] text-ink-2">Waited</dt><dd className="text-xs leading-4 text-ink" data-panel-waited>{waitedShort(r.waiting)}</dd></div>
              </dl>
              {/* The user's review: why it came to you (a processor's return, a supervisor's move), then what Accept does. */}
              {r.why && (
                <div className="mt-1.5 rounded-md bg-fill px-2 py-1.5" data-panel-why>
                  <p className="text-[11px] font-semibold leading-[14px] text-ink" data-panel-why-title>{r.why.title}</p>
                  {r.why.text && <p className="mt-0.5 break-words text-xs leading-4 text-ink-2" data-panel-why-text>{r.why.text}</p>}
                </div>
              )}
              {r.state === "INBOX" && <p className="mt-1.5 text-xs text-ink-2" data-panel-hint>{r.why ? "Accept it to start its turnaround time." : "Given to you. Accept it to start its turnaround time."}</p>}
              {r.kind === "PACKAGE" && r.state !== "HELD" && <p className="mt-1.5 text-xs text-ink-2" data-panel-hint>Receive it to accept it.</p>}
              {r.kind === "FUND_REQUEST" && r.state !== "HELD" && <p className="mt-1.5 text-xs text-ink-2" data-panel-hint>Approve or Release counts as accepting it.</p>}
              {(acceptable(r, x) || x.giveTo || (x.correct && r.dueDate && r.kind !== "DP_JOB")) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {acceptable(r, x) && <AcceptButton id={r.id} what={r.txn?.name ?? r.kindText} />}
                  {x.giveTo && moveFor !== r.id && <button type="button" className="link inline-flex min-h-9 items-center text-[13px] sm:min-h-8" onClick={() => setMoveFor(r.id)} data-move-open>Move</button>}
                  {x.correct && r.dueDate && r.kind !== "DP_JOB" && <CorrectDueDate subjectType="WorkItem" subjectId={r.id} current={r.dueDate} />}
                </div>
              )}
              {moveFor === r.id && x.giveTo && <div className="mt-2"><MoveForm r={r} people={x.giveTo} action={move} pending={moving} onClose={() => setMoveFor(null)} /></div>}
            </li>
          );
        })}
      </ul>
      {(next || (canOpenLoan && g.loanId && g.pn)) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-2.5">
          {next && <Link href={next.href} className="btn-navy min-h-11 px-3 text-[13px] sm:min-h-8" data-next-action>{next.label}</Link>}
          {canOpenLoan && g.loanId && g.pn && <Link href={`/loans/${g.pn}`} className="btn-secondary min-h-11 px-3 text-[13px] sm:min-h-8" data-open-loan>Open loan file</Link>}
        </div>
      )}
    </div>
  );
}

function Fact({ k, children, data }: { k: string; children: React.ReactNode; data?: string }) {
  return (
    <div className="min-w-0" data-panel-fact={data ?? k.toLowerCase()}>
      <dt className="text-[11px] leading-[14px] text-ink-2">{k}</dt>
      <dd className="break-words text-[13px] font-semibold leading-[18px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * Branch pool, a released loan not yet in the DMS: its preview card (D-060), asked for when the panel opens. Everything
 * the preview page has is here (the user's review: no "Open the full preview" link): the details, the two questions,
 * Open loan file and Refresh from myloans (the icon at the card's top right; it asks myloans again, past the short
 * cache, and the card shows the new answer in place).
 */
function PoolPanel({ g }: { g: InboxGroup }) {
  const pn = g.pn ?? g.key;
  const [data, setData] = useState<PoolPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    let live = true;
    poolPreviewAction(pn).then((p) => { if (live) setData(p); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [pn]);
  const refresh = () => {
    setRefreshing(true);
    setRefreshed(false);
    poolPreviewAction(pn, true).then((p) => { setData(p); setFailed(false); setRefreshed(true); }, () => setFailed(true)).finally(() => setRefreshing(false));
  };
  const refreshButton = <RefreshIconButton pending={refreshing} onClick={refresh} />;
  return (
    <div className="flex flex-col gap-3 text-sm [&_[data-find-facts]]:grid-cols-2! [&_[data-find-head]]:flex-col! [&_[data-find-head]]:items-start! [&_[data-open-questions]]:grid-cols-1! [&_[data-find-preview]]:border-0 [&_[data-find-preview]]:p-0 [&_[data-find-preview]]:shadow-none [&_[data-open-cancel]]:hidden" data-inbox-panel={g.key} data-pool-panel>
      {refreshed && <p role="status" className="text-[13px] text-ink-2" data-preview-refreshed>Refreshed from myloans just now.</p>}
      {failed ? <p role="alert" className="text-bad-fg">The preview could not load. Close this and try again.</p>
        : !data ? <p role="status" className="text-ink-2" data-preview-loading>Loading what myloans says...</p>
        : data.kind === "gone" ? <p className="text-ink-2">This loan is no longer in your branch pool.</p>
        : data.kind === "opened" ? <p className="text-ink-2">It is a loan file now. <Link href={`/loans/${data.pn}`} className="link">Open loan file</Link></p>
        : data.r?.kind === "preview" ? <Preview r={data.r} warnings={data.warnings} waiting={data.waiting} action={refreshButton} />
        : data.r && data.r.kind !== "invalid" ? (
          <>
            <div className="flex items-start justify-between gap-2">{data.waiting ? <p className="text-[13px] text-ink-2" data-preview-waiting>{data.waiting}</p> : <span />}{refreshButton}</div>
            <MyLoansResult r={data.r} q={pn} warnings={[]} />
          </>
        )
        : data.copy ? (
          <section className="flex flex-col gap-2" data-preview-pool-copy>
            <p className="flex items-center gap-1"><span className="font-mono text-[13px]">{pn}</span><CopyButton text={pn} label={`Copy PN ${pn}`} /></p>
            {data.waiting && <p className="text-[13px] text-ink-2" data-preview-waiting>{data.waiting}</p>}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Fact k="CIN">{data.copy.cin}</Fact>
              <Fact k="Branch">{data.copy.branchName}</Fact>
              <Fact k="Product">{data.copy.productName}</Fact>
              {data.copy.amount && <Fact k="Amount released" data="amount">{data.copy.amount}</Fact>}
              <Fact k="Released date">{data.copy.releasedOn}</Fact>
            </dl>
            <p className="text-[13px] text-ink-2">From the last myloans sync. A Loan Associate opens its loan file.</p>
          </section>
        ) : <p className="text-ink-2">No details yet.</p>}
    </div>
  );
}
