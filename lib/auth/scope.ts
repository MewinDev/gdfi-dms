/**
 * Branch scope: the ONE place that turns a person's branch access into filters (D-008, D-019). Every list,
 * count, detail, report and file download uses these; code outside lib/auth never reads
 * `scopeBranchIds` itself (lib/auth/scope.test.ts enforces it). Out of scope means "not found" (404).
 */
import type { CurrentUser } from "./build-user";

type ScopeUser = Pick<CurrentUser, "scopeBranchIds">;
/** A filter that matches nothing (a person with no branch sees nothing). */
const NONE = "__no_branch__";

/** Prisma where-clause on a `branchId` column (loans, transactions, jobs by loan branch, ...). */
export function loanScope(user: ScopeUser): { branchId?: { in: string[] } } {
  return user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds.length ? user.scopeBranchIds : [NONE] } };
}

/** Prisma where-clause on the Branch table itself (pickers, filters, monitoring). */
export function branchRowScope(user: ScopeUser): { id?: { in: string[] } } {
  return user.scopeBranchIds === null ? {} : { id: { in: user.scopeBranchIds.length ? user.scopeBranchIds : [NONE] } };
}

/** Prisma where-clause on a related loan's branch (`{ loan: { branchId } }`). */
export function loanRelationScope(user: ScopeUser): { loan?: { branchId: { in: string[] } } } {
  const s = loanScope(user);
  return s.branchId ? { loan: { branchId: s.branchId } } : {};
}

/**
 * Prisma where-clause on CashAdvance (D-019): the requesting processor's branch AND the loan of every line
 * in the person's access (a request that spans an out-of-scope loan is not listed).
 */
export function advanceScope(user: ScopeUser): { branchId?: { in: string[] }; lines?: { every: { OR: ({ transactionId: null } | { transaction: { loan: { branchId: { in: string[] } } } })[] } } } {
  const s = loanScope(user);
  if (!s.branchId) return {};
  return { branchId: s.branchId, lines: { every: { OR: [{ transactionId: null }, { transaction: { loan: { branchId: s.branchId } } }] } } };
}

/** Is this branch in the person's access? */
export function inScope(user: ScopeUser, branchId: string | null | undefined): boolean {
  if (user.scopeBranchIds === null) return true;
  return !!branchId && user.scopeBranchIds.includes(branchId);
}

/** Are ALL of these branches in the person's access (a record that spans several loans)? */
export function allInScope(user: ScopeUser, branchIds: (string | null | undefined)[]): boolean {
  return branchIds.every((b) => inScope(user, b));
}

/**
 * Does this worker (a processor) work in one of the person's branches (D-039, funds exceptions)? A worker
 * with All branches works everywhere; a person with All branches reaches any worker.
 */
export function worksInScope(user: ScopeUser, worker: { allBranches: boolean; branches: { branchId: string }[] }): boolean {
  if (user.scopeBranchIds === null || worker.allBranches) return true;
  return worker.branches.some((b) => inScope(user, b.branchId));
}

/** All branches (display text, "All branches" badges). */
export const hasAllBranches = (user: ScopeUser): boolean => user.scopeBranchIds === null;

/** For raw SQL: null = every branch, otherwise the ids (possibly empty: nothing). */
export const scopeIds = (user: ScopeUser): string[] | null => user.scopeBranchIds;
