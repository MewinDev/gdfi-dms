import "server-only";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { changeText, type FieldChange, type Proposed } from "@/lib/myloans/changes";
import { fmtDateTime } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import { outstandingCash, reusablePapers, recordFromPayload } from "./source-sync";
import { relatedLoans, replacementCandidates } from "./related-loans";
import { paymentEvidence } from "@/lib/myloans/relation";

/** The loan's payments as its latest MyLoans copy says (undefined: no payments field). */
async function paymentOf(loanId: string) {
  const snap = await prisma.loanSourceSnapshot.findFirst({ where: { loanId }, orderBy: { retrievedAt: "desc" }, select: { payload: true } });
  return snap ? recordFromPayload(snap.payload)?.paymentRecorded : undefined;
}

/** Everything the review pop-up shows, already in plain words (amounts only for those who may see them). */
export interface ReviewData {
  id: string;
  category: "MATERIAL" | "STATUS" | "REPLACEMENT";
  title: string;
  /** "Amount, Loan type" (for the Open items row). */
  fields: string;
  rows: { label: string; was: string; now: string; hidden: boolean }[];
  sentences: string[];
  affected: { name: string; stateLine: string; locked: boolean }[];
  canReview: boolean;
  needsPicks: boolean;
  /** Same borrower (CIN or CIF), ended here and the details match: possible replacements to link. */
  candidates: { pn: string; text: string; matched: string }[];
  /** No payment on the old PN: MyLoans' evidence when it has a payments field (known), else the Admin confirms. */
  payment: { known: boolean; recorded: boolean; text: string | null };
  replacedByPn: string | null;
  cash: { lineId: string; text: string; notReleased: boolean }[];
  canMove: boolean;
  history: number;
  simulated: boolean;
}

export async function reviewFor(user: CurrentUser, loanId: string): Promise<ReviewData | null> {
  const item = await prisma.sourceChange.findFirst({ where: { loanId, state: "OPEN" }, include: { loan: true } });
  if (!item) return null;
  const seesAmounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  const changes = item.changes as unknown as FieldChange[];
  const p = item.proposed as unknown as Proposed;
  const canReview = can(user, PERMISSIONS.SOURCE_REVIEW);
  const cash = item.category === "MATERIAL" ? [] : await outstandingCash(prisma, loanId);
  const same = item.category === "MATERIAL" ? [] : await replacementCandidates(prisma, item.loan);
  const oldCopy = item.category === "MATERIAL" ? null : (await relatedLoans(prisma, item.loan)).find((r) => r.oldPn === item.loan.pn);
  const newLoan = item.loan.replacedByPn ? await prisma.loan.findUnique({ where: { pn: item.loan.replacedByPn }, select: { id: true } }) : null;
  return {
    id: item.id,
    category: item.category,
    title: `MyLoans changed this loan · ${fmtDateTime(item.detectedAt)}`,
    fields: changes.map((c) => c.label).join(", "),
    rows: changes.map((c) => {
      const t = changeText(c, seesAmounts);
      return { label: c.label, was: t.was, now: t.now, hidden: c.field === "amount" && !seesAmounts };
    }),
    sentences: p.sentences,
    affected: p.affected.map((a) => ({ name: a.name, stateLine: a.stateLine, locked: a.locked })),
    canReview,
    needsPicks: p.needsPicks,
    candidates: same.map((r) => ({
      pn: r.loan.pn, matched: r.relation?.matched.join(", ") ?? "",
      text: `Possible replacement: ${r.loan.pn} · released ${fmtDateTime(r.loan.releasedAt).replace(/,? \d+:\d+.*$/, "")}`,
    })),
    payment: paymentEvidence(oldCopy?.paymentRecorded ?? (await paymentOf(item.loanId))),
    replacedByPn: item.loan.replacedByPn,
    cash: cash.map((c) => ({ lineId: c.lineId, notReleased: c.notReleased, text: `${c.number} · ${c.txnName} · ${c.dp.name}${seesAmounts ? ` · ${peso(c.cents)}` : ""}${c.notReleased ? " · not released yet" : " · still out"}` })),
    canMove: !!newLoan,
    history: (item.history as unknown[]).length,
    simulated: item.simulated,
  };
}

/** Copy reusable papers: the options for the new loan file (Admin), or none. */
export async function reusableFor(user: CurrentUser, loanId: string) {
  if (!can(user, PERMISSIONS.SOURCE_REVIEW)) return [];
  return reusablePapers(prisma, loanId);
}

/** The Related loans card: every other loan of the same borrower (CIN or CIF), scope respected. */
export interface RelatedRow {
  pn: string; product: string; stage: string; status: string; amount: string | null;
  tag: "REPLACES" | "REPLACED_BY" | "POSSIBLE" | "ADDITIONAL"; tagText: string; reason: string | null;
  /** Admin: link by hand (same confirmation, plus a note). */
  canLink: boolean; payment: { known: boolean; recorded: boolean; text: string | null }; oldPn: string; newPn: string;
}
const TAG_TEXT = { REPLACES: "Replaces this loan", REPLACED_BY: "Replaced by this loan", POSSIBLE: "Possible replacement", ADDITIONAL: "Additional" } as const;

export async function relatedPanel(user: CurrentUser, loan: Parameters<typeof relatedLoans>[1]): Promise<{ rows: RelatedRow[]; hidden: number }> {
  const all = await relatedLoans(prisma, loan);
  const seesAmounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  const canReview = can(user, PERMISSIONS.SOURCE_REVIEW);
  const visible = all.filter((r) => inScope(user, r.loan.branchId));
  const status = (s: string | null) => (s ?? "No status").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return {
    hidden: all.length - visible.length,
    rows: visible.map((r) => ({
      pn: r.loan.pn, product: r.loan.productName || "No product name", stage: r.loan.stage, status: status(r.status),
      amount: seesAmounts ? peso(Math.round(Number(r.loan.totalReleasedAmount.toString()) * 100)) : null,
      tag: r.tag, tagText: TAG_TEXT[r.tag], reason: r.relation ? r.relation.reason : null,
      canLink: canReview && (r.tag === "POSSIBLE" || r.tag === "ADDITIONAL") && !loan.replacesPn && !loan.replacedByPn && !r.loan.replacesPn && !r.loan.replacedByPn,
      payment: paymentEvidence(r.paymentRecorded), oldPn: r.oldPn, newPn: r.newPn,
    })),
  };
}
