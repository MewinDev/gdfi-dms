"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState } from "react";
import { acceptJobAction } from "@/app/actions/jobs";
import { FormMessage } from "@/components/form-status";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { listArrowKeys } from "@/components/ui/list-keys";
import { FUNDS_LABEL } from "@/lib/funds/rules";
import { FUNDS_TONE } from "@/lib/jobs/view";
import { fmtDate } from "@/lib/time";
import { txnName } from "@/lib/ui/plain";
import { JOB_STATUS_LABELS, type TimeLeft } from "@/lib/jobs/list";
import type { JobRow } from "@/lib/services/job-queries";
import { waitedShort } from "@/lib/work/inbox-groups";

/**
 * D-064: the DP Jobs list, the same design as the Loans page and the Inbox (D-059, D-063). Desktop: one line per job
 * under column titles (Borrower with the PN under it, Branch, Transaction with its step, Funds, Sent by, Due, Time
 * left; Amount only with "See loan amounts"). Phone and tablet: a card with the same data, nothing cut. The whole row
 * opens the details panel (a side panel, a bottom sheet on a phone) without leaving Jobs; the arrow keys move between
 * rows, Enter opens, Esc closes and the focus goes back to the row.
 */

const CHIP = "chip h-5 whitespace-nowrap px-1.5 text-[11px]";
const TONE: Record<TimeLeft["tone"], string> = { bad: "c-bad", act: "c-act", ok: "c-ok", hold: "c-hold", mute: "c-mute" };
const tabLabel = (r: JobRow) => (r.tab === "returned" ? "Returned" : JOB_STATUS_LABELS[r.tab]);
const stepOf = (r: JobRow) => r.stage ?? tabLabel(r);

export interface JobsPerms {
  /** The person's id (Resume is only for whoever put the job on hold). */
  me: string;
  /** "Put on hold" (holds:raise). */
  hold: boolean;
  /** Open loan file (loans:view). */
  loans: boolean;
  /** "See loan amounts": the Amount column and the panel's amount. */
  amounts: boolean;
}

