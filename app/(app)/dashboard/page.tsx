import type { Metadata } from "next";
import { anyStepKeys, canFundsAny } from "@/lib/funds/access";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, requirePageAny, requireUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listLoans } from "@/lib/services/queries";
import { getHolidaySet } from "@/lib/settings";
import { plainUpdate, timeAgo } from "@/lib/ui/plain";
import { cardFor, sortByUrgency } from "@/lib/ui/loan-cards";
import { loadSampleCards } from "@/lib/ui/samples";
import { borrowerToDo } from "@/lib/services/borrower-review";
import { SampleLoans } from "@/components/loan/sample-loans";
import { DpHome } from "@/components/jobs/dp-home";
import { FinanceHome } from "@/components/funds/finance-home";
import { TatProblemsCard, tatToDo } from "@/components/jobs/tat-report";
import { SourceChangesCard, sourceChangesToDo } from "@/components/loan/source-changes-card";
import { BorrowerCorrectionsCard } from "@/components/loan/borrower-corrections-card";
import { BranchReviewCard, branchReviewToDo } from "@/components/admin/branches/review-card";
import { PackagesToReceive, packagesFor } from "@/components/jobs/packages-to-receive";
import { SentBackToYou, sentBackFor } from "@/components/loan/sent-back-to-you";
import { AllClear, CaughtUp, HOME_CARD, HomeHeader, IconTile, ListBlock, SummaryStrip, type Segment } from "@/components/home/home-ui";
import { BellIcon, BuildingIcon, ChecklistIcon, ClockIcon, HourglassIcon, RefreshIcon, UsersIcon, WarningIcon } from "@/components/ui/icons";
import { CollapsedLoans, HomeLoanRow } from "@/components/home/home-loan-row";

export const metadata: Metadata = { title: "Home" };

/** "Do these next": the first six; "See all (N)" for the rest. */
const SHOW = 6;

