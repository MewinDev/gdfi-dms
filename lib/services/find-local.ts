import "server-only";
import { prisma } from "@/lib/db";
import { can, inScope, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getMyLoansAdapter } from "@/lib/myloans";
import { callsThisHour } from "@/lib/myloans/client";
import { cleanPn, getPnFormat, isPnAttempt, parsePn, type PnFormat } from "@/lib/pn";
import { getSetting } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { liveAssignment } from "@/lib/ui/plain";
import { nextStepFor, stageLabel } from "@/lib/workflow/stage-map";
import { fmtDate } from "@/lib/time";
import { refreshLoan } from "./source-sync";

/**
 * Find a loan, local first (docs/workflow/03-loan-associate.md): typing searches only the loan files
 * saved in the DMS (never MyLoans); only the Find loan button looks up a full PN in MyLoans, and only
 * when it is not saved here yet. Searches use the PN and borrower-name trigram indexes and the CIN and
 * CIF indexes; nothing scans the Loan table.
 */
export const SUGGEST_MIN = 3;
export const SUGGEST_LIMIT = 8;
export const LIST_LIMIT = 20;

/**
 * The text as a complete, valid PN (the shared PN parser), or null (part of a PN, a CIN, a name).
 * Find loan only: the whole number typed without the prefix (for example 1012026901001) counts too; the
 * prefix is added before the check. Imports and the PN format setting keep the strict rule.
 */
export async function completePn(q: string): Promise<string | null> {
  const fmt = await getPnFormat();
  const parsed = parsePn(withPrefix(q, fmt), fmt);
  return parsed.ok && (parsed.parts || isPnAttempt(q, { ...fmt, enabled: true })) ? parsed.pn : null;
}

/** Digits only, exactly as many as a PN has after its prefix: the prefix is put in front. */
export function withPrefix(q: string, fmt: PnFormat): string {
  const c = cleanPn(q);
  const digits = fmt.branchDigits + fmt.yearDigits + fmt.system.length + fmt.runningDigits;
  return fmt.enabled && /^\d+$/.test(c) && c.length === digits ? `${fmt.prefix.toUpperCase()}${c}` : q;
}

/**
 * Loan files in the person's branches matching the text: the start of a PN, the CIN or CIF exactly, or
 * the start of the borrower's name first; then part of a PN or of the name (at least 3 characters).
 */
const SAVED_ROW = { id: true, pn: true, borrowerName: true, stage: true, branch: { select: { name: true } } } as const;

export async function searchSaved(user: CurrentUser, text: string, limit: number) {
  const q = text.trim();
  if (!q) return [];
  const pn = await completePn(q);
  // Part of a PN as typed or without spaces, dashes and dots ("101-2026-9" finds GD1012026901001).
  const pnText = cleanPn(q) || q;
  const ids = [...new Set([q, q.toUpperCase()])];
  const first = await prisma.loan.findMany({
    where: {
      ...loanScope(user),
      OR: [
        { pn: { startsWith: pn ?? pnText, mode: "insensitive" } },
        // Exact CIN and CIF: the plain indexes (as typed, or in capitals).
        { cin: { in: ids } },
        { cif: { in: ids } },
        { borrowerName: { startsWith: q, mode: "insensitive" } },
      ],
    },
    select: SAVED_ROW,
    take: limit,
    orderBy: { pn: "asc" },
  });
  if (first.length >= limit || q.length < SUGGEST_MIN) return first;
  const more = await prisma.loan.findMany({
    where: {
      ...loanScope(user),
      id: { notIn: first.map((l) => l.id) },
      OR: [{ pn: { contains: pnText, mode: "insensitive" } }, { borrowerName: { contains: q, mode: "insensitive" } }],
    },
    select: SAVED_ROW,
    take: limit - first.length,
    orderBy: { pn: "asc" },
  });
  return [...first, ...more];
}

export interface SuggestHit { pn: string; borrowerName: string; stage: string; branch: string }
export type SuggestResult =
  | { kind: "hits"; hits: SuggestHit[] }
  /** A complete PN saved in a branch outside the person's access (no details). */
  | { kind: "outside"; pn: string }
  /** A complete, valid PN not saved in the DMS yet: Find loan looks it up in MyLoans. */
  | { kind: "unsaved"; pn: string }
  | { kind: "none" };

/** The dropdown while typing: the DMS only, never MyLoans. From 3 characters, at most 8 rows. */
export async function suggestLoans(user: CurrentUser, text: string): Promise<SuggestResult> {
  const q = text.trim().slice(0, 60);
  if (q.length < SUGGEST_MIN) return { kind: "none" };
  const rows = await searchSaved(user, q, SUGGEST_LIMIT);
  if (rows.length) return { kind: "hits", hits: rows.map((r) => ({ pn: r.pn, borrowerName: r.borrowerName, stage: stageLabel(r.stage), branch: r.branch.name })) };
  const pn = await completePn(q);
  if (!pn) return { kind: "none" };
  const saved = await prisma.loan.findUnique({ where: { pn }, select: { branchId: true } });
  if (saved) return inScope(user, saved.branchId) ? { kind: "none" } : { kind: "outside", pn };
  return { kind: "unsaved", pn };
}

// ---------------------------------------------------------------------------
// "Already in the DMS": the card for a saved loan (local; no MyLoans call)
// ---------------------------------------------------------------------------

