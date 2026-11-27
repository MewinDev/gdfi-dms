import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireUser, scopeIds } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canFundsAny } from "@/lib/funds/access";
import { prisma } from "@/lib/db";
import { businessDate, fmtDate } from "@/lib/time";
import { isAway } from "@/lib/work/rules";
import { giveToCandidates, itemsWithAway, myItems, poolItems, type InboxRow } from "@/lib/services/work-items";
import { poolColours } from "@/lib/services/pool-colours";
import { AwayForm, type RowExtras } from "@/components/inbox/inbox-rows";
import { InboxView, type Tab, type TabInfo } from "@/components/inbox/inbox-view";
import { InboxInfo, SetAway } from "@/components/inbox/inbox-header";

export const metadata: Metadata = { title: "Inbox" };

/**
 * Inbox (D-046; D-063 compact and quick). My items: what I accepted and what was given to me, least time left first.
 * Branch pool: work any of us can take (the first accept wins), longest waiting first. With people away: supervisors
 * move it on. All lists come with the page, so switching tabs is instant; one row per loan opens a details panel.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const canMove = can(user, PERMISSIONS.WORKITEMS_MOVE);
  if (![PERMISSIONS.CHECKLIST_TICK, PERMISSIONS.JOBS_WORK, PERMISSIONS.WORKITEMS_MOVE].some((p) => can(user, p)) && !canFundsAny(user)) notFound();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "pool" ? "pool" : sp.tab === "away" && canMove ? "away" : "mine";
  const now = new Date();
  const today = businessDate(now);

  const [mine, pool, away, me, colours] = await Promise.all([
    myItems(user, now), poolItems(user, now), canMove ? itemsWithAway(user, now) : Promise.resolve([] as InboxRow[]),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { awayFrom: true, awayTo: true, awayNote: true } }),
    poolColours(),
  ]);

  // Accept, Move (Give to... / Back to the pool) for supervisors, Correct due date on LA items with that tick: for
  // every list now (they all come with the page).
  const extras: Record<string, RowExtras> = {};
  const correct = can(user, PERMISSIONS.DUEDATES_CORRECT);
  const takes = { LA: can(user, PERMISSIONS.CHECKLIST_TICK), DP: can(user, PERMISSIONS.JOBS_WORK), FIN: canFundsAny(user) };
  for (const [list, movable] of [[mine, false], [pool, canMove], [away, canMove]] as const) {
    for (const r of list.slice(0, 60)) {
      extras[r.id] = { ...extras[r.id], correct, noAccept: !takes[r.role], ...(movable ? { giveTo: await giveToCandidates(user, r.id) } : {}) };
    }
  }
  const awayText = (p: { awayFrom: string | null; awayTo: string | null; awayNote: string }) =>
    p.awayFrom && p.awayTo && p.awayTo >= today ? `${p.awayFrom === p.awayTo ? fmtDate(p.awayFrom) : `${fmtDate(p.awayFrom)} to ${fmtDate(p.awayTo)}`}${p.awayNote ? ` (${p.awayNote})` : ""}` : null;
  const myAway = isAway(me, today) || (me.awayFrom && me.awayTo && me.awayFrom > today) ? awayText(me) : null;
  // People of the reader's branches, for "Set who is away" (the With people away tab).
  const scope = scopeIds(user);
  const people = canMove && can(user, PERMISSIONS.USERS_AWAY)
    ? (await prisma.user.findMany({
        where: { active: true, ...(scope === null ? {} : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: scope } } } }] }) },
        select: { id: true, name: true, awayFrom: true, awayTo: true, awayNote: true }, orderBy: { name: "asc" }, take: 300,
      })).map((p) => ({ id: p.id, name: p.name, away: awayText(p) }))
    : undefined;
  const awayNow = people?.filter((p) => p.away) ?? [];

  const tabs: TabInfo[] = [
    { key: "mine", label: "My items", n: mine.length },
    { key: "pool", label: "Branch pool", n: pool.length, red: pool.filter((r) => r.poolTone === "red").length },
    ...(canMove ? [{ key: "away" as const, label: "With people away", n: away.length }] : []),
  ];

  return (
    <div className="dense flex w-full min-w-0 flex-col gap-3" data-inbox-page>
      {/* D-063: the same size as the other pages; one short line with an (i); Set away at the right. */}
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight text-navy">Inbox</h1>
          <p className="relative mt-0.5 flex items-center gap-1 text-[13px] text-ink-2">Your work, least time left first. <InboxInfo /></p>
        </div>
        <SetAway me={user.id} current={myAway} until={myAway && me.awayTo ? fmtDate(me.awayTo).replace(/, \d{4}$/, "") : null} />
      </header>
      <InboxView
        tabs={tabs}
        initial={tab}
        lists={{ mine, pool, ...(canMove ? { away } : {}) }}
        extras={extras}
        canOpenLoan={can(user, PERMISSIONS.LOANS_VIEW)}
        empty={{ mine: "Nothing for you right now. Check the Branch pool for new work.", pool: "Nothing waiting in your branch pools.", away: "No items are with people who are away." }}
        poolNote={`Waiting is in working days: amber after ${colours.amber}, red after ${colours.red} (Settings, Inbox waiting colours). The target starts when you accept.`}
        awayTools={people ? (
          <section key="away-tools" aria-label="Who is away" className="card flex flex-col gap-1.5 px-3 py-2 sm:px-4">
            {awayNow.length > 0 && <p className="text-sm">{awayNow.map((p) => `${p.name}: ${p.away}`).join(" · ")}</p>}
            <AwayForm me={user.id} people={people} current={null} />
          </section>
        ) : undefined}
      />
    </div>
  );
}
