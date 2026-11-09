import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, requirePageAny, requireUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listLoans } from "@/lib/services/queries";
import { getHolidaySet } from "@/lib/settings";
import { APP_TIMEZONE } from "@/lib/time";
import { greeting, plainUpdate, timeAgo } from "@/lib/ui/plain";
import { cardFor, sortByUrgency } from "@/lib/ui/loan-cards";
import { loadSampleCards } from "@/lib/ui/samples";
import { PageHeader } from "@/components/ui/basics";
import { LoanRow } from "@/components/ui/loan-row";
import { ClockIcon, HourglassIcon, WarningIcon } from "@/components/ui/icons";
import { SampleLoans } from "@/components/loan/sample-loans";
import { DpHome } from "@/components/jobs/dp-home";
import { FinanceHome } from "@/components/funds/finance-home";
import { TatProblemsCard } from "@/components/jobs/tat-report";
import { SourceChangesCard } from "@/components/loan/source-changes-card";
import { PackagesToReceive } from "@/components/jobs/packages-to-receive";
import { SentBackToYou } from "@/components/loan/sent-back-to-you";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  // A monitor-only role (Operations Monitor) has no loan files: their home is the Monitoring page.
  const me = await requireUser();
  if (![PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK, PERMISSIONS.FUNDS_VIEW_ALL].some((p) => can(me, p)) && (can(me, PERMISSIONS.MONITOR_DP) || can(me, PERMISSIONS.MONITOR_LTO))) redirect("/monitoring");
  const user = await requirePageAny([PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK, PERMISSIONS.FUNDS_VIEW_ALL]);
  // The processor and Finance have their own Home (their work is jobs and funds, not loan files).
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  if (!la && can(user, PERMISSIONS.JOBS_WORK)) return <DpHome user={user} />;
  if (!la && (can(user, PERMISSIONS.FUNDS_APPROVE) || can(user, PERMISSIONS.FUNDS_RELEASE))) return <FinanceHome user={user} />;
  const [rows, holidays, updates, samples] = await Promise.all([
    listLoans(user, { tab: "all" }),
    getHolidaySet(),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 3, include: { loan: { select: { borrowerName: true } } } }),
    loadSampleCards(),
  ]);
  const cards = rows.map((r) => cardFor(r, holidays));
  const need = cards.filter((c) => c.group === "need");
  const waiting = cards.filter((c) => c.group === "wait");
  const problems = cards.filter((c) => c.problem);
  const next = sortByUrgency(need).slice(0, 5);
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-PH", { timeZone: APP_TIMEZONE, weekday: "long", month: "long", day: "numeric" }).format(now);
  const n = need.length;

  const tiles = [
    { n, label: "Need you now", short: "Need you", icon: <ClockIcon size={26} />, ico: "bg-act-bg text-act-fg", tint: "sm:max-lg:bg-gold-soft sm:max-lg:border-gold-line", href: "/loans?tab=queue" },
    { n: waiting.length, label: "Waiting on others", short: "Waiting", icon: <HourglassIcon size={24} />, ico: "bg-fill-strong text-navy", tint: "", href: "/loans?tab=all&group=waiting" },
    { n: problems.length, label: problems.length === 1 ? "Problem to fix" : "Problems to fix", short: problems.length === 1 ? "Problem" : "Problems", icon: <WarningIcon size={26} />, ico: "bg-bad-bg text-bad-fg", tint: "", href: "/loans?tab=exceptions" },
  ];
  const rest = n === 0 ? (cards.length === 0 ? "Nothing needs you yet." : "You are all caught up.") : null;

  return (
    <div className="flex w-full flex-col gap-4 sm:gap-6">
      <PageHeader
        title="Home"
        help={<><span className="hidden lg:inline">{date} · </span>{greeting(now)}. {rest ?? <>You have {n} loan{n === 1 ? "" : "s"} to work on.</>}</>}
      >
        {next.length > 0 && <Link href="/loans?tab=queue" className="btn-ghost hidden shrink-0 lg:inline-flex">See all my loans</Link>}
      </PageHeader>

      <section aria-label="Counts" className="grid grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`card flex items-center gap-4 px-3 py-3 no-underline hover:bg-fill sm:px-5 sm:py-[22px] lg:px-6 ${t.tint}`}>
            <span aria-hidden="true" className={`hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] lg:flex ${t.ico}`}>{t.icon}</span>
            <span className="min-w-0">
              <span className="block text-[28px] font-bold leading-none text-navy sm:text-[34px]">{t.n}</span>
              <span className="mt-1.5 block text-sm font-medium text-ink sm:text-[15px] lg:font-semibold">
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </span>
            </span>
          </Link>
        ))}
      </section>

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <PackagesToReceive user={user} />
          <SentBackToYou user={user} />
          {can(user, PERMISSIONS.SOURCE_REVIEW) && <SourceChangesCard />}
          {can(user, PERMISSIONS.REPORTS_TAT) && <TatProblemsCard />}
          <section aria-labelledby="next-title" className="card overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-6 sm:pt-[22px]">
              <h2 id="next-title" className="text-lg font-bold text-navy sm:text-xl">Do these next</h2>
            </div>
            {next.length === 0 ? (
              <div className="border-t border-[rgb(12_35_64/0.1)] px-4 py-5 text-[15px] sm:px-6">
                <p className="font-semibold text-navy">
                  {cards.length === 0 ? "Nothing needs you yet. Find a loan or pick a sample to start." : "Nothing needs you right now."}
                </p>
                <p className="mt-1 text-ink-2">
                  {cards.length === 0 ? "Go to My loans, type the PN number, then press Find loan." : "Loans waiting on others are under My loans."}
                </p>
              </div>
            ) : (
              <div className="border-t border-[rgb(12_35_64/0.1)]">
                {next.map((c, i) => <LoanRow key={c.pn} d={c} urgent={i === 0} />)}
              </div>
            )}
            {next.length > 0 && (
              <div className="border-t border-[rgb(12_35_64/0.1)] px-4 py-3 text-center sm:px-6 lg:hidden">
                <Link href="/loans?tab=queue" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy">See all my loans</Link>
              </div>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {samples.samples.length > 0 && (
            <SampleLoans id="home-samples" title="Sample loans" intro="Pick one to open My loans with its PN in the search box, then press Find loan." samples={samples.samples} compact />
          )}
          <aside aria-labelledby="updates-title" className="card p-5 sm:p-6">
            <h2 id="updates-title" className="text-lg font-bold text-navy">Latest updates</h2>
            {updates.length === 0 ? (
              <p className="mt-3 text-[15px] text-ink-2">No updates yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-4">
                {updates.map((u) => (
                  <li key={u.id} className="flex gap-3">
                    <span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${u.readAt ? "bg-line" : "bg-gold"}`} />
                    <span className="text-[15px] leading-snug">
                      {u.readAt ? null : <span className="sr-only">Unread: </span>}
                      {u.link ? <Link href={u.link} className="text-ink no-underline hover:underline">{plainUpdate(u.title, u.loan?.borrowerName)}</Link> : plainUpdate(u.title, u.loan?.borrowerName)}
                      <span className="mt-0.5 block text-sm text-ink-2">{timeAgo(u.createdAt, now)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/notifications" className="link mt-4 inline-flex min-h-11 items-center text-[15px]">See all updates</Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
