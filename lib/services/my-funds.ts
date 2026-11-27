import "server-only";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cashToSettleIds, requestableJobs } from "@/lib/services/funds";
import { allKinds, kindOption, lineKindText } from "@/lib/services/expense-kinds";
import { fileHref } from "@/lib/services/files";
import { OPEN_ADVANCE, isOverdue, peso } from "@/lib/funds/rules";
import { liquidationLineFor } from "@/lib/funds/liquidation";
import { presetWas } from "@/lib/funds/kinds";
import { defaultFundsType, maskedAccount, releaseLine } from "@/lib/funds/types";
import { loadCalendar } from "@/lib/calendar/load";
import { daysFor, daysLeft } from "@/lib/calendar/core";
import { businessDate } from "@/lib/time";
import { dayText, txnName } from "@/lib/ui/plain";
import { lineStatus, liquidationChip, type FundsRowStatus, type LiqChip } from "@/lib/funds/my-list";

/** One row of My funds (D-065): a job that needs funds, or one line of an advance. */
export interface MyFundsRow {
  id: string;
  kind: "need" | "line";
  status: FundsRowStatus;
  borrower: string;
  pn: string;
  txnName: string | null;
  txnCode: string | null;
  lto: string | null;
  typeCode: string | null;
  typeName: string | null;
  requested: string | null;
  released: string | null;
  liq: LiqChip | null;
  dueDate: string | null;
  late: boolean;
  /** The job (its page), when the row is a job's. */
  jobId: string | null;
  transactionId: string | null;
  advanceId: string | null;
  advanceNumber: string | null;
}

/** An advance as its details panel shows it. */
export interface AdvanceDetail {
  id: string; number: string; typeCode: string; typeName: string; status: string; overdue: boolean; toSettle: boolean;
  needsAccount: boolean; mustLiquidate: boolean;
  requested: string; approved: string | null; released: string;
  askedOn: string; approvedBy: string | null; approvedOn: string | null; releasedBy: string | null; releasedOn: string | null;
  sentTo: string | null; releaseText: string | null; deniedReason: string; note: string; approvalNote: string;
  receipt: { confirmed: string | null; mismatch: string | null; resolved: string | null; canConfirm: boolean };
  liquidationLine: string;
  receiptsTotal: string; returnedTotal: string; balanceCents: number; balance: string;
  canLiquidate: boolean;
  lines: { id: string; label: string; jobId: string | null; asked: string; preset: string; released: string | null; leftCents: number; left: string; denied: boolean; waiting: string[]; canAskMore: boolean }[];
  receipts: { id: string; date: string; number: string; amount: string; label: string; href: string | null }[];
  returns: string[];
  history: { id: string; text: string; when: string }[];
}

