import Link from "next/link";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { notifyOverdue } from "@/lib/services/funds";
import { OPEN_ADVANCE, isOverdue, peso } from "@/lib/funds/rules";
import { can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { borrowerToDo } from "@/lib/services/borrower-review";
import { BorrowerCorrectionsCard } from "@/components/loan/borrower-corrections-card";
import { AllClear, CaughtUp, HomeHeader, SummaryStrip, type Segment } from "@/components/home/home-ui";
import { ChecklistIcon, ClockIcon, CoinsIcon, WarningIcon } from "@/components/ui/icons";

/**
 * Finance's Home (and anyone whose work is approving or releasing funds): what waits for approval and
 * release, and what is outstanding. The decisions stay on the Funds page; Home only counts and links.
 */
export async function FinanceHome({ user }: { user: CurrentUser }) {
  await notifyOverdue();
  const now = new Date();
  const [toApprove, toRelease, outstanding, topUps, carries, corrections] = await Promise.all([
    prisma.cashAdvance.count({ where: { status: "REQUESTED", requestedById: { not: user.id } } }),
    prisma.cashAdvance.count({ where: { status: "APPROVED" } }),
    prisma.cashAdvance.findMany({ where: { status: { in: OPEN_ADVANCE as never } }, select: { releasedCents: true, status: true, liquidationDueAt: true } }),
    prisma.cashAdvanceTopUp.count({ where: { status: { in: ["REQUESTED", "APPROVED"] }, releasedAt: null } }),
    prisma.carryOver.count({ where: { status: "PENDING" } }),
    can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER) ? borrowerToDo(user) : null,
  ]);
  const overdue = outstanding.filter((a) => isOverdue(a, now)).length;
  const approve = toApprove + topUps + carries;
  const strip: Segment[] = [
    { key: "approve", n: approve, label: "To approve", href: "/funds?tab=approve", dot: "act", icon: <ChecklistIcon size={18} /> },
    { key: "release", n: toRelease, label: "To release", href: "/funds?tab=release", dot: "act", icon: <CoinsIcon size={18} /> },
    { key: "outstanding", n: outstanding.length, label: "Outstanding", href: "/funds?tab=outstanding", icon: <ClockIcon size={18} /> },
    { key: "overdue", n: overdue, label: "Overdue", href: "/funds?tab=outstanding", dot: "bad", icon: <WarningIcon size={18} /> },
  ];
  return (
    <div className="flex w-full max-w-[960px] flex-col gap-4" data-home="finance">
      <HomeHeader name={user.name} now={now}>
        <Link href="/funds" className="btn-primary btn-sm">Open Funds</Link>
      </HomeHeader>
      <SummaryStrip items={strip} />
      <p className="px-1 text-sm text-ink-2" data-outstanding-cash>
        Outstanding cash: {peso(outstanding.reduce((s, a) => s + a.releasedCents, 0))} released on {outstanding.length} advance{outstanding.length === 1 ? "" : "s"}.
      </p>
      {approve + toRelease === 0 && <CaughtUp>You&apos;re all caught up: nothing to approve or release.</CaughtUp>}
      {corrections && corrections.count > 0 ? <BorrowerCorrectionsCard data={corrections} /> : <AllClear />}
    </div>
  );
}
