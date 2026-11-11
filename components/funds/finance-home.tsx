import Link from "next/link";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { notifyOverdue } from "@/lib/services/funds";
import { OPEN_ADVANCE, isOverdue, peso } from "@/lib/funds/rules";
import { greeting } from "@/lib/ui/plain";
import { PageHeader } from "@/components/ui/basics";
import { can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { BorrowerCorrectionsCard } from "@/components/loan/borrower-corrections-card";

/** Finance's Home: what waits for approval and release, and what is outstanding. */
export async function FinanceHome({ user }: { user: CurrentUser }) {
  await notifyOverdue();
  const now = new Date();
  const [toApprove, toRelease, outstanding, topUps, carries] = await Promise.all([
    prisma.cashAdvance.count({ where: { status: "REQUESTED", requestedById: { not: user.id } } }),
    prisma.cashAdvance.count({ where: { status: "APPROVED" } }),
    prisma.cashAdvance.findMany({ where: { status: { in: OPEN_ADVANCE as never } }, select: { releasedCents: true, status: true, liquidationDueAt: true } }),
    prisma.cashAdvanceTopUp.count({ where: { status: { in: ["REQUESTED", "APPROVED"] }, releasedAt: null } }),
    prisma.carryOver.count({ where: { status: "PENDING" } }),
  ]);
  const overdue = outstanding.filter((a) => isOverdue(a, now)).length;
  const tiles = [
    { n: toApprove + topUps + carries, label: "To approve", href: "/funds?tab=approve" },
    { n: toRelease, label: "To release", href: "/funds?tab=release" },
    { n: outstanding.length, label: "Outstanding", href: "/funds?tab=outstanding" },
    { n: overdue, label: "Overdue", href: "/funds?tab=outstanding" },
  ];
  return (
    <div className="flex w-full flex-col gap-4 sm:gap-6">
      <PageHeader title="Home" help={`${greeting(now)}. Outstanding cash: ${peso(outstanding.reduce((s, a) => s + a.releasedCents, 0))} released on ${outstanding.length} advance${outstanding.length === 1 ? "" : "s"}.`} />
      <section aria-label="Counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card flex flex-col px-4 py-3 no-underline hover:bg-fill sm:px-5 sm:py-4">
            <span className="text-[28px] font-bold leading-none text-navy">{t.n}</span>
            <span className="mt-1 text-sm font-medium">{t.label}</span>
          </Link>
        ))}
      </section>
      <Link href="/funds" className="btn-primary self-start">Open Funds</Link>
      {can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER) && <BorrowerCorrectionsCard user={user} />}
    </div>
  );
}