/** Everything the My funds page needs: the rows, the advances' details and what the Request form needs. */
export async function myFunds(user: CurrentUser, now: Date = new Date()) {
  const today = businessDate(now);
  const [jobs, advances, exception, fundsTypes, kindRows, cal] = await Promise.all([
    requestableJobs(user),
    prisma.cashAdvance.findMany({
      where: { requestedById: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        lines: { include: { transaction: { include: { loan: { select: { pn: true, borrowerName: true } }, type: { select: { code: true, name: true } } } }, receipts: true, returns: true, topUps: true, carryOvers: true } },
        returns: true,
        fundsType: { select: { liquidationDueDays: true, mustLiquidate: true, needsAccount: true } },
      },
    }),
    prisma.fundsException.findFirst({ where: { dpUserId: user.id, usedBy: null } }),
    prisma.fundsType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, needsReference: true, needsAccount: true } }),
    allKinds(),
    loadCalendar(),
  ]);
  const names = new Map(kindRows.map((k) => [k.code, k.name]));
  const txIds = [...new Set(advances.flatMap((a) => a.lines.map((l) => l.transactionId)).filter((x): x is string => !!x))];
  const peopleIds = [...new Set(advances.flatMap((a) => [a.approvedById, a.releasedById, a.receiptConfirmedById]).filter((x): x is string => !!x))];
  const [jobOf, people, audit, toSettle] = await Promise.all([
    txIds.length ? prisma.dpAssignment.findMany({ where: { transactionId: { in: txIds }, OR: [{ dpUserId: user.id }, { secondaryDpUserId: user.id }] }, orderBy: { endorsedAt: "desc" }, select: { id: true, transactionId: true, ltoOffice: { select: { name: true } } } }) : Promise.resolve([]),
    peopleIds.length ? prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    advances.length ? prisma.auditLog.findMany({ where: { entityType: "CashAdvance", entityId: { in: advances.map((a) => a.id) } }, orderBy: { at: "asc" }, select: { id: true, entityId: true, summary: true, at: true } }) : Promise.resolve([]),
    cashToSettleIds(advances),
  ]);
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const job = (txId: string | null) => (txId ? jobOf.find((j) => j.transactionId === txId) ?? null : null);

  const overdue = advances.filter((a) => isOverdue(a, now));
  const blocked = overdue.length > 0 && !exception
    ? `${overdue.map((a) => a.number).join(", ")} ${overdue.length === 1 ? "is" : "are"} overdue and not yet liquidated. Liquidate first, or ask Finance for a one-time exception.`
    : undefined;

  type Adv = (typeof advances)[number];
  type Line = Adv["lines"][number];
  const leftOf = (l: Line) => l.releasedCents - l.receipts.reduce((s, r) => s + r.cents, 0) - l.returns.reduce((s, r) => s + r.cents, 0);
  const labelOf = (l: Line) => `${lineKindText(names, l)}${l.transaction ? ` · ${l.transaction.loan.pn} ${txnName(l.transaction.type.code, l.transaction.type.name)}` : l.note ? ` · ${l.note}` : ""}`;

  const rows: MyFundsRow[] = [];
  for (const j of jobs) {
    const left = j.dueDate ? daysLeft(j.dueDate, today, daysFor(cal, null)) : null;
    rows.push({
      id: `job:${j.transactionId}`, kind: "need", status: "needs", borrower: j.borrower, pn: j.loanPn, txnName: txnName(j.typeCode, j.typeName), txnCode: j.typeCode,
      lto: j.lto?.name ?? null, typeCode: null, typeName: null, requested: null, released: null, liq: null, dueDate: j.dueDate, late: left !== null && left < 0,
      jobId: j.jobId, transactionId: j.transactionId, advanceId: null, advanceNumber: null,
    });
  }
  const details: Record<string, AdvanceDetail> = {};
  for (const a of advances) {
    const over = isOverdue(a, now);
    const due = a.liquidationDueAt ? businessDate(a.liquidationDueAt) : null;
    const left = due ? daysLeft(due, today, daysFor(cal, a.branchId)) : null;
    const mustLiquidate = a.fundsType?.mustLiquidate ?? true;
    const rc = a.lines.reduce((s, l) => s + l.receipts.reduce((x, r) => x + r.cents, 0), 0);
    const ret = a.returns.reduce((s, r) => s + r.cents, 0);
    const balance = a.releasedCents - rc - ret;
    const open = OPEN_ADVANCE.includes(a.status);
    for (const l of a.lines) {
      const status = lineStatus({ advanceStatus: a.status, lineDenied: l.denied, liquidationDue: !!due, overdue: over });
      const j = job(l.transactionId);
      rows.push({
        id: `line:${l.id}`, kind: "line", status,
        borrower: l.transaction?.loan.borrowerName ?? lineKindText(names, l), pn: l.transaction?.loan.pn ?? "",
        txnName: l.transaction ? txnName(l.transaction.type.code, l.transaction.type.name) : "Other expense", txnCode: l.transaction?.type.code ?? null,
        lto: j?.ltoOffice?.name ?? null, typeCode: a.fundsTypeCode, typeName: a.fundsTypeName,
        requested: peso(l.requestedCents), released: l.releasedCents ? peso(l.releasedCents) : null,
        liq: liquidationChip({ status, mustLiquidate, daysLeft: left, waitingFor: !due && a.liquidationBasis !== "FALLBACK" ? "LTO" : null, daysLate: a.daysLate }),
        dueDate: due, late: status === "overdue", jobId: j?.id ?? null, transactionId: l.transactionId, advanceId: a.id, advanceNumber: a.number,
      });
    }
    details[a.id] = {
      id: a.id, number: a.number, typeCode: a.fundsTypeCode, typeName: a.fundsTypeName, status: a.status, overdue: over, toSettle: toSettle.has(a.id),
      needsAccount: !!a.fundsType?.needsAccount, mustLiquidate,
      requested: peso(a.requestedCents), approved: a.approvedCents !== null ? peso(a.approvedCents) : null, released: peso(a.releasedCents),
      askedOn: dayText(a.createdAt), approvedBy: nameOf(a.approvedById), approvedOn: a.approvedAt ? dayText(a.approvedAt) : null,
      releasedBy: nameOf(a.releasedById), releasedOn: a.releasedAt ? dayText(a.releasedAt) : null,
      sentTo: !a.releasedAt && a.accountLast4 ? `${a.accountProvider}, ${a.accountName}, ${maskedAccount(a.accountLast4)}` : null,
      releaseText: a.releasedAt && (a.transferDate || a.accountLast4) ? releaseLine(a) : null,
      deniedReason: a.deniedReason, note: a.note, approvalNote: a.approvalNote,
      receipt: {
        confirmed: a.receiptConfirmedAt ? `Confirmed on ${dayText(a.receiptConfirmedAt)}` : null,
        mismatch: a.receiptMismatchAt && !a.receiptResolvedAt ? a.receiptMismatchNote : null,
        resolved: a.receiptResolvedAt ? `Finance cleared the mismatch: ${a.receiptResolveNote}` : null,
        canConfirm: !!a.fundsType?.needsAccount && !!a.releasedAt && open && !a.receiptConfirmedAt,
      },
      liquidationLine: a.releasedAt ? liquidationLineFor(a) : "",
      receiptsTotal: peso(rc), returnedTotal: peso(ret), balanceCents: balance, balance: peso(balance),
      canLiquidate: open && balance > 0,
      lines: a.lines.map((l) => ({
        id: l.id, label: labelOf(l), jobId: job(l.transactionId)?.id ?? null, asked: peso(l.requestedCents), preset: presetWas(l.presetCents, l.requestedCents),
        released: l.releasedCents ? peso(l.releasedCents) : null, leftCents: leftOf(l), left: peso(leftOf(l)), denied: l.denied,
        waiting: [
          ...l.topUps.filter((t) => t.status === "REQUESTED" || (t.status === "APPROVED" && !t.releasedAt)).map((t) => `Top-up ${peso(t.extraCents)} ${t.status === "REQUESTED" ? "waiting" : "approved"}`),
          ...l.carryOvers.filter((c) => c.status === "PENDING").map(() => "Carry-over waiting for approval"),
        ],
        canAskMore: open && !l.denied,
      })),
      receipts: a.lines.flatMap((l) => l.receipts.map((r) => ({ id: r.id, date: dayText(r.date), number: r.number, amount: peso(r.cents), label: labelOf(l), href: r.fileKey ? fileHref("receipt", r.id) : null }))),
      returns: a.returns.map((r) => r.kind === "HANDOVER" ? `${peso(r.cents)} handed to the second processor (Pasuyo) on ${dayText(r.date)}` : `${peso(r.cents)} cash on ${dayText(r.date)}${r.confirmedAt ? " (confirmed)" : " (Finance to confirm)"}`),
      history: audit.filter((h) => h.entityId === a.id).map((h) => ({ id: h.id, text: h.summary, when: dayText(h.at) })),
    };
  }
  return {
    rows, details, jobs, blocked, exceptionNote: exception && overdue.length > 0 ? "Finance let you submit one more request while an advance is overdue." : null,
    types: fundsTypes, defaultTypeId: defaultFundsType(fundsTypes)?.id ?? "", kinds: kindRows.map(kindOption), canAddKind: can(user, PERMISSIONS.FUNDS_KINDS_MANAGE), today,
  };
}
