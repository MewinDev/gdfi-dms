import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cashToSettleIds, notifyOverdue } from "@/lib/services/funds";
import { EXPENSE_LABEL, OPEN_ADVANCE, ageBucket, bandFor, isOverdue, peso, type ExpenseKindKey } from "@/lib/funds/rules";
import { businessDate, businessDaysBetween } from "@/lib/time";
import { ltoEstimate } from "@/lib/ui/lto";
import { getHolidaySet } from "@/lib/settings";
import { dayText } from "@/lib/ui/plain";
import { PageHeader, ToneChip } from "@/components/ui/basics";
import { AdvanceStatusChip } from "@/components/funds/advance-status";
import { ChangeTypeForm, DecideAdvanceForm, GrantExceptionForm, ReleaseForm, SmallAction, TopUpReleaseForm } from "@/components/funds/forms";
import { FundsTypePill } from "@/components/funds/funds-type-pill";
import { RecordHistory } from "@/components/funds/record-history";
import { releaseLine } from "@/lib/funds/types";
import { DownloadIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Funds" };

const TABS = [["approve", "To approve"], ["release", "To release"], ["outstanding", "Outstanding"], ["history", "History"]] as const;
const BUCKETS = ["0-10", "11-30", "31-60", "60+"] as const;

const include = {
  fundsType: true,
  requestedBy: { select: { id: true, name: true } },
  branch: { select: { name: true } },
  lines: {
    include: {
      transaction: {
        include: {
          loan: { select: { pn: true, borrowerName: true } }, type: { select: { name: true } },
          dpAssignments: { where: { status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED", "CLOSED"] as never } }, orderBy: { createdAt: "desc" }, take: 1, include: { ltoOffice: true } },
        },
      },
      ltoOffice: true, receipts: true, returns: true, topUps: true, carryOvers: true,
    },
  },
  returns: true,
} as const;

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ tab?: string; ftype?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.FUNDS_VIEW_ALL);
  await notifyOverdue();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "approve";
  const now = new Date();
  const branchScope = user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } };
  // Filter by funds type (?ftype=CA): every list, the counts and the CSV follow it.
  const fundsTypes = await prisma.fundsType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const ftype = fundsTypes.find((t) => t.code === sp.ftype)?.code;
  const scope = { ...branchScope, ...(ftype ? { fundsTypeCode: ftype } : {}) };
  const [requested, approved, open, history, topUps, carries, bands, me, holidays] = await Promise.all([
    prisma.cashAdvance.findMany({ where: { ...scope, status: "REQUESTED" }, include, orderBy: { createdAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: "APPROVED" }, include, orderBy: { approvedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: [...OPEN_ADVANCE, "LIQUIDATED"] as never } }, include, orderBy: { releasedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: ["CLOSED", "DENIED", "CANCELLED"] } }, include, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.cashAdvanceTopUp.findMany({ where: { releasedAt: null, status: { in: ["REQUESTED", "APPROVED"] }, line: { advance: branchScope }, ...(ftype ? { fundsTypeCode: ftype } : {}) }, include: { line: { include: { advance: { select: { number: true, requestedBy: { select: { name: true } } } } } } } }),
    prisma.carryOver.findMany({ where: { status: "PENDING", line: { advance: scope } }, include: { line: { include: { advance: { select: { number: true, requestedBy: { select: { name: true } } } } } } } }),
    prisma.approvalBand.findMany(),
    prisma.user.findUnique({ where: { id: user.id }, select: { roleId: true } }),
    getHolidaySet(),
  ]);
  const toSettle = await cashToSettleIds(open.map((a) => ({ id: a.id, status: a.status, requestedById: a.requestedBy.id, lines: a.lines })));
  const mayApprove = can(user, PERMISSIONS.FUNDS_APPROVE);
  const mayRelease = can(user, PERMISSIONS.FUNDS_RELEASE);
  const myBand = (cents: number) => bandFor(cents, bands)?.roleId === me?.roleId;
  const lineLabel = (l: (typeof requested)[number]["lines"][number]) => {
    // The job's office now, and the one it had when the cash was asked for.
    const now = l.transaction?.dpAssignments[0]?.ltoOffice ?? null;
    const asked = l.ltoOffice;
    const office = now ?? asked;
    const changed = asked && now && asked.id !== now.id ? ` · Office changed from ${asked.name} to ${now.name}` : "";
    return `${EXPENSE_LABEL[l.kind as ExpenseKindKey]}${l.transaction ? ` · ${l.transaction.loan.pn} ${l.transaction.type.name} (${l.transaction.loan.borrowerName})` : l.note ? ` · ${l.note}` : ""}${office ? ` · At ${office.name}: ${ltoEstimate(office) ?? "No estimate yet"}` : ""}${changed}`;
  };
  const balanceOf = (a: (typeof open)[number]) => a.releasedCents - a.lines.flatMap((l) => l.receipts).reduce((s, r) => s + r.cents, 0) - a.returns.reduce((s, r) => s + r.cents, 0);
  const ageOf = (a: (typeof open)[number]) => (a.releasedAt ? businessDaysBetween(businessDate(a.releasedAt), businessDate(now), holidays) : 0);
  const overdueDps = new Map(open.filter((a) => isOverdue(a, now)).map((a) => [a.requestedBy.id, a.requestedBy.name]));
  const counts = { approve: requested.length + topUps.filter((t) => t.status === "REQUESTED").length + carries.length, release: approved.length + topUps.filter((t) => t.status === "APPROVED").length, outstanding: open.length, history: history.length };
  // Counts by type for the filter chips (same branch scope, every open or recent record of the tab).
  const tabStatus: Record<string, string[]> = { approve: ["REQUESTED"], release: ["APPROVED"], outstanding: [...OPEN_ADVANCE, "LIQUIDATED"], history: ["CLOSED", "DENIED", "CANCELLED"] };
  const byType = await prisma.cashAdvance.groupBy({ by: ["fundsTypeCode"], where: { ...branchScope, status: { in: tabStatus[tab] as never } }, _count: { _all: true } });
  const typeCount = (code: string) => byType.find((b) => b.fundsTypeCode === code)?._count._all ?? 0;
  const allCount = byType.reduce((s, b) => s + b._count._all, 0);
  const activeTypes = fundsTypes.filter((t) => t.active);
  const typeOptions = activeTypes.map((t) => ({ id: t.id, code: t.code, name: t.name, needsReference: t.needsReference, needsAccount: t.needsAccount }));
  const today = businessDate(now);
  const href = (o: { tab?: string; ftype?: string | null }) => {
    const p = new URLSearchParams({ tab: o.tab ?? tab });
    const f = o.ftype === undefined ? ftype : o.ftype;
    if (f) p.set("ftype", f);
    return `/funds?${p.toString()}`;
  };
  const ids = [...requested, ...approved, ...open, ...history].map((a) => a.id);
  const audit = ids.length ? await prisma.auditLog.findMany({ where: { entityType: "CashAdvance", entityId: { in: ids } }, orderBy: { at: "asc" }, select: { id: true, entityId: true, summary: true, actorLabel: true, at: true } }) : [];
  const historyOf = (id: string) => audit.filter((r) => r.entityId === id).map((r) => ({ id: r.id, text: r.summary, when: dayText(r.at) }));
  const settleCount = open.filter((a) => toSettle.has(a.id)).length;

  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageHeader title="Funds" help="Approve and release cash advances, then follow liquidation until each is closed." />
      <nav aria-label="Funds tabs" className="flex overflow-x-auto border-b border-line">
        {TABS.map(([k, l]) => (
          <Link key={k} href={href({ tab: k })} aria-current={tab === k ? "page" : undefined} className="tab shrink-0">{l} <span className="ml-1 text-ink-2">{counts[k]}</span></Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2" data-funds-type-filter>
        <span className="text-[13px] font-semibold text-ink-2">Type</span>
        <Link href={href({ ftype: null })} aria-current={!ftype ? "true" : undefined} className={`chip c-mute no-underline ${!ftype ? "ring-2 ring-[var(--navy)]" : ""}`}>All · {allCount}</Link>
        {fundsTypes.filter((t) => t.active || typeCount(t.code) > 0).map((t) => (
          <Link key={t.id} href={href({ ftype: t.code })} aria-current={ftype === t.code ? "true" : undefined} className={`no-underline ${ftype === t.code ? "rounded-full ring-2 ring-[var(--navy)]" : ""}`} data-filter-type={t.code}>
            <FundsTypePill code={t.code} name={`${t.name} · ${typeCount(t.code)}`} />
          </Link>
        ))}
        {tab === "outstanding" && settleCount > 0 && <ToneChip tone="act">Cash to settle · {settleCount}</ToneChip>}
        <a href={`/api/funds/export?tab=${tab}${ftype ? `&ftype=${ftype}` : ""}`} className="btn-ghost btn-sm ml-auto inline-flex min-h-11 items-center gap-1.5" data-funds-csv><DownloadIcon size={16} /> Download CSV</a>
      </div>

      {tab === "approve" && (
        <div className="flex flex-col gap-3">
          {counts.approve === 0 && <p className="card p-5 text-[15px] text-ink-2">Nothing to approve.</p>}
          {requested.map((a) => {
            const own = a.requestedBy.id === user.id;
            const inBand = myBand(a.requestedCents);
            return (
              <article key={a.id} className="card flex flex-col gap-2 p-4 sm:p-5" data-advance={a.number}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-[17px] font-bold text-navy">{a.number} · {peso(a.requestedCents)}</h2>
                  <FundsTypePill code={a.fundsTypeCode} name={a.fundsTypeName} />
                  <AdvanceStatusChip status={a.status} />
                  {mayRelease && <ChangeTypeForm advanceId={a.id} current={a.fundsTypeId} types={typeOptions} />}
                </div>
                <p className="text-[13px] text-ink-2">{a.requestedBy.name} · {a.branch.name} · asked {dayText(a.createdAt)}{a.exceptionId ? " · with a one-time exception" : ""}</p>
                {mayApprove && !own && inBand ? (
                  <DecideAdvanceForm advanceId={a.id} lines={a.lines.map((l) => ({ id: l.id, label: lineLabel(l), requestedCents: l.requestedCents, overMaxReason: l.overMaxReason }))} />
                ) : (
                  <>
                    <ul className="text-[15px]">{a.lines.map((l) => <li key={l.id}>{lineLabel(l)} · {peso(l.requestedCents)}</li>)}</ul>
                    <p className="text-[13px] text-ink-2">{own ? "Your own request: someone else approves it." : !mayApprove ? "You can view only." : "Another role approves this amount (approval bands)."}</p>
                  </>
                )}
              </article>
            );
          })}
          {topUps.filter((t) => t.status === "REQUESTED").map((t) => (
            <article key={t.id} className="card flex flex-col gap-2 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-[17px] font-bold text-navy">{t.line.advance.number} · top-up {peso(t.extraCents)}</h2><FundsTypePill code={t.fundsTypeCode} name={t.fundsTypeName} /></div>
              <p className="text-[15px]">{t.line.advance.requestedBy.name}: {t.reason}</p>
              {mayApprove && t.requestedById !== user.id && myBand(t.extraCents) && (
                <div className="flex flex-wrap gap-2"><SmallAction kind="topup-approve" id={t.id} label="Approve the extra" cls="btn-primary btn-sm" /><SmallAction kind="topup-deny" id={t.id} label="Deny" extra /></div>
              )}
            </article>
          ))}
          {carries.map((c) => (
            <article key={c.id} className="card flex flex-col gap-2 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-navy">{c.line.advance.number} · carry-over {peso(c.cents)}</h2>
              <p className="text-[15px]">{c.line.advance.requestedBy.name} wants to keep the balance beyond the carry-over limit ({c.businessDays} business days).</p>
              {mayApprove && <div className="flex flex-wrap gap-2"><SmallAction kind="carry-approve" id={c.id} label="Approve carry-over" cls="btn-primary btn-sm" /><SmallAction kind="carry-deny" id={c.id} label="Deny (return the cash)" /></div>}
            </article>
          ))}
        </div>
      )}

      {tab === "release" && (
        <div className="flex flex-col gap-3">
          {counts.release === 0 && <p className="card p-5 text-[15px] text-ink-2">Nothing to release.</p>}
          {approved.map((a) => (
            <article key={a.id} className="card flex flex-col gap-2 p-4 sm:p-5" data-advance={a.number}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-[17px] font-bold text-navy">{a.number} · {peso(a.approvedCents ?? 0)}</h2>
                <FundsTypePill code={a.fundsTypeCode} name={a.fundsTypeName} />
                <AdvanceStatusChip status={a.status} />
                {mayRelease && <ChangeTypeForm advanceId={a.id} current={a.fundsTypeId} types={typeOptions} />}
              </div>
              <p className="text-[13px] text-ink-2">{a.requestedBy.name} · {a.branch.name} · approved {dayText(a.approvedAt)}{a.approvalNote ? ` · ${a.approvalNote}` : ""}</p>
              <ul className="text-[15px]">{a.lines.map((l) => <li key={l.id}>{lineLabel(l)} · {l.denied ? "not approved" : peso(l.approvedCents ?? 0)}</li>)}</ul>
              {mayRelease && a.requestedBy.id !== user.id && <ReleaseForm advanceId={a.id} type={a.fundsType} today={today} />}
              <RecordHistory rows={historyOf(a.id)} />
            </article>
          ))}
          {topUps.filter((t) => t.status === "APPROVED").map((t) => (
            <article key={t.id} className="card flex flex-wrap items-center gap-2 p-4 sm:p-5" data-topup={t.id}>
              <h2 className="mr-auto text-[17px] font-bold text-navy">{t.line.advance.number} · top-up {peso(t.approvedCents ?? 0)}</h2>
              <FundsTypePill code={t.fundsTypeCode} name={t.fundsTypeName} />
              {mayRelease && <TopUpReleaseForm topUpId={t.id} currentTypeId={t.fundsTypeId} types={typeOptions.some((o) => o.id === t.fundsTypeId) ? typeOptions : [...typeOptions, { id: t.fundsTypeId, code: t.fundsTypeCode, name: t.fundsTypeName, needsReference: false, needsAccount: false }]} today={today} />}
            </article>
          ))}
        </div>
      )}

      {tab === "outstanding" && (
        <div className="flex flex-col gap-4">
          <section aria-label="Age" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BUCKETS.map((b) => {
              const xs = open.filter((a) => a.status !== "LIQUIDATED" && ageBucket(ageOf(a)) === b);
              return (
                <div key={b} className="card px-4 py-3">
                  <p className="text-[13px] text-ink-2">{b} business days</p>
                  <p className="text-xl font-bold text-navy">{peso(xs.reduce((s, a) => s + balanceOf(a), 0))}</p>
                  <p className="text-[13px]">{xs.length} advance{xs.length === 1 ? "" : "s"}</p>
                </div>
              );
            })}
          </section>
          {overdueDps.size > 0 && can(user, PERMISSIONS.FUNDS_EXCEPTION) && (
            <section aria-label="Overdue processors" className="card flex flex-col gap-2 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-navy">Overdue processors</h2>
              <p className="text-[13px] text-ink-2">They cannot request a new advance until they liquidate. You can allow one more request.</p>
              {[...overdueDps].map(([id, name]) => (
                <div key={id} className="flex flex-wrap items-center gap-2"><span className="mr-auto text-[15px] font-semibold">{name}</span><GrantExceptionForm dpUserId={id} name={name} /></div>
              ))}
            </section>
          )}
          {open.length === 0 && <p className="card p-5 text-[15px] text-ink-2">No outstanding advances.</p>}
          {open.map((a) => {
            const bal = balanceOf(a);
            const unconfirmed = a.returns.filter((r) => !r.confirmedAt);
            return (
              <article key={a.id} className="card flex flex-col gap-2 p-4 sm:p-5" data-advance={a.number} data-cash-to-settle={toSettle.has(a.id) || undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-[17px] font-bold text-navy">{a.number} · balance {peso(bal)}</h2>
                  <FundsTypePill code={a.fundsTypeCode} name={a.fundsTypeName} />
                  {toSettle.has(a.id) && <ToneChip tone="act" title="The job went back to the Loan Associate; the processor settles the cash.">Cash to settle</ToneChip>}
                  <ToneChip tone="mute">{ageOf(a)} business days</ToneChip>
                  <AdvanceStatusChip status={a.status} overdue={isOverdue(a, now)} />
                </div>
                <p className="text-[13px] text-ink-2">{a.requestedBy.name} · {a.fundsType.needsReference || a.fundsType.needsAccount ? "sent" : "released"} {peso(a.releasedCents)} on {dayText(a.releasedAt)} ({releaseLine(a)}){a.liquidationDueAt ? ` · liquidate by ${dayText(a.liquidationDueAt)}` : " · no receipts needed for this type"}</p>
                {a.note && <p className="text-[13px] font-semibold text-wait-fg" data-advance-note>{a.note}</p>}
                <ul className="text-[15px]">
                  {a.lines.flatMap((l) => l.receipts.map((r) => (
                    <li key={r.id}>{dayText(r.date)} · {r.number} · {peso(r.cents)} · {lineLabel(l)} {r.fileKey && <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener" className="link">View file</a>}</li>
                  )))}
                </ul>
                {unconfirmed.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 text-[15px]">
                    <span className="mr-auto">Cash returned {peso(r.cents)} on {dayText(r.date)}</span>
                    {mayRelease && <SmallAction kind="confirm-return" id={r.id} label="Confirm received" cls="btn-secondary btn-sm" />}
                  </div>
                ))}
                {a.status === "LIQUIDATED" && mayRelease && unconfirmed.length === 0 && <div><SmallAction kind="close" id={a.id} label="Close advance" cls="btn-primary btn-sm" /></div>}
                <RecordHistory rows={historyOf(a.id)} />
              </article>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <section aria-label="History" className="card overflow-hidden">
          {history.length === 0 ? <p className="p-5 text-[15px] text-ink-2">No closed or denied advances yet.</p> : history.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
              <FundsTypePill code={a.fundsTypeCode} name={a.fundsTypeName} />
              <span className="min-w-0 flex-1 text-[15px]"><span className="font-semibold">{a.number}</span> · {a.requestedBy.name} · asked {peso(a.requestedCents)}{a.releasedCents ? ` · released ${peso(a.releasedCents)}` : ""}{a.deniedReason ? ` · ${a.deniedReason}` : ""}</span>
              <AdvanceStatusChip status={a.status} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
