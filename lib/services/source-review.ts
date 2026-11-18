import "server-only";
import { stageLabel } from "@/lib/workflow/stage-map";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { peso } from "@/lib/funds/rules";
import { reusablePapers } from "./source-sync";
import { relatedLoans } from "./related-loans";
import { paymentEvidence } from "@/lib/myloans/relation";

/** "Different branch: Antipolo → Angono" when the old and new loans are at different branches (shown, never a block). */
export function differentBranch(oldName: string | undefined, newName: string | undefined, oldId: string, newId: string): string | null {
  return oldId === newId ? null : `Different branch: ${oldName ?? "?"} → ${newName ?? "?"}`;
}

/** Copy reusable papers: the options for the new loan file (Admin), or none. */
export async function reusableFor(user: CurrentUser, loanId: string) {
  if (!can(user, PERMISSIONS.SOURCE_REVIEW)) return [];
  return reusablePapers(prisma, loanId, user);
}

/** The Related loans card: every other loan of the same borrower (CIN or CIF), scope respected. */
export interface RelatedRow {
  pn: string; product: string; stage: string; status: string; amount: string | null;
  tag: "REPLACES" | "REPLACED_BY" | "SAME_BORROWER"; tagText: string; reason: string | null;
  /** Admin: link by hand (same confirmation, plus a note). */
  canLink: boolean; payment: { known: boolean; recorded: boolean; text: string | null }; oldPn: string; newPn: string;
  /** The old and new loans are at different branches (a line in the Link confirmation; never a block). */
  differentBranch: string | null;
}
const TAG_TEXT = { REPLACES: "Replaces this loan", REPLACED_BY: "Replaced by this loan", SAME_BORROWER: "Same borrower" } as const;

export async function relatedPanel(user: CurrentUser, loan: Parameters<typeof relatedLoans>[1]): Promise<{ rows: RelatedRow[]; hidden: number }> {
  const all = await relatedLoans(prisma, loan);
  const seesAmounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  const canReview = can(user, PERMISSIONS.SOURCE_REVIEW);
  const visible = all.filter((r) => inScope(user, r.loan.branchId));
  const names = new Map((await prisma.branch.findMany({ where: { id: { in: [loan.branchId, ...visible.map((r) => r.loan.branchId)] } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const status = (s: string | null) => (s ?? "No status").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return {
    hidden: all.length - visible.length,
    rows: visible.map((r) => ({
      pn: r.loan.pn, product: r.loan.productName || "No product name", stage: stageLabel(r.loan.stage), status: status(r.status),
      amount: seesAmounts ? peso(Math.round(Number(r.loan.totalReleasedAmount.toString()) * 100)) : null,
      tag: r.tag, tagText: TAG_TEXT[r.tag], reason: r.relation ? r.relation.reason : null,
      canLink: canReview && r.tag === "SAME_BORROWER" && !loan.replacesPn && !loan.replacedByPn && !r.loan.replacesPn && !r.loan.replacedByPn,
      payment: paymentEvidence(r.paymentRecorded), oldPn: r.oldPn, newPn: r.newPn,
      // Old → new, whichever of the two is the old one.
      differentBranch: r.oldPn === loan.pn
        ? differentBranch(names.get(loan.branchId), names.get(r.loan.branchId), loan.branchId, r.loan.branchId)
        : differentBranch(names.get(r.loan.branchId), names.get(loan.branchId), r.loan.branchId, loan.branchId),
    })),
  };
}
