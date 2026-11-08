import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { trackedOf, type Tracked } from "@/lib/myloans/changes";
import { mapLoan } from "@/lib/myloans/live-mapping";
import { classifyRelation, isEnded, type Relation, type RelLoan } from "@/lib/myloans/relation";
import type { MyLoansRecord } from "@/lib/myloans/types";

/**
 * Loans of the same borrower (same CIN or CIF; never by name) and how they relate: linked
 * replacement, possible replacement (old ended in MyLoans and the details match), or additional unit.
 */

type Db = Tx | typeof prisma;
export type RelationTag = "REPLACES" | "REPLACED_BY" | "POSSIBLE" | "ADDITIONAL";

export const RELATED_SELECT = {
  id: true, pn: true, branchId: true, cin: true, cif: true, stage: true, sourceStatus: true, productName: true, loanType: true,
  totalReleasedAmount: true, releasedAt: true, cancelledAt: true, replacesPn: true, replacedByPn: true,
} as const;
type LoanLite = { id: string; pn: string; branchId: string; cin: string | null; cif: string | null; stage: string; sourceStatus: string; productName: string; loanType: string; totalReleasedAmount: { toString(): string }; releasedAt: Date; cancelledAt: Date | null; replacesPn: string | null; replacedByPn: string | null };

function recordOf(payload: unknown): MyLoansRecord | null {
  if (payload && typeof payload === "object" && "loan" in payload) return (payload as { loan: MyLoansRecord }).loan;
  return mapLoan(payload);
}

/** The latest MyLoans copy of each loan (one query), with the day an ended status was first seen. */
async function latestCopies(db: Db, loanIds: string[]) {
  if (!loanIds.length) return new Map<string, { tracked: Tracked | null; record: MyLoansRecord | null; endedOn: string | null }>();
  const [snaps, ended] = await Promise.all([
    db.loanSourceSnapshot.findMany({ where: { loanId: { in: loanIds } }, distinct: ["loanId"], orderBy: [{ loanId: "asc" }, { retrievedAt: "desc" }], select: { loanId: true, tracked: true, payload: true } }),
    db.sourceChange.findMany({ where: { loanId: { in: loanIds }, category: { in: ["STATUS", "REPLACEMENT"] } }, orderBy: { firstSeenAt: "asc" }, select: { loanId: true, firstSeenAt: true } }),
  ]);
  const out = new Map<string, { tracked: Tracked | null; record: MyLoansRecord | null; endedOn: string | null }>();
  for (const s of snaps) {
    const record = recordOf(s.payload);
    out.set(s.loanId, { tracked: (s.tracked as Tracked | null) ?? (record ? trackedOf(record) : null), record, endedOn: null });
  }
  for (const e of ended) {
    const cur = out.get(e.loanId) ?? { tracked: null, record: null, endedOn: null };
    if (!cur.endedOn) out.set(e.loanId, { ...cur, endedOn: businessDate(e.firstSeenAt) });
  }
  return out;
}

export function relLoanOf(l: LoanLite, copy: { tracked: Tracked | null; endedOn: string | null } | undefined): RelLoan {
  const t = copy?.tracked;
  return {
    pn: l.pn, status: t?.status ?? (l.sourceStatus || null), productName: t?.productName ?? l.productName, loanType: t?.loanType ?? l.loanType,
    amount: t?.amount ?? Math.round(Number(l.totalReleasedAmount.toString()) * 100), releaseDate: t?.releaseDate ?? businessDate(l.releasedAt),
    plateNo: t?.plateNo ?? null, chassisNo: t?.chassisNo ?? null, engineNo: t?.engineNo ?? null,
    endedOn: copy?.endedOn ?? (l.cancelledAt ? businessDate(l.cancelledAt) : null),
  };
}

export interface Related {
  loan: LoanLite;
  tag: RelationTag;
  /** Possible or additional: the reasoning (which fields matched). */
  relation: Relation | null;
  /** The old one of the pair (ended, or released first), for linking. */
  oldPn: string;
  newPn: string;
  /** The old PN's payments, as MyLoans says (undefined: MyLoans has no payments field). */
  paymentRecorded: boolean | null | undefined;
  status: string | null;
}

/** Every other loan of the same borrower, with its relation to `loan`. */
export async function relatedLoans(db: Db, loan: LoanLite): Promise<Related[]> {
  const or = [...(loan.cin ? [{ cin: loan.cin }] : []), ...(loan.cif ? [{ cif: loan.cif }] : [])];
  if (!or.length) return [];
  const others = await db.loan.findMany({ where: { OR: or, id: { not: loan.id } }, select: RELATED_SELECT, orderBy: { releasedAt: "desc" }, take: 50 });
  if (!others.length) return [];
  const [copies, windowDays] = await Promise.all([latestCopies(db, [loan.id, ...others.map((o) => o.id)]), getSetting("myloans.replacementWindowDays", db)]);
  const me = relLoanOf(loan, copies.get(loan.id));
  return others.map((o) => {
    const it = relLoanOf(o, copies.get(o.id));
    // The old one: the one that ended in MyLoans; otherwise the one released first.
    const otherIsOld = isEnded(it.status) && !isEnded(me.status) ? true : isEnded(me.status) && !isEnded(it.status) ? false : o.releasedAt <= loan.releasedAt;
    const [oldR, newR, oldId] = otherIsOld ? [it, me, o.id] : [me, it, loan.id];
    const base = { loan: o, oldPn: oldR.pn, newPn: newR.pn, paymentRecorded: copies.get(oldId)?.record?.paymentRecorded, status: it.status };
    if (loan.replacesPn === o.pn || o.replacedByPn === loan.pn) return { ...base, tag: "REPLACED_BY" as const, relation: null };
    if (o.replacesPn === loan.pn || loan.replacedByPn === o.pn) return { ...base, tag: "REPLACES" as const, relation: null };
    const relation = classifyRelation(oldR, newR, { windowDays });
    // Already linked to something else: not a candidate again.
    const linked = (otherIsOld ? o.replacedByPn : loan.replacedByPn) || (otherIsOld ? loan.replacesPn : o.replacesPn);
    return { ...base, tag: relation.kind === "REPLACEMENT_CANDIDATE" && !linked ? "POSSIBLE" as const : "ADDITIONAL" as const, relation };
  });
}

/** Possible replacements for a loan that ended in MyLoans (it is the old one). */
export async function replacementCandidates(db: Db, loan: LoanLite): Promise<Related[]> {
  return (await relatedLoans(db, loan)).filter((r) => r.tag === "POSSIBLE" && r.oldPn === loan.pn);
}
