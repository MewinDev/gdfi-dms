import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canFundsAny } from "@/lib/funds/access";
import { prisma } from "@/lib/db";
import { businessDate, fmtDate } from "@/lib/time";
import { isAway } from "@/lib/work/rules";
import { giveToCandidates, itemsWithAway, myItems, poolItems, type InboxRow } from "@/lib/services/work-items";
import { PageHeader } from "@/components/ui/basics";
import { AwayForm, InboxList, type RowExtras } from "@/components/inbox/inbox-rows";

export const metadata: Metadata = { title: "Inbox" };

type Tab = "mine" | "pool" | "away";

/**
 * Inbox (D-046). My items: what I accepted and what was given to me, least time left first. Branch pool: work any
 * of us can take (the first accept wins), longest waiting first. With people away: supervisors move it on.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const canMove = can(user, PERMISSIONS.WORKITEMS_MOVE);
  if (![PERMISSIONS.CHECKLIST_TICK, PERMISSIONS.JOBS_WORK, PERMISSIONS.WORKITEMS_MOVE].some((p) => can(user, p)) && !canFundsAny(user)) notFound();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "pool" ? "pool" : sp.tab === "away" && canMove ? "away" : "mine";
  const now = new Date();
  const today = businessDate(now);

  const [mine, pool, away, me] = await Promise.all([
    myItems(user, now), poolItems(user, now), canMove ? itemsWithAway(user, now) : Promise.resolve([] as InboxRow[]),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { awayFrom: true, awayTo: true, awayNote: true } }),
  ]);
  const rows = tab === "pool" ? pool : tab === "away" ? away : mine;

  // Move (Give to... / Back to the pool) for supervisors; Correct due date on LA items with that tick.
  const extras: Record<string, RowExtras> = {};
  const correct = can(user, PERMISSIONS.DUEDATES_CORRECT);
  const takes = { LA: can(user, PERMISSIONS.CHECKLIST_TICK), DP: can(user, PERMISSIONS.JOBS_WORK), FIN: canFundsAny(user) };
  for (const r of rows.slice(0, 60)) {
    extras[r.id] = { correct, noAccept: !takes[r.role], ...(canMove && tab !== "mine" ? { giveTo: await giveToCandidates(user, r.id) } : {}) };
  }
  const awayText = (p: { awayFrom: string | null; awayTo: string | null; awayNote: string }) =>
    p.awayFrom && p.awayTo && p.awayTo >= today ? `${p.awayFrom === p.awayTo ? fmtDate(p.awayFrom) : `${fmtDate(p.awayFrom)} to ${fmtDate(p.awayTo)}`}${p.awayNote ? ` (${p.awayNote})` : ""}` : null;
  // People of the reader's branches, for "Set who is away".
  const people = tab === "away" && can(user, PERMISSIONS.USERS_AWAY)
    ? (await prisma.user.findMany({
        where: { active: true, ...(user.scopeBranchIds === null ? {} : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: user.scopeBranchIds } } } }] }) },
        select: { id: true, name: true, awayFrom: true, awayTo: true, awayNote: true }, orderBy: { name: "asc" }, take: 300,
      })).map((p) => ({ id: p.id, name: p.name, away: awayText(p) }))
    : undefined;
  const awayNow = people?.filter((p) => p.away) ?? [];

  const tabs: { key: Tab; label: string; n: number; red?: number }[] = [
    { key: "mine", label: "My items", n: mine.length },
    { key: "pool", label: "Branch pool", n: pool.length, red: pool.filter((r) => r.poolTone === "red").length },
    ...(canMove ? [{ key: "away" as const, label: "With people away", n: away.length }] : []),
  ];

  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageHeader title="Inbox" help="Your work, least time left first. Take new work from your branch pool: the first to accept gets it." />
      <nav aria-label="Inbox tabs" className="flex overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link key={t.key} href={`/inbox?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className="tab shrink-0" data-inbox-tab={t.key}>
            {t.label} <span className="ml-1 text-ink-2">{t.n}</span>
            {t.red ? <span className="chip c-bad ml-2" title="Waiting too long">{t.red} waiting too long</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "mine" && (
        <section aria-label="Away" className="card px-4 py-3 sm:px-5">
          <AwayForm me={user.id} current={isAway(me, today) || (me.awayFrom && me.awayTo && me.awayFrom > today) ? awayText(me) : null} />
        </section>
      )}
      {tab === "away" && people && (
        <section aria-label="Who is away" className="card flex flex-col gap-2 px-4 py-3 sm:px-5">
          {awayNow.length > 0 && <p className="text-[15px]">{awayNow.map((p) => `${p.name}: ${p.away}`).join(" · ")}</p>}
          <AwayForm me={user.id} people={people} current={null} />
        </section>
      )}

      <section aria-label={tabs.find((t) => t.key === tab)?.label} className="card overflow-hidden" data-inbox-list={tab}>
        <InboxList
          rows={rows}
          extras={extras}
          pool={tab === "pool"}
          empty={tab === "pool" ? "Nothing waiting in your branch pools." : tab === "away" ? "No items are with people who are away." : "Nothing for you right now. Check the Branch pool for new work."}
        />
      </section>
      {tab === "pool" && <p className="text-[13px] text-ink-2">Waiting is in working days. Amber after 1 day, red after 2 (Settings). The target starts when you accept.</p>}
    </div>
  );
}
