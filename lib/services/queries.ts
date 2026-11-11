import "server-only";
import { borrowerChangedLoanIds } from "./borrower-review";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, inScope, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { loanTat, assignDeadline, type TatMap } from "@/lib/workflow/tat";
import { nextActionForStage, type Stage } from "@/lib/workflow/stage";
import { businessDate } from "@/lib/time";
import { evaluateChecklist } from "./workflow";

// ---------------------------------------------------------------------------
// Loan File detail
// ---------------------------------------------------------------------------

const loanDetailInclude = {
  branch: true,
  openedBy: { select: { name: true } },
  transactions: {
    orderBy: { createdAt: "asc" },
    include: {
      type: { include: { caRules: { where: { active: true } } } },
      checks: { include: { rule: { include: { documentType: true } }, documentItem: true, missingReason: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      dpAssignments: {
        orderBy: { createdAt: "desc" },
        include: { dpUser: { select: { name: true } }, secondaryDpUser: { select: { name: true } }, dpBranch: true, ltoOffice: true, assignedBy: { select: { name: true, active: true } }, receivingLa: { select: { name: true } }, receivingBranch: { select: { name: true } }, returnReason: { select: { name: true } }, stages: { orderBy: { sortOrder: "asc" } } },
      },
      advanceLines: { include: { advance: { select: { id: true, number: true, status: true, fundsTypeCode: true, fundsTypeName: true } } } },
      attempts: { orderBy: { createdAt: "desc" }, include: { reason: true, dpUser: { select: { name: true } }, spends: true } },
      problems: { orderBy: { raisedAt: "desc" }, include: { reason: true } },
      holds: { orderBy: { raisedAt: "desc" }, include: { reason: true, transfers: { orderBy: { at: "asc" } } } },
    },
  },
  documents: { orderBy: [{ documentId: "asc" }, { createdAt: "asc" }], include: { transaction: { include: { type: true } } } },
  exceptions: { orderBy: { raisedAt: "desc" }, include: { transaction: { include: { type: true } } } },
  snapshots: { orderBy: { retrievedAt: "desc" }, take: 5 },
  transmittalItems: { include: { transmittal: true } },
} satisfies Prisma.LoanInclude;

export type LoanDetail = Prisma.LoanGetPayload<{ include: typeof loanDetailInclude }>;

export async function getLoanForUser(user: CurrentUser, pn: string): Promise<LoanDetail | null> {
  const loan = await prisma.loan.findUnique({ where: { pn: pn.toUpperCase() }, include: loanDetailInclude });
  if (!loan || !inScope(user, loan.branchId)) return null; // 404 for out-of-scope
  return loan;
}

export async function getLoanContext(loan: LoanDetail) {
  const [tats, holidays] = await Promise.all([getTatMap(), getHolidaySet()]);

  const tat = loanTat(
    {
      stage: loan.stage, stageSince: loan.stageSince, releasedAt: loan.releasedAt,
      inProcessCodes: loan.transactions.filter((t) => t.status === "IN_PROCESS").map((t) => t.type.code),
    },
    tats, holidays,
  );
  const deadline = assignDeadline(loan.releasedAt, tats, holidays);
  const pastDay2 = businessDate(new Date()) > deadline;

  return { tats, holidays, tat, deadline, pastDay2 };
}

export interface TodoItem {
  text: string;
  owner: string;
  tab?: string;
}

/** The single next action, plus the remaining ones, for the "What to do now" card. */
export function whatToDoNow(loan: LoanDetail): TodoItem[] {
  const items: TodoItem[] = [];
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const openEx = loan.exceptions.filter((e) => e.status === "OPEN");
  for (const e of openEx.filter((e) => e.type !== "LEGAL_DOCS_COMPLETION")) {
    items.push({ text: `Resolve the ${e.type.replace(/_/g, " ").toLowerCase()} exception`, owner: "LA", tab: "exceptions" });
  }
  for (const t of live) {
    const c = evaluateChecklist(t.checks);
    if (t.status === "FOR_CHECKLIST") items.push({ text: `Complete the ${t.type.name} checklist (${c.missing.length} missing)`, owner: "LA", tab: "transactions" });
  }
  for (const t of live) {
    if (t.status === "READY" && t.type.code === "EDST") items.push({ text: "Enter the account in EDST and record the reference", owner: "LA", tab: "transactions" });
    if ((t.status === "READY" || t.status === "RETURNED") && t.type.requiresDp) items.push({ text: `Assign ${t.type.name} to a DP`, owner: "LA", tab: "transactions" });
  }
  for (const ca of advancesOf(loan).filter((c) => c.status === "REQUESTED")) {
    items.push({ text: `Finance to approve cash advance ${ca.number}`, owner: "FIN" });
  }
  for (const t of live) {
    const a = t.dpAssignments[0];
    if (t.status === "ASSIGNED" && a) items.push({ text: `${a.dpUser.name} to accept ${t.type.name}`, owner: "DP" });
    if (t.status === "IN_PROCESS" && a) items.push({ text: `${a.dpUser.name} to process ${t.type.name}`, owner: "DP" });
    if (t.status === "FORWARDED" && a) items.push({ text: `${a.receivingLa?.name ?? "Receiving LA"} to accept the ${t.type.name} package`, owner: "LA" });
  }
  if (items.length === 0) {
    const n = nextActionForStage(loan.stage as Stage);
    items.push({ text: n.label, owner: n.ownerRole });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Loans list and dashboard
// ---------------------------------------------------------------------------

export interface LoanListFilters {
  tab?: string; // queue | all | exceptions | archived
  stage?: string;
  classification?: string;
  branch?: string;
  /** Area id: loans of any branch in that area. */
  area?: string;
  loanType?: string;
  tat?: string; // ON_TIME | DUE_TODAY | OVERDUE
  needsAction?: string; // "1"
  /** Open hold with this reason (HoldReason id), or "ANY" for any open hold. */
  holdReason?: string;
  q?: string;
}

const LA_STAGES = ["Opened", "For checklist", "No DP assignment required", "Awaiting LA acceptance", "For Vault Transmittal"];

export interface LoanRow {
  id: string;
  pn: string;
  borrowerName: string;
  loanType: string;
  productName: string;
  /** "Antipolo (101)". */
  branch: string;
  branchId: string;
  branchName: string;
  branchCode: string | null;
  /** The branch's Area ("" when the branch has none yet). */
  area: string;
  releasedAt: Date;
  amount: number;
  classification: string;
  stage: string;
  tat: ReturnType<typeof loanTat>;
  nextStep: { label: string; ownerRole: string };
  openExceptions: number;
  needsAction: boolean;
  archived: boolean;
  /** A MyLoans change waits for Admin to review. */
  sourceChanged?: boolean;
  /** MyLoans corrected the borrower's details: waiting for the supervisor's review (nothing blocked). */
  borrowerChanged?: boolean;
}

export async function listLoans(user: CurrentUser, f: LoanListFilters, tats?: TatMap, holidays?: Set<string>): Promise<LoanRow[]> {
  const [t, h] = await Promise.all([tats ?? getTatMap(), holidays ?? getHolidaySet()]);
  const where: Prisma.LoanWhereInput = { ...loanScope(user) };
  if (f.tab === "archived") where.archivedAt = { not: null };
  else where.archivedAt = null;
  if (f.tab === "exceptions") where.exceptions = { some: { status: "OPEN" } };
  if (f.stage) where.stage = f.stage;
  if (f.classification) where.classification = f.classification as "FINANCING" | "REFINANCING";
  if (f.branch) where.branchId = f.branch;
  if (f.area) where.branch = { areaId: f.area };
  if (f.loanType) where.loanType = f.loanType;
  if (f.holdReason) where.holds = { some: { resumedAt: null, ...(f.holdReason === "ANY" ? {} : { reasonId: f.holdReason }) } };
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { pn: { contains: q, mode: "insensitive" } },
      { cin: { contains: q, mode: "insensitive" } },
      { cif: { contains: q, mode: "insensitive" } },
      { borrowerName: { contains: q, mode: "insensitive" } },
      // The branch code (3 digits) finds that branch's loan files.
      ...(/^\d{3}$/.test(q) ? [{ branch: { code: q } }] : []),
    ];
  }
  const loans = await prisma.loan.findMany({
    where,
    orderBy: [{ releasedAt: "asc" }, { pn: "asc" }],
    include: {
      branch: { select: { id: true, name: true, code: true, area: { select: { name: true } } } },
      transactions: { where: { status: "IN_PROCESS" }, select: { type: { select: { code: true } } } },
      _count: { select: { exceptions: { where: { status: "OPEN" } }, problems: { where: { resolvedAt: null } }, sourceChanges: { where: { state: "OPEN", category: { not: "BORROWER" } } } } },
    },
    take: 500,
  });
  const corrected = await borrowerChangedLoanIds(loans.map((l) => l.id));
  let rows: LoanRow[] = loans.map((l) => {
    const tat = loanTat({ stage: l.stage, stageSince: l.stageSince, releasedAt: l.releasedAt, inProcessCodes: l.transactions.map((x) => x.type.code) }, t, h);
    const next = nextActionForStage(l.stage as Stage, { hasOpenException: l._count.exceptions > 0 });
    const needsAction = LA_STAGES.includes(l.stage) || l._count.exceptions > 0;
    return {
      id: l.id, pn: l.pn, borrowerName: l.borrowerName, loanType: l.loanType, productName: l.productName,
      branch: l.branch.name, branchId: l.branch.id, branchName: l.branch.name, branchCode: l.branch.code, area: l.branch.area?.name ?? "",
      releasedAt: l.releasedAt, amount: Number(l.totalReleasedAmount),
      classification: l.classification, stage: l.stage, tat, nextStep: next,
      // Open problems on jobs count as problems too (red chip on Home and Loans).
      openExceptions: l._count.exceptions + l._count.problems, needsAction, archived: !!l.archivedAt,
      // A MyLoans change waits for Admin's review ("MyLoans changed").
      sourceChanged: l._count.sourceChanges > 0,
      borrowerChanged: corrected.has(l.id),
    };
  });
  if (f.tab === "queue" || !f.tab) rows = rows.filter((r) => r.needsAction);
  if (f.needsAction === "1") rows = rows.filter((r) => r.needsAction);
  if (f.tat === "DUE_OR_OVERDUE") rows = rows.filter((r) => r.tat?.badge === "DUE_TODAY" || r.tat?.badge === "OVERDUE");
  else if (f.tat) rows = rows.filter((r) => r.tat?.badge === f.tat);
  return rows;
}

export async function dashboardCounts(user: CurrentUser) {
  const rows = await listLoans(user, { tab: "all" });
  const today = rows.filter((r) => r.needsAction && (r.tat?.badge === "DUE_TODAY" || r.tat?.badge === "OVERDUE"));
  const openExceptions = await prisma.loanException.count({ where: { status: "OPEN", loan: loanScope(user) } });
  return {
    needsActionToday: today.length,
    forChecklist: rows.filter((r) => r.stage === "For checklist").length,
    assignedToDp: rows.filter((r) => r.stage === "Assigned to DP").length,
    awaitingLa: rows.filter((r) => r.stage === "Awaiting LA acceptance").length,
    overdue: rows.filter((r) => r.tat?.badge === "OVERDUE").length,
    openExceptions,
    total: rows.length,
    attention: [...rows]
      .filter((r) => r.needsAction || r.tat?.badge === "OVERDUE")
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, 8),
  };
}

function rank(r: LoanRow) {
  return (r.tat?.badge === "OVERDUE" ? 100 : r.tat?.badge === "DUE_TODAY" ? 50 : 0) + r.openExceptions * 10 + (r.needsAction ? 5 : 0);
}

export async function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export function canExport(user: CurrentUser) {
  return can(user, PERMISSIONS.LOANS_EXPORT);
}

/** The distinct cash advances that fund this loan's transactions. */
export function advancesOf(loan: { transactions: { advanceLines: { advance: { id: string; number: string; status: string } }[] }[] }) {
  const m = new Map<string, { id: string; number: string; status: string }>();
  for (const t of loan.transactions) for (const l of t.advanceLines) m.set(l.advance.id, l.advance);
  return [...m.values()];
}