export function JobsView({ rows, perms, empty }: { rows: JobRow[]; perms: JobsPerms; empty: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const open = rows.find((r) => r.id === openId) ?? null;
  const close = () => {
    const id = openId;
    setOpenId(null);
    if (id) window.setTimeout(() => refs.current.get(id)?.focus(), 0);
  };
  // The desktop columns, shared by the titles and the rows (Amount only with the tick).
  const cols = perms.amounts
    ? "lg:grid-cols-[minmax(9rem,1.3fr)_minmax(5rem,0.7fr)_minmax(8rem,1.3fr)_7rem_6.5rem_minmax(5.5rem,0.8fr)_6.5rem_7.5rem_1rem]"
    : "lg:grid-cols-[minmax(9rem,1.3fr)_minmax(5rem,0.7fr)_minmax(8rem,1.3fr)_7rem_minmax(5.5rem,0.8fr)_6.5rem_7.5rem_1rem]";
  return (
    <>
      <section aria-label="Jobs" className="card overflow-hidden" data-jobs-list>
        {!rows.length ? <p className="px-4 py-4 text-sm text-ink-2" data-jobs-empty>{empty}</p> : (
          <>
            <div aria-hidden="true" className={`hidden border-b border-line bg-fill/60 px-3 py-1 text-xs font-semibold text-ink-2 sm:px-4 lg:grid lg:gap-x-3 ${cols}`} data-jobs-head>
              <span>Borrower</span><span>Branch</span><span>Transaction</span><span>Funds</span>{perms.amounts && <span>Amount</span>}<span>Sent by</span><span>Due</span><span>Time left</span><span />
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <JobLine r={r} cols={cols} amounts={perms.amounts} onOpen={() => setOpenId(r.id)}
                    refFn={(el) => { if (el) refs.current.set(r.id, el); else refs.current.delete(r.id); }} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Sheet open={!!open} onClose={close} title="Job details" side compact labelledBy="job-panel-title">
        {open && <JobPanel key={open.id} r={open} perms={perms} />}
      </Sheet>
    </>
  );
}

function TimeChip({ t }: { t: TimeLeft | null }) {
  return t ? <span className={`${CHIP} ${TONE[t.tone]}`} data-time-left={t.kind}>{t.text}</span> : null;
}
function FundsSmall({ r }: { r: JobRow }) {
  return r.funds === "NOT_NEEDED" ? null : <span className={`${CHIP} c-${FUNDS_TONE[r.funds]}`} data-funds={r.funds}>{FUNDS_LABEL[r.funds]}</span>;
}
/** Problem, On hold, Replacement, Pasuyo, Package incomplete: small chips (the details are in the panel). */
function Flags({ r }: { r: JobRow }) {
  return (
    <>
      {r.problem && <span className={`${CHIP} c-bad`} data-flag="problem">Problem</span>}
      {r.hold && <span className={`${CHIP} c-hold`} data-flag="hold">On hold</span>}
      {r.incomplete && <span className={`${CHIP} c-act`} data-flag="incomplete">Package incomplete</span>}
      {r.replaces && <span className={`${CHIP} c-navy`} data-flag="replacement">Replacement</span>}
      {r.pasuyo && <span className={`${CHIP} c-wait`} data-flag="pasuyo">Pasuyo</span>}
    </>
  );
}
const Dash = ({ col }: { col: string }) => <span className={`hidden text-ink-2 lg:row-start-1 lg:block ${col}`}><span aria-hidden="true">-</span><span className="sr-only">none</span></span>;

function JobLine({ r, cols, amounts, onOpen, refFn }: { r: JobRow; cols: string; amounts: boolean; onOpen: () => void; refFn: (el: HTMLButtonElement | null) => void }) {
  const due = r.dueDate ? fmtDate(r.dueDate) : null;
  // Column numbers: Borrower 1, Branch 2, Transaction 3, Funds 4, (Amount 5), Sent by, Due, Time left, chevron.
  const c = amounts ? { sent: 6, due: 7, left: 8, chev: 9 } : { sent: 5, due: 6, left: 7, chev: 8 };
  // Whole class names (Tailwind only sees classes written out in full).
  const at = (n: number) => ({ 5: "lg:col-start-5", 6: "lg:col-start-6", 7: "lg:col-start-7", 8: "lg:col-start-8", 9: "lg:col-start-9" } as Record<number, string>)[n];
  return (
    <button ref={refFn} type="button" onClick={onOpen} onKeyDown={listArrowKeys} aria-haspopup="dialog" data-list-row data-job-row={r.id} data-tab={r.tab}
      className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-fill-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy sm:px-4 lg:min-h-12 lg:items-center lg:gap-y-0.5 lg:py-1.5 ${cols}`}>
      {/* Phone and tablet: 1. the name with the PN under it, the time left at the top right with the due date under it;
          2. the transaction, its step, funds and flags; 3. branch · sent by. Desktop: one line in the columns. */}
      <span className="col-start-1 row-start-1 flex min-w-0 flex-col lg:col-start-1" data-row-who>
        <span className="break-words text-sm font-bold leading-5 text-ink" data-row-name>{r.borrower}</span>
        <span className="font-mono text-[13px] leading-[18px] text-ink-2 [overflow-wrap:anywhere]" data-row-pn>{r.pn}</span>
      </span>
      <span className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 text-right lg:contents">
        <span className={`${at(c.left)} lg:row-start-1 lg:justify-self-start`} data-row-time><TimeChip t={r.timeLeft} /></span>
        {due ? <span className={`whitespace-nowrap text-xs leading-4 text-ink-2 tabular-nums ${at(c.due)} lg:row-start-1 lg:text-left lg:text-[13px] lg:leading-5`} data-row-due><span className="lg:sr-only">Due </span>{due}</span>
          : <Dash col={at(c.due)} />}
      </span>
      <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 lg:col-span-1 lg:col-start-3 lg:row-start-1" data-row-txn>
        <span className="text-[13px] font-semibold text-navy">{txnName(r.typeCode, r.typeName)}</span>
        <span className={`${CHIP} c-wait`} data-row-step>{stepOf(r)}</span>
        <span className="contents lg:hidden"><FundsSmall r={r} /></span>
        <Flags r={r} />
      </span>
      <span className="hidden lg:col-start-4 lg:row-start-1 lg:block" data-row-funds>{r.funds === "NOT_NEEDED" ? <span className="text-ink-2"><span aria-hidden="true">-</span><span className="sr-only">No funds needed</span></span> : <FundsSmall r={r} />}</span>
      {amounts && (r.amount ? <span className="hidden whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink lg:col-start-5 lg:row-start-1 lg:block" data-row-amount>{r.amount}</span> : <Dash col="lg:col-start-5" />)}
      <span className="col-span-2 row-start-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-ink-2 lg:contents">
        <span className="lg:col-start-2 lg:row-start-1 lg:break-words" data-row-branch>{r.branch}</span>
        {amounts && r.amount && <span className="font-semibold text-ink tabular-nums lg:hidden"><span aria-hidden="true">· </span>{r.amount}</span>}
        <span className={`${at(c.sent)} lg:row-start-1 lg:break-words`} data-row-sent><span aria-hidden="true" className="lg:hidden">· </span><span className="lg:sr-only">Sent by </span>{r.sentBy}</span>
      </span>
      <span aria-hidden="true" className={`hidden text-ink-2 ${at(c.chev)} lg:row-start-1 lg:block`}><ChevronRightIcon size={16} /></span>
    </button>
  );
}

/** One fact of the panel: a small label over its value (a dash when empty). */
function Fact({ k, children, data }: { k: string; children: React.ReactNode; data?: string }) {
  return (
    <div className="min-w-0" data-panel-fact={data ?? k.toLowerCase()}>
      <dt className="text-[11px] leading-[14px] text-ink-2">{k}</dt>
      <dd className="break-words text-[13px] font-semibold leading-[18px] text-ink">{children ?? "-"}</dd>
    </div>
  );
}

/** What the processor may do now, from the job's state (the job page has the forms; Accept is here). */
function actionsOf(r: JobRow, p: JobsPerms) {
  const page = `/jobs/${r.id}`;
  const a: { label: string; href: string; key: string }[] = [];
  if (r.tab === "review") {
    a.push({ label: "Review papers or decline", href: `${page}#review`, key: "review" });
    if (p.hold && !r.hold) a.push({ label: "Put on hold", href: `${page}#review`, key: "hold" });
  }
  if (r.tab === "process") {
    if (r.hold) {
      if (r.holdBy === p.me) a.push({ label: "Resume", href: page, key: "resume" });
    } else {
      if (!r.completed) a.push({ label: "Log attempt", href: `${page}#work`, key: "attempt" });
      if (!r.completed && r.stageCount === 0 && r.attempts > 0) a.push({ label: "Complete", href: `${page}#work`, key: "complete" });
      if (r.completed) a.push({ label: "Forward", href: r.stageCount > 0 ? `${page}#stages-h` : `${page}#work`, key: "forward" });
      if (r.funds === "NEEDED") a.push({ label: "Request funds", href: "/my-funds", key: "funds" });
      if (p.hold) a.push({ label: "Put on hold", href: `${page}#work`, key: "hold" });
    }
  }
  return a;
}

function JobPanel({ r, perms }: { r: JobRow; perms: JobsPerms }) {
  const acts = actionsOf(r, perms);
  return (
    <div className="flex flex-col gap-2.5 text-[13px]" data-job-panel={r.id}>
      <div>
        <h3 className="break-words text-[15px] font-bold leading-5 text-navy" data-panel-name>{r.borrower}</h3>
        <p className="flex items-center gap-1"><span className="font-mono text-[13px] text-ink-2" data-panel-pn>{r.pn}</span><CopyButton text={r.pn} label={`Copy PN ${r.pn}`} /></p>
      </div>
      <div className="flex flex-wrap items-center gap-1" data-panel-badges>
        <span className="text-[13px] font-bold text-navy">{txnName(r.typeCode, r.typeName)}</span>
        <span className={`${CHIP} c-wait`}>{stepOf(r)}</span>
        <TimeChip t={r.timeLeft} />
        <Flags r={r} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Fact k="Branch">{r.branch}</Fact>
        <Fact k="Product">{r.product || null}</Fact>
        {perms.amounts && <Fact k="Amount released" data="amount">{r.amount}</Fact>}
        <Fact k="LTO office" data="lto">{r.ltoOffice}</Fact>
        <Fact k="Due" data="due">{r.dueDate ? fmtDate(r.dueDate) : null}</Fact>
        <Fact k="Turnaround time" data="tat">{r.tat?.text ?? null}</Fact>
        <Fact k="Sent by" data="sent">{r.sentBy}</Fact>
        <Fact k="Waited" data="waited">{r.tab === "review" ? waitedShort(r.waiting) : `${waitedShort(r.waiting)} before accepting`}</Fact>
      </dl>
      {r.funds !== "NOT_NEEDED" && (
        <div className="rounded-lg border border-line px-2.5 py-1.5" data-panel-funds>
          <p className="text-[11px] font-semibold leading-[14px] text-ink-2">Funds{r.fundsType ? ` · ${r.fundsType.name}` : ""}</p>
          <dl className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-1">
            <Fact k="Status" data="funds-status"><FundsSmall r={r} /></Fact>
            <Fact k="Requested" data="funds-requested">{r.fundsDetail.requested}</Fact>
            <Fact k="Released" data="funds-released">{r.fundsDetail.released}</Fact>
            <Fact k="Liquidation due" data="funds-liq">{r.fundsDetail.liquidationDue}</Fact>
          </dl>
        </div>
      )}
      {(r.problem || r.hold || r.incomplete || r.earlierReturn || r.pasuyo || r.replaces) && (
        <div className="flex flex-col gap-1 rounded-md bg-fill px-2 py-1.5" data-panel-notes>
          {r.problem && <p className="text-xs text-bad-fg" data-panel-problem><span className="font-semibold">Problem:</span> {r.problem.reason}{r.problem.outsideControl ? " · Outside our control" : ""}</p>}
          {r.hold && <p className="text-xs text-ink" data-panel-hold><span className="font-semibold">On hold:</span> {r.hold.reason} · {r.hold.days} day{r.hold.days === 1 ? "" : "s"}</p>}
          {r.incomplete && <p className="text-xs text-ink" data-panel-incomplete><span className="font-semibold">Package incomplete:</span> {r.incomplete}</p>}
          {r.earlierReturn && <p className="text-xs text-ink" data-panel-return><span className="font-semibold">Came back before:</span> {r.earlierReturn}</p>}
          {r.pasuyo && <p className="text-xs text-ink-2">Pasuyo {r.pasuyo}</p>}
          {r.replaces && <p className="text-xs text-ink-2">Replacement of {r.replaces}: its own turnaround time</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-2.5" data-panel-actions>
        {r.tab === "review" && <AcceptJob id={r.id} what={txnName(r.typeCode, r.typeName)} />}
        {acts.map((x) => <Link key={x.key} href={x.href} className="btn-secondary min-h-11 px-3 text-[13px] sm:min-h-8" data-job-action={x.key}>{x.label}</Link>)}
        <Link href={`/jobs/${r.id}`} className="btn-ghost min-h-11 px-3 text-[13px] sm:min-h-8" data-job-action="open">Open job</Link>
        {perms.loans && <Link href={`/loans/${r.pn}`} className="btn-ghost min-h-11 px-3 text-[13px] sm:min-h-8" data-job-action="loan">Open loan file</Link>}
      </div>
    </div>
  );
}

/**
 * Accept from the panel (D-064): asks first; accepting here says every paper was received (to mark one not received
 * or to decline, use Review papers on the job page). The turnaround time starts today.
 */
function AcceptJob({ id, what }: { id: string; what: string }) {
  const [state, action, pending] = useActionState(acceptJobAction, null);
  const [asking, setAsking] = useState(false);
  const formId = useId();
  const [seen, setSeen] = useState(state);
  if (state !== seen) { setSeen(state); setAsking(false); }
  return (
    <form id={formId} action={action} className="contents">
      <input type="hidden" name="assignmentId" value={id} />
      <button type="button" onClick={() => setAsking(true)} disabled={pending} data-job-action="accept"
        className="inline-flex min-h-11 items-center rounded-lg bg-navy px-3 text-[13px] font-semibold text-white hover:bg-navy/90 disabled:opacity-60 sm:min-h-8">
        {pending ? "Accepting..." : "Accept"}
      </button>
      {state && <div className="w-full"><FormMessage state={state} /></div>}
      <ConfirmDialog open={asking} title={`Accept ${what}?`} body="You received every paper. The job becomes yours and its turnaround time starts today."
        detail="To mark a paper not received, or to decline, use Review papers instead." confirmLabel="Accept" pendingLabel="Accepting..."
        pending={pending} confirmForm={formId} sheetOnPhone data="job-accept-confirm" onCancel={() => setAsking(false)} />
    </form>
  );
}
