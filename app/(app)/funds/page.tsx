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
import { DecideAdvanceForm, GrantExceptionForm, ReleaseForm, SmallAction } from "@/components/funds/forms";

export const metadata: Metadata = { title: "Funds" };

const TABS = [["approve", "To approve"], ["release", "To release"], ["outstanding", "Outstanding"], ["history", "History"]] as const;
const BUCKETS = ["0-10", "11-30", "31-60", "60+"] as const;

const include = {
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

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.FUNDS_VIEW_ALL);
  await notifyOverdue();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "approve";
  const now = new Date();
  const scope = user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } };
  const [requested, approved, open, history, topUps, carries, bands, me, holidays] = await Promise.all([
    prisma.cashAdvance.findMany({ where: { ...scope, status: "REQUESTED" }, include, orderBy: { createdAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: "APPROVED" }, include, orderBy: { approvedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: [...OPEN_ADVANCE, "LIQUIDATED"] as never } }, include, orderBy: { releasedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: ["CLOSED", "DENIED", "CANCELLED"] } }, include, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.cashAdvanceTopUp.findMany({ where: { releasedAt: null, status: { in: ["REQUESTED", "APPROVED"] }, line: { advance: scope } }, include: { line: { include: { advance: { select: { number: true, requestedBy: { select: { name: true } } } } } } } }),
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

  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageHeader title="Funds" help="Approve and release cash advances, then follow liquidation until each is closed." />
      <nav aria-label="Funds tabs" className="flex overflow-x-auto border-b border-line">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/funds?tab=${k}`} aria-current={tab === k ? "page" : undefined} className="tab shrink-0">{l} <span className="ml-1 text-ink-2">{counts[k]}</span></Link>
        ))}
      </nav>

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
                  <AdvanceStatusChip status={a.status} />
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
              <h2 className="text-[17px] font-bold text-navy">{t.line.advance.number} · top-up {peso(t.extraCents)}</h2>
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
                <AdvanceStatusChip status={a.status} />
              </div>
              <p className="text-[13px] text-ink-2">{a.requestedBy.name} · {a.branch.name} · approved {dayText(a.approvedAt)}{a.approvalNote ? ` · ${a.approvalNote}` : ""}</p>
              <ul className="text-[15px]">{a.lines.map((l) => <li key={l.id}>{lineLabel(l)} · {l.denied ? "not approved" : peso(l.approvedCents ?? 0)}</li>)}</ul>
              {mayRelease && a.requestedBy.id !== user.id && <ReleaseForm advanceId={a.id} />}
            </article>
          ))}
          {topUps.filter((t) => t.status === "APPROVED").map((t) => (
            <article key={t.id} className="card flex flex-wrap items-center gap-2 p-4 sm:p-5">
              <h2 className="mr-auto text-[17px] font-bold text-navy">{t.line.advance.number} · top-up {peso(t.approvedCents ?? 0)}</h2>
              {mayRelease && <SmallAction kind="topup-release" id={t.id} label="Release top-up" cls="btn-primary btn-sm" />}
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
                  {toSettle.has(a.id) && <ToneChip tone="act" title="The job went back to the Loan Associate; the processor settles the cash.">Cash to settle</ToneChip>}
                  <ToneChip tone="mute">{ageOf(a)} business days</ToneChip>
                  <AdvanceStatusChip status={a.status} overdue={isOverdue(a, now)} />
                </div>
                <p className="text-[13px] text-ink-2">{a.requestedBy.name} · released {peso(a.releasedCents)} on {dayText(a.releasedAt)} (ref {a.releaseRef}) · liquidate by {dayText(a.liquidationDueAt)}</p>
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
              </article>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <section aria-label="History" className="card overflow-hidden">
          {history.length === 0 ? <p className="p-5 text-[15px] text-ink-2">No closed or denied advances yet.</p> : history.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
              <span className="min-w-0 flex-1 text-[15px]"><span className="font-semibold">{a.number}</span> · {a.requestedBy.name} · asked {peso(a.requestedCents)}{a.releasedCents ? ` · released ${peso(a.releasedCents)}` : ""}{a.deniedReason ? ` · ${a.deniedReason}` : ""}</span>
              <AdvanceStatusChip status={a.status} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
