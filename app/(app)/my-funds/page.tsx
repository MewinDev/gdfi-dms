import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cashToSettleIds, notifyOverdue, requestableJobs } from "@/lib/services/funds";
import { EXPENSE_LABEL, OPEN_ADVANCE, isOverdue, peso, type ExpenseKindKey } from "@/lib/funds/rules";
import { businessDate } from "@/lib/time";
import { dayText } from "@/lib/ui/plain";
import { PageHeader, ToneChip } from "@/components/ui/basics";
import { RequestForm, ReceiptForm, ReturnCashForm, TopUpButton } from "@/components/funds/forms";
import { AdvanceStatusChip } from "@/components/funds/advance-status";

export const metadata: Metadata = { title: "My funds" };

const TABS = [["request", "Request"], ["advances", "My advances"], ["liquidation", "Liquidation"]] as const;

export default async function MyFundsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.FUNDS_REQUEST);
  await notifyOverdue();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "request";
  const now = new Date();
  const today = businessDate(now);
  const [jobs, advances, exception] = await Promise.all([
    requestableJobs(user),
    prisma.cashAdvance.findMany({
      where: { requestedById: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        lines: { include: { transaction: { include: { loan: { select: { pn: true, borrowerName: true } }, type: { select: { name: true } } } }, receipts: true, returns: true, topUps: true, carryOvers: true } },
        returns: true,
      },
    }),
    prisma.fundsException.findFirst({ where: { dpUserId: user.id, usedBy: null } }),
  ]);
  const overdue = advances.filter((a) => isOverdue(a, now));
  const blocked = overdue.length > 0 && !exception
    ? `${overdue.map((a) => a.number).join(", ")} ${overdue.length === 1 ? "is" : "are"} overdue and not yet liquidated. Liquidate first, or ask Finance for a one-time exception.`
    : undefined;
  const lineLeft = (l: (typeof advances)[number]["lines"][number]) => l.releasedCents - l.receipts.reduce((s, r) => s + r.cents, 0) - l.returns.reduce((s, r) => s + r.cents, 0);
  const lineLabel = (l: (typeof advances)[number]["lines"][number]) =>
    `${EXPENSE_LABEL[l.kind as ExpenseKindKey]}${l.transaction ? ` · ${l.transaction.loan.pn} ${l.transaction.type.name}` : l.note ? ` · ${l.note}` : ""}`;
  const open = advances.filter((a) => OPEN_ADVANCE.includes(a.status));
  // The job went back to the LA after the cash was released: still yours to settle.
  const toSettle = await cashToSettleIds(advances);
  const settleChip = (id: string) => toSettle.has(id) && <ToneChip tone="act" title="The job went back to the Loan Associate. Record what was spent and return the rest.">Cash to settle</ToneChip>;

  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageHeader title="My funds" help="Ask Finance for cash for your jobs, then liquidate with receipts and return the rest." />
      <nav aria-label="My funds tabs" className="flex overflow-x-auto border-b border-line">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/my-funds?tab=${k}`} aria-current={tab === k ? "page" : undefined} className="tab shrink-0">
            {l}{k === "liquidation" && open.length > 0 && <span className="ml-1 text-ink-2">{open.length}</span>}
          </Link>
        ))}
      </nav>
      {exception && overdue.length > 0 && <p role="status" className="rounded-xl bg-wait-bg px-4 py-3 text-[15px] text-wait-fg">Finance let you submit one more request while an advance is overdue.</p>}

      {tab === "request" && (
        <section aria-label="Request" className="card p-4 sm:p-5">
          <RequestForm jobs={jobs} blocked={blocked} />
        </section>
      )}

      {tab === "advances" && (
        <section aria-label="My advances" className="flex flex-col gap-3">
          {advances.length === 0 && <p className="card p-5 text-[15px] text-ink-2">No cash advances yet.</p>}
          {advances.map((a) => (
            <article key={a.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-[17px] font-bold text-navy">{a.number}</h2>
                {settleChip(a.id)}
                <AdvanceStatusChip status={a.status} overdue={isOverdue(a, now)} />
              </div>
              <p className="mt-1 text-[13px] text-ink-2">
                Asked {peso(a.requestedCents)} on {dayText(a.createdAt)}
                {a.approvedCents !== null ? ` · approved ${peso(a.approvedCents)}` : ""}
                {a.releasedAt ? ` · released ${peso(a.releasedCents)} on ${dayText(a.releasedAt)}` : ""}
                {a.liquidationDueAt && OPEN_ADVANCE.includes(a.status) ? ` · liquidate by ${dayText(a.liquidationDueAt)}` : ""}
              </p>
              {a.deniedReason && <p className="mt-1 text-[15px] text-bad-fg">Denied: {a.deniedReason}</p>}
              {a.note && <p className="mt-1 text-[13px] font-semibold text-wait-fg">{a.note}</p>}
              {a.approvalNote && <p className="mt-1 text-[13px]">Approver&rsquo;s note: {a.approvalNote}</p>}
              <ul className="mt-2 flex flex-col gap-1.5">
                {a.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5 text-[15px]">
                    <span className="min-w-0 flex-1">{lineLabel(l)} · asked {peso(l.requestedCents)}{l.releasedCents ? ` · released ${peso(l.releasedCents)} · left ${peso(lineLeft(l))}` : ""}{l.denied ? " · not approved" : ""}</span>
                    {l.topUps.filter((t) => t.status === "REQUESTED" || (t.status === "APPROVED" && !t.releasedAt)).map((t) => <ToneChip key={t.id} tone="wait">Top-up {peso(t.extraCents)} {t.status === "REQUESTED" ? "waiting" : "approved"}</ToneChip>)}
                    {l.carryOvers.filter((c) => c.status === "PENDING").map((c) => <ToneChip key={c.id} tone="wait">Carry-over waiting for approval</ToneChip>)}
                    {OPEN_ADVANCE.includes(a.status) && !l.denied && <TopUpButton lineId={l.id} label={lineLabel(l)} />}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}

      {tab === "liquidation" && (
        <section aria-label="Liquidation" className="flex flex-col gap-3">
          {open.length === 0 && <p className="card p-5 text-[15px] text-ink-2">Nothing to liquidate.</p>}
          {open.map((a) => {
            const receipts = a.lines.flatMap((l) => l.receipts.map((r) => ({ ...r, label: lineLabel(l) })));
            const rc = receipts.reduce((s, r) => s + r.cents, 0);
            const ret = a.returns.reduce((s, r) => s + r.cents, 0);
            const balance = a.releasedCents - rc - ret;
            return (
              <article key={a.id} className="card flex flex-col gap-3 p-4 sm:p-5" data-advance={a.number} data-cash-to-settle={toSettle.has(a.id) || undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-[17px] font-bold text-navy">{a.number}</h2>
                  {settleChip(a.id)}
                  <AdvanceStatusChip status={a.status} overdue={isOverdue(a, now)} />
                </div>
                {toSettle.has(a.id) && <p className="text-[13px] text-act-fg" data-settle-note>Cash to settle: the job went back to the Loan Associate. Record what was spent (with receipts) and return the unspent cash.</p>}
                <dl className="grid grid-cols-2 gap-2 text-[15px] sm:grid-cols-4">
                  <div><dt className="text-[13px] text-ink-2">Released</dt><dd className="font-semibold">{peso(a.releasedCents)}</dd></div>
                  <div><dt className="text-[13px] text-ink-2">Receipts</dt><dd className="font-semibold">{peso(rc)}</dd></div>
                  <div><dt className="text-[13px] text-ink-2">Returned</dt><dd className="font-semibold">{peso(ret)}</dd></div>
                  <div><dt className="text-[13px] text-ink-2">Balance</dt><dd className="font-bold text-navy">{peso(balance)}</dd></div>
                </dl>
                <p className="text-[13px] text-ink-2">Liquidate by {dayText(a.liquidationDueAt)}.</p>
                {a.note && <p className="text-[13px] font-semibold text-wait-fg">{a.note}</p>}
                {balance > 0 && <ReceiptForm lines={a.lines.filter((l) => l.releasedCents > 0).map((l) => ({ id: l.id, label: lineLabel(l), balanceCents: lineLeft(l) }))} today={today} />}
                {balance > 0 && <ReturnCashForm advanceId={a.id} balanceCents={balance} today={today} />}
                {receipts.length > 0 && (
                  <ul className="border-t border-line pt-2 text-[15px]">
                    {receipts.map((r) => (
                      <li key={r.id} className="flex flex-wrap gap-x-2">
                        <span>{dayText(r.date)} · {r.number} · {peso(r.cents)} · {r.label}</span>
                        {r.fileKey && <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener" className="link">View file</a>}
                      </li>
                    ))}
                  </ul>
                )}
                {a.returns.length > 0 && (
                  <p className="text-[13px] text-ink-2">Returned: {a.returns.map((r) => r.kind === "HANDOVER" ? `${peso(r.cents)} handed to the second processor (Pasuyo) on ${dayText(r.date)}` : `${peso(r.cents)} cash on ${dayText(r.date)}${r.confirmedAt ? " (confirmed)" : " (Finance to confirm)"}`).join("; ")}</p>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
