"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { addReceiptAction, confirmReceiptAction, recordReturnAction } from "@/app/actions/jobs";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { ChevronRightIcon, FilterIcon, SearchIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { listArrowKeys } from "@/components/ui/list-keys";
import { CHOICE_ROW, PILL, PILL_OFF } from "@/components/ui/filter-pills";
import { ToneChip } from "@/components/ui/basics";
import type { KindOption } from "@/lib/funds/kind-option";
import type { AdvanceDetail, MyFundsRow } from "@/lib/services/my-funds";
import { DEFAULT_FUNDS_STATUS, FUNDS_STATUS_KEYS, FUNDS_STATUS_LABELS, FUNDS_STATUS_TONE, fundsListUrl, shownFundsStatus, toggleFundsStatus, type FundsFacets, type FundsListParams, type FundsRowStatus, type FundsSort, type LiqChip } from "@/lib/funds/my-list";
import { AdvanceStatusChip } from "./advance-status";
import { FundsTypePill } from "./funds-type-pill";
import { RecordHistory } from "./record-history";
import { RequestForm, TopUpButton, type FundsTypeOption, type RequestJob } from "./forms";

/**
 * D-065: the processor's My funds, the same design as Loans and Jobs: one list (one row per job that needs funds and
 * per advance line), status chips with counts, one search, Filters that apply at once; the whole row opens the details
 * panel; Request funds (for the ticked jobs, or all that need funds) opens the request form in the side panel.
 */

const CHIP = "chip h-5 whitespace-nowrap px-1.5 text-[11px]";
const LIQ_TONE: Record<LiqChip["tone"], string> = { bad: "c-bad", act: "c-act", ok: "c-ok", mute: "c-mute" };
const COLS = "lg:grid-cols-[minmax(8.5rem,1.3fr)_minmax(5rem,0.8fr)_minmax(5rem,0.9fr)_3.5rem_6rem_6rem_8.5rem_9rem_1rem]";

export interface RequestSetup { jobs: RequestJob[]; blocked?: string; types: FundsTypeOption[]; defaultTypeId: string; kinds: KindOption[]; canAddKind: boolean }

type Panel = { kind: "request"; ids: string[] } | { kind: "row"; id: string; row: MyFundsRow } | null;