export interface SavedLoanCard {
  pn: string;
  borrowerName: string;
  productName: string;
  branchName: string;
  stage: string;
  stageText: string;
  /** Who has it: the processor while a job is live, otherwise the Loan Associate who opened it. */
  holder: { role: "Processor" | "Owner"; name: string };
  next: string;
  holds: string[];
  problems: number;
  changed: boolean;
  cancelled: { on: string; reason: string | null } | null;
  closed: boolean;
  replacedByPn: string | null;
  /** Older than the "refresh when found" setting: the card asks for one background refresh. */
  stale: boolean;
  /** MyLoans corrected the borrower's details: waiting for review (nothing blocked). */
  borrowerChanged: boolean;
}

const ended = (l: { cancelledAt: Date | null; closedAt: Date | null; archivedAt: Date | null }) => !!(l.cancelledAt || l.closedAt || l.archivedAt);

/** True when the saved copy is older than the setting (hours; 0 = never). Closed and cancelled loans are never refreshed. */
export async function isStaleForFind(l: { lastCheckedAt: Date | null; retrievedAt: Date; cancelledAt: Date | null; closedAt: Date | null; archivedAt: Date | null }, now: Date = new Date()) {
  const hours = await getSetting("myloans.refreshOnFindHours");
  if (hours <= 0 || ended(l)) return false;
  return now.getTime() - (l.lastCheckedAt ?? l.retrievedAt).getTime() > hours * 3_600_000;
}

export async function savedLoanCard(user: CurrentUser, pn: string, now: Date = new Date()): Promise<SavedLoanCard | null> {
  const l = await prisma.loan.findFirst({
    where: { pn, ...loanScope(user) },
    select: {
      pn: true, borrowerName: true, productName: true, stage: true, lastCheckedAt: true, retrievedAt: true,
      cancelledAt: true, cancelReason: true, closedAt: true, archivedAt: true, replacedByPn: true,
      branch: { select: { name: true } },
      openedBy: { select: { name: true } },
      dpAssignments: { select: { status: true, endorsedAt: true, dpUser: { select: { name: true } } }, orderBy: { endorsedAt: "desc" } },
      holds: { where: { resumedAt: null }, select: { reasonName: true, reason: { select: { name: true } } } },
      _count: { select: { problems: { where: { resolvedAt: null } }, exceptions: { where: { status: "OPEN" } }, sourceChanges: { where: { state: "OPEN", category: { not: "BORROWER" } } } } },
    },
  });
  if (!l) return null;
  const borrowerChanged = (await prisma.sourceChange.count({ where: { loan: { pn }, state: "OPEN", category: "BORROWER" } })) > 0;
  const job = l.dpAssignments.find((a) => liveAssignment(a.status) && a.status !== "CLOSED");
  const problems = l._count.problems + l._count.exceptions;
  const holds = [...new Set(l.holds.map((h) => h.reasonName || h.reason.name))];
  const next = l.cancelledAt ? "Nothing to do: the loan was cancelled."
    : l.closedAt || l.archivedAt ? "Nothing to do: the loan file is closed."
    : problems ? "Fix the open problem first."
    : holds.length ? "Resume the hold when it is cleared."
    : l._count.sourceChanges ? "Admin reviews the MyLoans change."
    : nextStepFor(l.stage, { hasOpenException: l._count.exceptions > 0 }).label;
  return {
    pn: l.pn, borrowerName: l.borrowerName, productName: l.productName, branchName: l.branch.name, stage: l.stage, stageText: stageLabel(l.stage),
    holder: job ? { role: "Processor", name: job.dpUser.name } : { role: "Owner", name: l.openedBy.name },
    next, holds, problems, changed: l._count.sourceChanges > 0,
    cancelled: l.cancelledAt ? { on: fmtDate(l.cancelledAt), reason: l.cancelReason } : null,
    closed: !!(l.closedAt || l.archivedAt), replacedByPn: l.replacedByPn,
    stale: await isStaleForFind(l, now),
    borrowerChanged,
  };
}

/**
 * The background refresh after the "Already in the DMS" card is shown: at most one MyLoans call, only
 * when the copy is older than the setting, and never past the hourly limit or while the circuit breaker
 * has paused calls. Audited like a refresh on open (a change raises the existing review).
 */
export async function refreshFoundLoan(user: CurrentUser, pn: string, now: Date = new Date()): Promise<{ called: boolean; changed: boolean }> {
  if (!can(user, PERMISSIONS.LOANS_VIEW)) return { called: false, changed: false };
  const l = await prisma.loan.findUnique({
    where: { pn },
    select: { id: true, branchId: true, lastCheckedAt: true, retrievedAt: true, cancelledAt: true, closedAt: true, archivedAt: true },
  });
  if (!l || !inScope(user, l.branchId)) return { called: false, changed: false };
  const changedNow = async () => (await prisma.sourceChange.count({ where: { loanId: l.id, state: "OPEN", category: { not: "BORROWER" } } })) > 0;
  if (!(await isStaleForFind(l, now))) return { called: false, changed: await changedNow() };
  // Paused by Admin: no call (a person can still press Refresh from MyLoans on the loan file).
  if (await getSetting("myloans.paused")) return { called: false, changed: await changedNow() };
  const ceiling = await getSetting("myloans.hourlyCeiling");
  if ((await callsThisHour()) >= ceiling || (await getMyLoansAdapter().breakerState()).open) return { called: false, changed: await changedNow() };
  let called = true;
  try {
    // The ceiling is reserved again atomically: two instances cannot both slip past it.
    const r = await refreshLoan(l.id, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "find", now, ceiling });
    if (!r.ok && r.limited) called = false;
  } catch {
    // An outage never blocks work: the card stays as it is.
  }
  return { called, changed: await changedNow() };
}
