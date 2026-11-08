import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import { doNext, jobCounts, myJobs } from "@/lib/services/job-queries";
import { notifyOverdue } from "@/lib/services/funds";
import { prisma } from "@/lib/db";
import { OPEN_ADVANCE, isOverdue, peso } from "@/lib/funds/rules";
import { greeting } from "@/lib/ui/plain";
import { PageHeader } from "@/components/ui/basics";
import { AlertIcon, ArrowLeftIcon, ClockIcon, CoinsIcon, ChecklistIcon, PauseIcon } from "@/components/ui/icons";
import { JobRow } from "./job-row";

/** The processor's Home: counts, then "Do these next" (problems, overdue, due today, to review). */
export async function DpHome({ user }: { user: CurrentUser }) {
  await notifyOverdue();
  const now = new Date();
  const [rows, advances] = await Promise.all([
    myJobs(user),
    prisma.cashAdvance.findMany({ where: { requestedById: user.id, status: { in: OPEN_ADVANCE as never } }, select: { number: true, status: true, liquidationDueAt: true, releasedCents: true } }),
  ]);
  const c = jobCounts(rows);
  const next = doNext(rows).slice(0, 8);
  const overdueAdv = advances.filter((a) => isOverdue(a, now));
  const tiles = [
    { n: c.review, label: "To review", icon: <ChecklistIcon size={24} />, href: "/jobs?tab=review", tone: "bg-act-bg text-act-fg" },
    { n: c.process, label: "In process", icon: <ClockIcon size={24} />, href: "/jobs?tab=process", tone: "bg-fill-strong text-navy" },
    { n: c.problems, label: c.problems === 1 ? "Problem" : "Problems", icon: <AlertIcon size={24} />, href: "/jobs?tab=process&problem=1", tone: "bg-bad-bg text-bad-fg" },
    { n: c.needsFunds, label: "Need funds", icon: <CoinsIcon size={24} />, href: "/my-funds", tone: "bg-wait-bg text-wait-fg" },
    { n: c.onHold, label: "On hold", icon: <PauseIcon size={24} />, href: "/jobs?tab=process&hold=1", tone: "bg-navy text-white" },
    { n: c.returned, label: "Returned", icon: <ArrowLeftIcon size={24} />, href: "/jobs?tab=returned", tone: "bg-fill-strong text-navy" },
  ];
  return (
    <div className="flex w-full flex-col gap-4 sm:gap-6">
      <PageHeader title="Home" help={`${greeting(now)}. ${next.length === 0 ? "Nothing urgent right now." : `${next.length} job${next.length === 1 ? "" : "s"} to look at first.`}`} />
      {overdueAdv.length > 0 && (
        <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-[15px] text-bad-fg">
          Liquidation overdue: {overdueAdv.map((a) => `${a.number} (${peso(a.releasedCents)})`).join(", ")}. You cannot request a new cash advance until you liquidate.{" "}
          <Link href="/my-funds?tab=liquidation" className="font-semibold text-bad-fg underline">Liquidate now</Link>
        </p>
      )}
      <section aria-label="Counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card flex items-center gap-3 px-3 py-3 no-underline hover:bg-fill sm:px-5 sm:py-4">
            <span aria-hidden="true" className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl lg:flex ${t.tone}`}>{t.icon}</span>
            <span>
              <span className="block text-[28px] font-bold leading-none text-navy">{t.n}</span>
              <span className="mt-1 block text-sm font-medium">{t.label}</span>
            </span>
          </Link>
        ))}
      </section>
      <section aria-labelledby="dp-next" className="card overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <h2 id="dp-next" className="text-lg font-bold text-navy">Do these next</h2>
          <Link href="/jobs" className="link text-sm">All jobs</Link>
        </div>
        <div className="border-t border-[rgb(12_35_64/0.1)]">
          {next.length === 0 ? (
            <p className="px-4 py-5 text-[15px] text-ink-2 sm:px-5">No problems, nothing overdue or due today, nothing to review.</p>
          ) : (
            next.map((r) => <JobRow key={r.id} r={r} />)
          )}
        </div>
      </section>
    </div>
  );
}
