import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, inScope, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/lib/time";
import { txnName } from "@/lib/ui/plain";
import { inactiveSenderNote, sentBack, sentBackIsFor, type SentBack } from "@/lib/ui/rounds";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * Transactions the DP declined or returned, sent back to THIS Loan Associate (the one who sent them,
 * not another LA of the branch): what to fix, the DP and when. When the sender is inactive, every
 * active LA of the loan's branch sees it ("Sender {name} is inactive").
 */
export async function sentBackFor(user: CurrentUser) {
  if (!can(user, PERMISSIONS.DP_SEND)) return [];
  const branchLa = can(user, PERMISSIONS.CHECKLIST_TICK);
  const txns = await prisma.loanTransaction.findMany({
    where: {
      status: "RETURNED",
      OR: [
        { dpAssignments: { some: { assignedById: user.id } } },
        ...(branchLa ? [{ loan: loanScope(user), dpAssignments: { some: { assignedBy: { active: false } } } }] : []),
      ],
    },
    include: {
      type: true, loan: { select: { pn: true, borrowerName: true, branchId: true } },
      dpAssignments: { include: { dpUser: { select: { name: true } }, assignedBy: { select: { name: true, active: true } } } },
    },
  });
  return txns
    .map((t) => ({ t, sb: sentBack(t.status, t.dpAssignments) }))
    .filter((x): x is { t: (typeof txns)[number]; sb: SentBack } => !!x.sb && sentBackIsFor(x.sb, { id: user.id, isBranchLa: branchLa && inScope(user, x.t.loan.branchId) }))
    .sort((a, b) => a.sb.at.getTime() - b.sb.at.getTime());
}

export async function SentBackToYou({ user }: { user: CurrentUser }) {
  const rows = await sentBackFor(user);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="sent-back-h" className="card overflow-hidden shadow-[inset_4px_0_0_var(--hold-stripe)]" data-sent-back-home>
      <h2 id="sent-back-h" className="flex items-center gap-2 px-4 pb-2 pt-4 text-lg font-bold text-navy sm:px-6">
        <span className="text-act-fg"><ArrowLeftIcon size={18} /></span>Sent back to you ({rows.length})
      </h2>
      <ul>
        {rows.map(({ t, sb }) => (
          <li key={t.id} className="border-t border-line">
            <Link href={`/loans/${t.loan.pn}?tab=todo&tx=${t.type.code}`} className="flex flex-col gap-0.5 px-4 py-3 text-inherit no-underline hover:bg-fill sm:px-6" data-sent-back-row={sb.kind}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="chip c-act h-6 px-2 text-xs">{sb.kind === "declined" ? "Declined by the DP" : "Returned by the DP: fix and send again"}</span>
                <span className="text-[15px] font-semibold">{t.loan.pn} · {txnName(t.type.code, t.type.name)}</span>
              </span>
              <span className="line-clamp-2 text-[14px] text-ink">{sb.findings}</span>
              <span className="text-[13px] text-ink-2">{t.loan.borrowerName} · {sb.dpName} (DP) · {fmtDateTime(sb.at)} · Round {sb.round}</span>
              {inactiveSenderNote(sb) && <span className="text-[13px] font-semibold text-act-fg" data-inactive-sender>{inactiveSenderNote(sb)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