export default async function HomePage() {
  // A monitor-only role (Operations Monitor) has no loan files: their home is the Monitoring page.
  const me = await requireUser();
  if (![PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK].some((p) => can(me, p)) && !canFundsAny(me) && (can(me, PERMISSIONS.MONITOR_DP) || can(me, PERMISSIONS.MONITOR_LTO))) redirect("/monitoring");
  const user = await requirePageAny([PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK, ...anyStepKeys("view")]);
  // The processor and Finance have their own Home (their work is jobs and funds, not loan files).
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  if (!la && can(user, PERMISSIONS.JOBS_WORK)) return <DpHome user={user} />;
  if (!la && (canFundsAny(user, "approve") || canFundsAny(user, "release"))) return <FinanceHome user={user} />;

  // The attention blocks, each only for the ticks that show it today (permission ticks, never a role name).
  const none = { count: 0, items: [] };
  const [rows, holidays, updates, samples, packages, sentBack, source, corrections, branches, tat] = await Promise.all([
    listLoans(user, { tab: "all" }),
    getHolidaySet(),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 3, include: { loan: { select: { borrowerName: true } } } }),
    loadSampleCards(user),
    packagesFor(user),
    sentBackFor(user),
    can(user, PERMISSIONS.SOURCE_REVIEW) ? sourceChangesToDo() : null,
    // Supervisors and approvers: the corrections of their branches (Admin sees those routed to it in MyLoans changes).
    can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER) && !can(user, PERMISSIONS.SOURCE_REVIEW) ? borrowerToDo(user) : null,
    can(user, PERMISSIONS.BRANCHES_REVIEW) ? branchReviewToDo() : null,
    can(user, PERMISSIONS.REPORTS_TAT) ? tatToDo(user) : null,
  ]);
  const cards = rows.map((r) => cardFor(r, holidays));
  const need = sortByUrgency(cards.filter((c) => c.group === "need"));
  const waiting = cards.filter((c) => c.group === "wait");
  const problems = cards.filter((c) => c.problem);
  const next = need.slice(0, SHOW);
  const now = new Date();

  // The counts, the same queries as before; the review counts join the strip for the people who review.
  const strip: Segment[] = [
    { key: "need", n: need.length, label: "Need you now", href: "/loans?tab=queue", dot: "act", icon: <ClockIcon size={18} /> },
    { key: "waiting", n: waiting.length, label: "Waiting on others", href: "/loans?tab=all&group=waiting", icon: <HourglassIcon size={18} /> },
    { key: "problems", n: problems.length, label: problems.length === 1 ? "Problem to fix" : "Problems to fix", href: "/loans?tab=exceptions", dot: "bad", icon: <WarningIcon size={18} /> },
    ...(source ? [{ key: "source", n: source.count, label: "MyLoans changes", href: source.count ? "#src-h" : undefined, dot: "bad" as const, icon: <RefreshIcon size={18} /> }] : []),
    ...(corrections ? [{ key: "corrections", n: corrections.count, label: "Corrections to review", href: corrections.count ? "#corr-h" : undefined, dot: "act" as const, icon: <UsersIcon size={18} /> }] : []),
    ...(branches ? [{ key: "branches", n: branches.count, label: "Branch review", href: branches.count ? "#brv-h" : undefined, dot: "act" as const, icon: <BuildingIcon size={18} /> }] : []),
  ];

  const alerts = [
    packages.length > 0 && <PackagesToReceive key="packages" rows={packages} />,
    sentBack.length > 0 && <SentBackToYou key="sent" rows={sentBack} />,
    source && source.count > 0 && <SourceChangesCard key="source" data={source} />,
    corrections && corrections.count > 0 && <BorrowerCorrectionsCard key="corr" data={corrections ?? none} />,
    branches && branches.count > 0 && <BranchReviewCard key="branches" data={branches} />,
    tat?.attention && <TatProblemsCard key="tat" data={tat} />,
  ].filter(Boolean);

  // The side column only when it has something: test-mode samples or updates. Otherwise the main column
  // takes the width (up to 960px) instead of leaving an empty right half.
  const side = samples.samples.length > 0 || updates.length > 0;

  return (
    <div className="flex w-full flex-col gap-4" data-home="main">
      <HomeHeader name={user.name} now={now}>
        <Link href="/loans?tab=queue" className="btn-ghost btn-sm">See all my loans</Link>
      </HomeHeader>

      <div className={side ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start" : "max-w-[960px]"}>
        <div className="flex min-w-0 flex-col gap-4" data-home-main>
          <SummaryStrip items={strip} />

          {next.length === 0 ? (
            <CaughtUp />
          ) : (
            <ListBlock id="next-title" title="Do these next" icon={<ChecklistIcon size={15} />} more={{ href: "/loans?tab=queue", total: need.length, shown: next.length }} data={{ "data-do-next": "" }}>
              {next.map((c, i) => <HomeLoanRow key={c.pn} d={c} primary={i === 0} due={c.urgency % 10 >= 2} />)}
            </ListBlock>
          )}
          <CollapsedLoans id="waiting" title="Waiting on others" icon={<HourglassIcon size={15} />} rows={waiting} href="/loans?tab=all&group=waiting" />
          <CollapsedLoans id="problems" icon={<WarningIcon size={15} />} tone="bad" title={problems.length === 1 ? "Problem to fix" : "Problems to fix"} rows={problems} href="/loans?tab=exceptions" />

          {alerts.length > 0 ? alerts : <AllClear />}
        </div>

        {side && (
          <div className="flex min-w-0 flex-col gap-4" data-home-side>
            {updates.length > 0 && (
              <aside aria-labelledby="updates-title" className={`${HOME_CARD} px-3 py-3 sm:px-4`} data-home-updates>
                <h2 id="updates-title" className="flex items-center gap-2.5 text-[15px] font-semibold text-navy"><IconTile tone="navy" size="sm"><BellIcon size={15} /></IconTile>Latest updates</h2>
                <ul className="mt-1.5 flex flex-col">
                  {updates.map((u) => {
                    const text = plainUpdate(u.title, u.loan?.borrowerName);
                    return (
                      <li key={u.id} className="flex min-w-0 items-baseline gap-2 py-1 text-sm">
                        <span aria-hidden="true" className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${u.readAt ? "bg-line" : "bg-gold"}`} />
                        {u.readAt ? null : <span className="sr-only">Unread: </span>}
                        <span className="min-w-0 flex-1 truncate" title={text}>
                          {u.link ? <Link href={u.link} className="text-ink no-underline hover:underline">{text}</Link> : text}
                        </span>
                        <span className="shrink-0 text-[12px] text-ink-2">{timeAgo(u.createdAt, now)}</span>
                      </li>
                    );
                  })}
                </ul>
                <Link href="/notifications" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-navy underline underline-offset-2">See all updates</Link>
              </aside>
            )}
            {samples.samples.length > 0 && (
              <SampleLoans id="home-samples" title="Sample loans" intro="Pick one, then press Find loan." samples={samples.samples} collapsed />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
