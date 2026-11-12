import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import { doNext, jobCounts, myJobs } from "@/lib/services/job-queries";
import { notifyOverdue } from "@/lib/services/funds";
import { prisma } from "@/lib/db";
import { OPEN_ADVANCE, isOverdue, peso } from "@/lib/funds/rules";
import { AlertCard, AllClear, CaughtUp, HomeHeader, ListBlock, SummaryStrip, type Segment } from "@/components/home/home-ui";
import { JobRow } from "./job-row";
import { AlertIcon, ChecklistIcon, ClockIcon, CoinsIcon, PauseIcon } from "@/components/ui/icons";

/** "Do these next": the first six; "See all (N)" for the rest. */
const SHOW = 6;

/** The processor's Home: the counts, then "Do these next" (problems, overdue, due today, to review), then any alert. */
export async function DpHome({ user }: { user: CurrentUser }) {
  await notifyOverdue();
  const now = new Date();
  const [rows, advances] = await Promise.all([
    myJobs(user),
    prisma.cashAdvance.findMany({ where: { requestedById: user.id, status: { in: OPEN_ADVANCE as never } }, select: { number: true, status: true, liquidationDueAt: true, releasedCents: true } }),
  ]);
  const c = jobCounts(rows);
  const all = doNext(rows);
  const next = all.slice(0, SHOW);
  const overdueAdv = advances.filter((a) => isOverdue(a, now));
  const strip: Segment[] = [
    { key: "review", n: c.review, label: "To review", href: "/jobs?tab=review", dot: "act", icon: <ChecklistIcon size={18} /> },
    { key: "process", n: c.process, label: "In process", href: "/jobs?tab=process", icon: <ClockIcon size={18} /> },
    { key: "problems", n: c.problems, label: c.problems === 1 ? "Problem" : "Problems", href: "/jobs?tab=process&problem=1", dot: "bad", icon: <AlertIcon size={18} /> },
    { key: "funds", n: c.needsFunds, label: "Need funds", href: "/my-funds", dot: "act", icon: <CoinsIcon size={18} /> },
    { key: "hold", n: c.onHold, label: "On hold", href: "/jobs?tab=process&hold=1", icon: <PauseIcon size={18} /> },
  ];
  return (
    <div className="flex w-full max-w-[960px] flex-col gap-4" data-home="dp">
      <HomeHeader name={user.name} now={now}>
        <Link href="/jobs" className="btn-ghost btn-sm">All jobs</Link>
      </HomeHeader>
      <SummaryStrip items={strip} />
      {next.length === 0 ? (
        <CaughtUp>You&apos;re all caught up: no problems, nothing overdue or due today, nothing to review.</CaughtUp>
      ) : (
        <ListBlock id="dp-next" title="Do these next" icon={<ChecklistIcon size={15} />} more={{ href: "/jobs", total: all.length, shown: next.length }} data={{ "data-do-next": "" }}>
          {next.map((r) => <JobRow key={r.id} r={r} />)}
        </ListBlock>
      )}
      {overdueAdv.length > 0 ? (
        <AlertCard id="liq-h" title="Liquidation overdue" icon={<CoinsIcon size={15} />} count={overdueAdv.length} tone="bad" link={{ href: "/my-funds?tab=liquidation", label: "Liquidate now" }} data={{ "data-liquidation-overdue": "", role: "alert" }}
          reason={<>{overdueAdv.map((a) => `${a.number} (${peso(a.releasedCents)})`).join(", ")}. You cannot request a new cash advance until you liquidate.</>} />
      ) : (
        <AllClear />
      )}
    </div>
  );
}