export function MyFundsView({ rows, details, params, counts, txns, request, today }: {
  rows: MyFundsRow[]; details: Record<string, AdvanceDetail>; params: FundsListParams; counts: FundsFacets; txns: { code: string; name: string }[]; request: RequestSetup; today: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  // The request's answer stays in view after the panel closes ("… sent to Finance for approval").
  const [sent, setSent] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const needs = rows.filter((r) => r.kind === "need");
  const needIds = request.jobs.map((j) => j.transactionId);
  const close = () => {
    const p = panel;
    setPanel(null);
    if (p?.kind === "row") window.setTimeout(() => refs.current.get(p.id)?.focus(), 0);
  };
  // The opened row as it is now; if it left the list (settled, so no longer open) the panel keeps it in view.
  const open = panel?.kind === "row" ? rows.find((r) => r.id === panel.id) ?? panel.row : null;
  const reqJobs = panel?.kind === "request" ? request.jobs.filter((j) => panel.ids.includes(j.transactionId)) : [];
  const pick = (tx: string, on: boolean) => setPicked((x) => (on ? [...new Set([...x, tx])] : x.filter((y) => y !== tx)));
  const toRequest = picked.filter((p) => needIds.includes(p));

  return (
    <>
      <FundsFilterBar params={params} counts={counts} txns={txns}
        request={<button type="button" className="btn-navy min-h-11 px-3 text-[13px] sm:min-h-8" onClick={() => { setSent(null); setPanel({ kind: "request", ids: toRequest.length ? toRequest : needIds }); }} data-request-funds
          title={needIds.length ? undefined : "No job needs funds now: you can still ask for other expenses."}>
          {toRequest.length ? `Request funds (${toRequest.length})` : "Request funds"}
        </button>} />
      {sent && <p role="status" className="rounded-lg bg-ok-bg px-3 py-2 text-[13px] text-ok-fg" data-request-sent>{sent}</p>}
      <p className="text-[13px] text-ink-2" role="status" data-funds-total>{rows.length} row{rows.length === 1 ? "" : "s"}{needs.length ? ` · ${needs.length} job${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} funds` : ""}</p>
      <section aria-label="My funds" className="card overflow-hidden" data-funds-list>
        {!rows.length ? <p className="px-4 py-4 text-sm text-ink-2" data-funds-empty>Nothing here. Jobs that need funds show here after you accept them.</p> : (
          <>
            <div aria-hidden="true" className="hidden border-b border-line bg-fill/60 py-1 pr-3 text-xs font-semibold text-ink-2 sm:pr-4 lg:flex">
              <span className="w-9 shrink-0" />
              <div className={`grid min-w-0 flex-1 gap-x-3 ${COLS}`}>
                <span>Borrower</span><span>Transaction</span><span>LTO office</span><span>Type</span><span>Requested</span><span>Released</span><span>Status</span><span>Liquidation due</span><span />
              </div>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex items-stretch" data-funds-row-item>
                  {/* A job that needs funds can be ticked, to request for several at once. */}
                  <span className="flex w-9 shrink-0 items-start justify-center pt-3 lg:items-center lg:pt-0">
                    {r.kind === "need" && r.transactionId && (
                      <label className="relative inline-flex h-5 w-5 items-center justify-center before:absolute before:-inset-3 before:content-['']">
                        <span className="sr-only">Pick {r.borrower} {r.pn} for the request</span>
                        <input type="checkbox" checked={toRequest.includes(r.transactionId)} onChange={(e) => pick(r.transactionId!, e.target.checked)} className="relative z-10 h-4 w-4 accent-[var(--navy)]" data-pick={r.pn} />
                      </label>
                    )}
                  </span>
                  <FundsLine r={r} onOpen={() => setPanel({ kind: "row", id: r.id, row: r })} refFn={(el) => { if (el) refs.current.set(r.id, el); else refs.current.delete(r.id); }} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Sheet open={!!panel} onClose={close} side compact wide labelledBy="funds-panel-title"
        title={panel?.kind === "request" ? "Request funds" : open?.advanceNumber ? `Advance ${open.advanceNumber}` : "Funds details"}>
        {panel?.kind === "request" && (
          <RequestForm key={panel.ids.join(",")} jobs={reqJobs} blocked={request.blocked} types={request.types} defaultTypeId={request.defaultTypeId} kinds={request.kinds} canAddKind={request.canAddKind}
            onCancel={close} onSent={(m) => { setPicked([]); setPanel(null); setSent(m ?? "Sent to Finance for approval."); }} />
        )}
        {open && (open.kind === "need"
          ? <NeedPanel r={open} onRequest={() => setPanel({ kind: "request", ids: [open.transactionId!] })} blocked={request.blocked} />
          : open.advanceId && details[open.advanceId] ? <AdvancePanel key={open.advanceId} a={details[open.advanceId]} today={today} /> : null)}
      </Sheet>
    </>
  );
}

function LiqChipView({ c }: { c: LiqChip | null }) {
  return c ? <span className={`${CHIP} ${LIQ_TONE[c.tone]}`} data-liq={c.kind}>{c.text}</span> : null;
}
function StatusChip({ r }: { r: MyFundsRow }) {
  return <span className={`${CHIP} c-${FUNDS_STATUS_TONE[r.status]}`} data-funds-status={r.status}>{FUNDS_STATUS_LABELS[r.status]}</span>;
}
const Dash = ({ col }: { col: string }) => <span className={`hidden text-ink-2 lg:row-start-1 lg:block ${col}`}><span aria-hidden="true">-</span><span className="sr-only">none</span></span>;

function FundsLine({ r, onOpen, refFn }: { r: MyFundsRow; onOpen: () => void; refFn: (el: HTMLButtonElement | null) => void }) {
  return (
    <button ref={refFn} type="button" onClick={onOpen} onKeyDown={listArrowKeys} aria-haspopup="dialog" data-list-row data-funds-row={r.id} data-status={r.status} data-advance-number={r.advanceNumber ?? undefined}
      className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2 pr-3 text-left hover:bg-fill-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy sm:pr-4 lg:min-h-12 lg:items-center lg:gap-y-0.5 lg:py-1.5 ${COLS}`}>
      {/* Phone and tablet: 1. the name with the PN under it, the status at the top right with the liquidation due under it;
          2. transaction · LTO office; 3. type · requested · released. Desktop: one line in the columns. */}
      <span className="col-start-1 row-start-1 flex min-w-0 flex-col lg:col-start-1" data-row-who>
        <span className="break-words text-sm font-bold leading-5 text-ink" data-row-name>{r.borrower}</span>
        {r.pn && <span className="font-mono text-[13px] leading-[18px] text-ink-2 [overflow-wrap:anywhere]" data-row-pn>{r.pn}</span>}
      </span>
      <span className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 lg:contents">
        <span className="lg:col-start-7 lg:row-start-1" data-row-status><StatusChip r={r} /></span>
        {r.liq ? <span className="lg:col-start-8 lg:row-start-1" data-row-liq><LiqChipView c={r.liq} /></span> : <Dash col="lg:col-start-8" />}
      </span>
      <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 lg:contents">
        <span className="font-semibold text-navy lg:col-start-2 lg:row-start-1" data-row-txn>{r.txnName ?? "-"}</span>
        {r.lto ? <span className="text-ink-2 lg:col-start-3 lg:row-start-1 lg:break-words" data-row-lto><span aria-hidden="true" className="lg:hidden">· </span>{r.lto}</span> : <Dash col="lg:col-start-3" />}
      </span>
      <span className="col-span-2 row-start-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-ink-2 empty:hidden lg:contents">
        {r.typeCode ? <span className="font-semibold text-ink lg:col-start-4 lg:row-start-1" data-row-type>{r.typeCode}</span> : <Dash col="lg:col-start-4" />}
        {r.requested ? <span className="tabular-nums text-ink lg:col-start-5 lg:row-start-1" data-row-requested><span className="lg:sr-only">· Requested </span>{r.requested}</span> : <Dash col="lg:col-start-5" />}
        {r.released ? <span className="tabular-nums text-ink lg:col-start-6 lg:row-start-1" data-row-released><span className="lg:sr-only">· Released </span>{r.released}</span> : <Dash col="lg:col-start-6" />}
      </span>
      <span aria-hidden="true" className="hidden text-ink-2 lg:col-start-9 lg:row-start-1 lg:block"><ChevronRightIcon size={16} /></span>
    </button>
  );
}

function Fact({ k, children, data }: { k: string; children: React.ReactNode; data?: string }) {
  return (
    <div className="min-w-0" data-panel-fact={data ?? k.toLowerCase()}>
      <dt className="text-[11px] leading-[14px] text-ink-2">{k}</dt>
      <dd className="break-words text-[13px] font-semibold leading-[18px] text-ink">{children ?? "-"}</dd>
    </div>
  );
}

/** A job that needs funds: what it is, and Request (or why not now). */
function NeedPanel({ r, onRequest, blocked }: { r: MyFundsRow; onRequest: () => void; blocked?: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px]" data-need-panel={r.pn}>
      <div>
        <h3 className="break-words text-[15px] font-bold leading-5 text-navy">{r.borrower}</h3>
        <p className="font-mono text-[13px] text-ink-2">{r.pn}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Fact k="Transaction" data="txn">{r.txnName}</Fact>
        <Fact k="LTO office" data="lto">{r.lto}</Fact>
        <Fact k="Status" data="status"><StatusChip r={r} /></Fact>
      </dl>
      {blocked && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad-fg">{blocked}</p>}
      <div className="flex flex-wrap gap-2 border-t border-line pt-2.5" data-panel-actions>
        <button type="button" className="btn-navy min-h-11 px-3 text-[13px] sm:min-h-8" onClick={onRequest} disabled={!!blocked} data-funds-action="request">Request</button>
        {r.jobId && <Link href={`/jobs/${r.jobId}`} className="btn-ghost min-h-11 px-3 text-[13px] sm:min-h-8" data-funds-action="job">Open job</Link>}
      </div>
    </div>
  );
}

/**
 * An advance: its jobs and lines, asked vs released, who approved and released it and when, the FT receipt
 * confirmation, the receipts, the liquidation due and how it is counted, and what is left to return. Actions only when
 * allowed: Confirm receipt (a transfer, released, not yet confirmed), Liquidate (a receipt per line, then Return
 * change), Ask for more per line, Open job.
 */
function AdvancePanel({ a, today }: { a: AdvanceDetail; today: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px]" data-advance={a.number} data-cash-to-settle={a.toSettle || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <FundsTypePill code={a.typeCode} name={a.typeName} />
        {a.toSettle && <ToneChip tone="act" title="The job went back to the Loan Associate. Record what was spent and return the rest.">Cash to settle</ToneChip>}
        <AdvanceStatusChip status={a.status} overdue={a.overdue} />
      </div>
      {a.toSettle && <p className="text-xs text-act-fg" data-settle-note>Cash to settle: the job went back to the Loan Associate. Record what was spent (with receipts) and return the unspent cash.</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Fact k="Requested" data="requested">{a.requested} · {a.askedOn}</Fact>
        <Fact k="Approved" data="approved">{a.approved ? `${a.approved}${a.approvedBy ? ` by ${a.approvedBy}` : ""}${a.approvedOn ? ` · ${a.approvedOn}` : ""}` : null}</Fact>
        <Fact k="Released" data="released">{a.releasedOn ? `${a.released}${a.releasedBy ? ` by ${a.releasedBy}` : ""} · ${a.releasedOn}` : null}</Fact>
        <Fact k="Liquidation due" data="liquidation">{a.releasedOn ? a.liquidationLine : null}</Fact>
      </dl>
      {a.releaseText && <p className="text-xs text-ink-2" data-release-line>{a.releaseText}</p>}
      {a.sentTo && <p className="text-xs text-ink-2" data-request-account>To {a.sentTo}</p>}
      {a.deniedReason && <p className="text-xs text-bad-fg">Denied: {a.deniedReason}</p>}
      {a.note && <p className="text-xs font-semibold text-wait-fg">{a.note}</p>}
      {a.approvalNote && <p className="text-xs">Approver&rsquo;s note: {a.approvalNote}</p>}

      <ul className="flex flex-col rounded-lg border border-line" aria-label="Lines">
        {a.lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-0.5 border-t border-line-soft px-2.5 py-1.5 first:border-t-0" data-advance-line>
            <p className="font-semibold text-ink">{l.label}</p>
            <p className="text-xs text-ink-2">Asked {l.asked}{l.preset ? ` (${l.preset})` : ""}{l.released ? ` · released ${l.released} · left ${l.left}` : ""}{l.denied ? " · not approved" : ""}</p>
            {(l.waiting.length > 0 || l.canAskMore || l.jobId) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {l.waiting.map((w) => <ToneChip key={w} tone="wait">{w}</ToneChip>)}
                {l.canAskMore && <TopUpButton lineId={l.id} label={l.label} />}
                {l.jobId && <Link href={`/jobs/${l.jobId}`} className="link inline-flex min-h-11 items-center text-xs sm:min-h-8" data-funds-action="job">Open job</Link>}
              </div>
            )}
          </li>
        ))}
      </ul>

      {a.needsAccount && a.releasedOn && (
        <div className="flex flex-col gap-1.5" data-receipt-block>
          {a.receipt.confirmed && <p className="text-xs text-ink-2" data-receipt-state>Receipt confirmed. {a.receipt.confirmed}</p>}
          {a.receipt.mismatch && <p className="text-xs font-semibold text-bad-fg" data-receipt-mismatch>It did not match. Finance was told: {a.receipt.mismatch}</p>}
          {a.receipt.resolved && <p className="text-xs text-ink-2">{a.receipt.resolved}</p>}
          {a.receipt.canConfirm && <ConfirmReceiptCompact advanceId={a.id} number={a.number} />}
        </div>
      )}

      {a.releasedOn && <p className="text-xs text-ink-2" data-liquidation-line>{a.liquidationLine}. {a.mustLiquidate ? "Counted in working days on your branch's calendar." : ""}</p>}
      {a.releasedOn && (
        <dl className="grid grid-cols-4 gap-x-2 rounded-lg bg-fill px-2.5 py-1.5" data-liquidation-totals>
          <Fact k="Released" data="t-released">{a.released}</Fact>
          <Fact k="Spent" data="t-spent">{a.receiptsTotal}</Fact>
          <Fact k="Returned" data="t-returned">{a.returnedTotal}</Fact>
          <Fact k="Change to return" data="t-change">{a.balance}</Fact>
        </dl>
      )}
      {a.canLiquidate && (
        <section aria-label="Liquidate" className="flex flex-col gap-1.5" data-liquidate>
          <h3 className="text-[13px] font-bold text-navy">Liquidate: a receipt per line</h3>
          {a.lines.filter((l) => l.released && !l.denied).map((l) => <LineReceipt key={l.id} lineId={l.id} label={l.label} left={l.left} today={today} />)}
          {/* Keyed by the balance: after a receipt the change to return is filled in again. */}
          <ReturnChange key={a.balanceCents} advanceId={a.id} balanceCents={a.balanceCents} today={today} />
        </section>
      )}
      {a.receipts.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-line pt-1.5 text-xs" aria-label="Receipts" data-receipts>
          {a.receipts.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <span>{r.date} · {r.number} · {r.amount} · {r.label}</span>
              {r.href && <a href={r.href} target="_blank" rel="noopener" className="link">View file</a>}
            </li>
          ))}
        </ul>
      )}
      {a.returns.length > 0 && <p className="text-xs text-ink-2">Returned: {a.returns.join("; ")}</p>}
      <RecordHistory rows={a.history} />
    </div>
  );
}

const INPUT = "input h-11 min-h-11 py-0 sm:h-8 sm:min-h-8 sm:text-sm";

/** One line's receipt, compact (the request form's style): amount, OR no., date, the file, Add receipt. */
function LineReceipt({ lineId, label, left, today }: { lineId: string; label: string; left: string; today: string }) {
  const [state, action] = useActionState(addReceiptAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-col gap-1 rounded-lg border border-line px-2.5 py-1.5" data-receipt-line={lineId}>
      <input type="hidden" name="lineId" value={lineId} />
      <p className="text-xs"><span className="font-semibold text-ink">{label}</span> <span className="text-ink-2">· left {left}</span></p>
      <div className="flex flex-wrap items-end gap-1.5">
        <div><label htmlFor={`${uid}-a`} className="block text-[11px] leading-[14px] text-ink-2">Amount (PHP)</label><input id={`${uid}-a`} name="amount" inputMode="decimal" required className={`${INPUT} w-28 text-right`} aria-invalid={state?.field === "amount"} /></div>
        <div><label htmlFor={`${uid}-n`} className="block text-[11px] leading-[14px] text-ink-2">Receipt / OR no.</label><input id={`${uid}-n`} name="number" required maxLength={60} className={`${INPUT} w-32`} /></div>
        <div><label htmlFor={`${uid}-d`} className="block text-[11px] leading-[14px] text-ink-2">Receipt date</label><input id={`${uid}-d`} type="date" name="date" max={today} defaultValue={today} required className={`${INPUT} w-36`} /></div>
        <div className="min-w-0 basis-full"><label htmlFor={`${uid}-f`} className="block text-[11px] leading-[14px] text-ink-2">Photo or PDF (up to 5 MB)</label><input id={`${uid}-f`} type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full min-w-0 text-xs file:mr-2 file:rounded file:border file:border-line file:bg-white file:px-2 file:py-1" aria-invalid={state?.field === "file"} /></div>
        <SubmitButton className="btn-secondary min-h-11 px-3 text-[13px] sm:min-h-8">Add receipt</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** The change to return: what is left after the receipts (Finance confirms it). */
function ReturnChange({ advanceId, balanceCents, today }: { advanceId: string; balanceCents: number; today: string }) {
  const [state, action] = useActionState(recordReturnAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-1.5 rounded-lg border border-line px-2.5 py-1.5" data-return-change>
      <input type="hidden" name="advanceId" value={advanceId} />
      <div><label htmlFor={`${uid}-a`} className="block text-[11px] leading-[14px] text-ink-2">Cash returned (PHP)</label><input id={`${uid}-a`} name="amount" inputMode="decimal" defaultValue={(balanceCents / 100).toFixed(2)} required className={`${INPUT} w-28 text-right`} /></div>
      <div><label htmlFor={`${uid}-d`} className="block text-[11px] leading-[14px] text-ink-2">Date</label><input id={`${uid}-d`} type="date" name="date" max={today} defaultValue={today} required className={`${INPUT} w-36`} /></div>
      <SubmitButton className="btn-secondary min-h-11 px-3 text-[13px] sm:min-h-8">Record return</SubmitButton>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

/** A fund transfer's receipt: what the bank or e-wallet shows, checked against what Finance recorded (D-056). */
function ConfirmReceiptCompact({ advanceId, number }: { advanceId: string; number: string }) {
  const [state, action] = useActionState(confirmReceiptAction, null);
  const uid = useId();
  return (
    <form action={action} className="flex flex-col gap-1 rounded-lg border border-line px-2.5 py-1.5" data-confirm-receipt={number}>
      <input type="hidden" name="advanceId" value={advanceId} />
      <p className="text-xs font-semibold text-ink">Confirm you received it <span className="font-normal text-ink-2">· type what your bank or e-wallet shows</span></p>
      <div className="flex flex-wrap items-end gap-1.5">
        <div><label htmlFor={`${uid}-r`} className="block text-[11px] leading-[14px] text-ink-2">Reference number</label><input id={`${uid}-r`} name="ref" required maxLength={60} autoComplete="off" className={`${INPUT} w-36`} aria-invalid={state?.field === "ref"} /></div>
        <div><label htmlFor={`${uid}-a`} className="block text-[11px] leading-[14px] text-ink-2">Amount received (PHP)</label><input id={`${uid}-a`} name="amount" required inputMode="decimal" className={`${INPUT} w-28 text-right`} aria-invalid={state?.field === "amount"} /></div>
        <div><label htmlFor={`${uid}-4`} className="block text-[11px] leading-[14px] text-ink-2">Last 4 digits of the account</label><input id={`${uid}-4`} name="last4" required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" className={`${INPUT} w-24`} aria-invalid={state?.field === "last4"} /></div>
        <SubmitButton className="btn-navy min-h-11 px-3 text-[13px] sm:min-h-8">Confirm receipt</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** The search, the status chips and Filters (Type, Transaction, Late only, Sort), as the Jobs page; Request funds at the end. */
function FundsFilterBar({ params: server, counts, txns, request }: { params: FundsListParams; counts: FundsFacets; txns: { code: string; name: string }[]; request: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [params, setParams] = useState(server);
  const [text, setText] = useState(server.q);
  const key = fundsListUrl(server);
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setParams(server); setText(server.q); }
  const latest = useRef(server);
  useEffect(() => { latest.current = server; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef<number | null>(null);
  const go = (change: Partial<FundsListParams>, replace = false) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setParams(next);
    start(() => (replace ? router.replace(fundsListUrl(next), { scroll: false }) : router.push(fundsListUrl(next), { scroll: false })));
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const onType = (v: string) => {
    setText(v);
    if (timer.current) window.clearTimeout(timer.current);
    const t = v.trim();
    if (t === latest.current.q || (t.length > 0 && t.length < 3)) return;
    timer.current = window.setTimeout(() => go({ q: t }, true), 450);
  };
  const chosen = shownFundsStatus(params.status);
  const anyFilter = params.status.length > 0 || !!params.type || !!params.txn || params.late;
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-funds-filters aria-busy={pending || undefined}>
      <form role="search" aria-label="Search my funds" onSubmit={(e) => { e.preventDefault(); if (timer.current) window.clearTimeout(timer.current); go({ q: text.trim() }); }} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="relative flex h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-line-input bg-white px-3 focus-within:border-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy sm:h-11 sm:flex-1" data-search-box>
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <label htmlFor="find-funds" className="sr-only">Search my funds</label>
          <input id="find-funds" type="search" value={text} onChange={(e) => onType(e.target.value)} autoComplete="off" enterKeyHint="search" placeholder="Search PN or borrower"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none sm:text-[15px]" />
        </div>
        <button type="submit" className="btn-navy h-11 min-h-11 w-full rounded-lg px-5 text-[15px] sm:w-auto" data-search-submit>Search</button>
      </form>
      {/* The user's review: the status choices are in Filters (eight chips crowded the row); the row keeps Filters,
          Clear filters and Request funds. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-3.5 sm:gap-y-2" data-filter-row>
        <MoreFilters params={params} counts={counts} txns={txns} go={go}
          toggle={(k) => go({ status: toggleFundsStatus(latest.current.status, k) })} />
        <span className="text-[13px] text-ink-2" data-status-summary>{params.status.length ? `Showing: ${chosen.map((k) => FUNDS_STATUS_LABELS[k]).join(", ")}` : "Showing: all open"}</span>
        {anyFilter && <Link href={fundsListUrl(params, { status: [], type: null, txn: null, late: false })} className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-navy underline underline-offset-2 sm:min-h-0" data-clear-filters>Clear filters</Link>}
        <span className="ml-auto">{request}</span>
      </div>
    </div>
  );
}

function MoreFilters({ params, counts, txns, go, toggle }: {
  params: FundsListParams; counts: FundsFacets; txns: { code: string; name: string }[]; go: (c: Partial<FundsListParams>) => void;
  toggle: (k: FundsRowStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // A status other than the default (every open one) counts as one filter on.
  const on = (params.status.length ? 1 : 0) + (params.type ? 1 : 0) + (params.txn ? 1 : 0) + (params.late ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const types = Object.keys(counts.type).length ? Object.keys(counts.type).sort() : ["CA", "FT"];
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-expanded={open} aria-controls="funds-filters" onClick={() => setOpen((v) => !v)} aria-label={on ? `Filters, ${on} on` : "Filters"}
        className={`${PILL} ${on ? "border-navy text-navy" : PILL_OFF}`} data-more-filters>
        <FilterIcon size={14} /> Filters
        {on > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1.5 text-[11px] font-bold text-white" data-filter-count>{on}</span>}
      </button>
      {open && (
        <div id="funds-filters" className="absolute left-0 top-full z-40 mt-2 flex max-h-[70dvh] w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:w-auto" data-more-filters-panel>
          <fieldset className="flex flex-col gap-0.5" data-filter="status">
            <legend className="mb-1 text-sm font-semibold text-navy">Status</legend>
            <button type="button" aria-pressed={!params.status.length} onClick={() => go({ status: [] })} className={`${CHOICE_ROW} ${!params.status.length ? "bg-fill font-semibold text-navy" : "text-ink"}`} data-status-option="all">
              <span>All open</span><span className="tabular-nums text-ink-2" data-filter-n>{DEFAULT_FUNDS_STATUS.reduce((s, k) => s + counts.status[k], 0)}</span>
            </button>
            {FUNDS_STATUS_KEYS.map((k) => {
              const sel = params.status.includes(k);
              return (
                <button key={k} type="button" aria-pressed={sel} onClick={() => toggle(k)} className={`${CHOICE_ROW} ${sel ? "bg-fill font-semibold text-navy" : "text-ink"}`} data-status-option={k}>
                  <span className="flex items-center gap-2"><span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${sel ? "border-navy bg-navy text-white" : "border-line-input"}`}>{sel ? "✓" : ""}</span>{FUNDS_STATUS_LABELS[k]}</span>
                  <span className="tabular-nums text-ink-2" data-filter-n>{counts.status[k]}</span>
                </button>
              );
            })}
          </fieldset>
          <fieldset className="flex flex-col gap-0.5 border-t border-line-soft pt-2" data-filter="type">
            <legend className="mb-1 text-sm font-semibold text-navy">Type</legend>
            {([null, ...types] as (string | null)[]).map((t) => (
              <button key={t ?? "any"} type="button" aria-pressed={params.type === t} onClick={() => go({ type: t })} className={`${CHOICE_ROW} ${params.type === t ? "bg-fill font-semibold text-navy" : "text-ink"}`} data-type-option={t ?? "any"}>
                <span>{t === "CA" ? "CA · Cash advance" : t === "FT" ? "FT · Fund transfer" : t ?? "Any"}</span>{t && <span className="tabular-nums text-ink-2" data-filter-n>{counts.type[t] ?? 0}</span>}
              </button>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-semibold text-navy" data-filter="txn">
            Transaction
            <select value={params.txn ?? ""} onChange={(e) => go({ txn: e.target.value || null })} className="input h-11 min-h-11 py-0 text-base font-normal sm:h-10 sm:min-h-10 sm:text-sm">
              <option value="">All transactions</option>
              {txns.map((t) => <option key={t.code} value={t.code}>{t.name} ({counts.txn[t.code] ?? 0})</option>)}
            </select>
          </label>
          <label className={`${CHOICE_ROW} cursor-pointer border-t border-line-soft pt-2`} data-filter="late">
            <span className="flex items-center gap-2"><input type="checkbox" checked={params.late} onChange={() => go({ late: !params.late })} className="h-5 w-5 accent-navy" /> Late only</span>
            <span className="tabular-nums text-ink-2" data-filter-n>{counts.late}</span>
          </label>
          <label className="flex flex-col gap-1 border-t border-line-soft pt-2 text-sm font-semibold text-navy" data-filter="sort">
            Sort
            <select value={`${params.sort}:${params.dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); go({ sort: s as FundsSort, dir: d as "asc" | "desc" }); }} className="input h-11 min-h-11 py-0 text-base font-normal sm:h-10 sm:min-h-10 sm:text-sm">
              <option value="due:asc">Overdue first, then soonest due</option>
              <option value="borrower:asc">Borrower A to Z</option>
              <option value="borrower:desc">Borrower Z to A</option>
              <option value="due:desc">Latest due first</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
