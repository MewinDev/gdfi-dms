import "server-only";
import { prisma } from "@/lib/db";
import { notify, branchLaUserIds } from "@/lib/notify";
import { getHolidaySet } from "@/lib/settings";
import { businessDate, businessDaysBetween, isBusinessDay } from "@/lib/time";
import { adminIds, bandApprovers } from "@/lib/services/jobs";
import { financeIds, notifyOverdue } from "@/lib/services/funds";
import { jobRows } from "@/lib/services/job-queries";
import { drainOutbox } from "./outbox";

/**
 * Reminders (cron: POST /api/cron/email-reminders, or npm run email:reminders). Each is an ordinary
 * notification with its email; the outbox key makes each one once per thing per day. They follow the
 * master switch like every other email, and run on business days only (Manila, holidays).
 */

const seen = async (prefix: string) => !!(await prisma.emailOutbox.findFirst({ where: { dedupeKey: { startsWith: prefix } }, select: { id: true } }));

/** Liquidation due today or on the next business day. */
export async function liquidationDueSoon(now: Date, holidays: ReadonlySet<string>) {
  const today = businessDate(now);
  const open = await prisma.cashAdvance.findMany({ where: { status: { in: ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"] }, liquidationDueAt: { gte: now } } });
  let n = 0;
  for (const a of open) {
    const due = businessDate(a.liquidationDueAt!);
    if (businessDaysBetween(today, due, holidays) > 1) continue;
    const key = `liq-soon:${a.id}:${due}`;
    if (await seen(key)) continue;
    await prisma.$transaction(async (tx) => {
      await notify(tx, {
        userIds: [a.requestedById, ...(await financeIds(tx))], title: `${a.number}: liquidation due ${due === today ? "today" : "soon"}`,
        body: "Liquidate with receipts or return the cash.", link: "/my-funds?tab=liquidation",
        email: { event: "liquidation_due", dedupeKey: key, vars: { number: a.number, status: due === today ? "due today" : "due on the next business day", reason: "Liquidate with receipts or return the cash." } },
      });
    });
    n++;
  }
  return n;
}

/** A request (or top-up) waiting for approval for more than a business day. */
export async function approvalWaiting(now: Date, holidays: ReadonlySet<string>) {
  const today = businessDate(now);
  const waiting = await prisma.cashAdvance.findMany({ where: { status: "REQUESTED" }, include: { requestedBy: true, lines: true } });
  let n = 0;
  for (const a of waiting) {
    if (businessDaysBetween(businessDate(a.createdAt), today, holidays) < 1) continue;
    const key = `approval-wait:${a.id}:${today}`;
    if (await seen(key)) continue;
    const total = a.lines.reduce((s, l) => s + l.requestedCents, 0);
    await prisma.$transaction(async (tx) => {
      const to = await bandApprovers(tx, total);
      await notify(tx, {
        userIds: to, title: `${a.number}: still waiting for approval`, body: `${a.requestedBy.name}'s request has waited more than a business day.`, link: "/funds?tab=approve",
        email: { event: "approval_waiting", dedupeKey: key, amountCents: total, vars: { number: a.number, who: a.requestedBy.name } },
      });
    });
    n++;
  }
  return n;
}

/** Once a day: overdue jobs per branch, to the branch LAs and Admin. */
export async function tatDigest(now: Date) {
  const today = businessDate(now);
  const overdue = (await jobRows({ status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, now)).filter((r) => r.tat?.state === "overdue" || !!r.tat?.lateText);
  const byBranch = new Map<string, typeof overdue>();
  for (const r of overdue) byBranch.set(r.branch, [...(byBranch.get(r.branch) ?? []), r]);
  let n = 0;
  for (const [branchName, rows] of byBranch) {
    const branch = await prisma.branch.findFirst({ where: { name: branchName } });
    if (!branch) continue;
    const key = `tat-digest:${today}:${branch.id}`;
    if (await seen(key)) continue;
    const list = rows.slice(0, 10).map((r) => `${r.pn} ${r.typeName}`).join(", ");
    await prisma.$transaction(async (tx) => {
      await notify(tx, {
        userIds: [...(await branchLaUserIds(tx, branch.id)), ...(await adminIds(tx))], title: `${branch.name}: ${rows.length} overdue today`,
        body: list, link: "/reports/tat?show=overdue",
        email: { event: "tat_digest", dedupeKey: key, vars: { count: String(rows.length), reason: `${branch.name}: ${list}${rows.length > 10 ? ", and more" : ""}.` } },
      });
    });
    n++;
  }
  return n;
}

/** Everything the cron runs, then the sender worker. Weekends and holidays: no reminders (overdue marks still run). */
export async function runEmailReminders(now: Date = new Date()) {
  const holidays = await getHolidaySet();
  const businessDay = isBusinessDay(businessDate(now), holidays);
  await notifyOverdue(now);
  const r = businessDay
    ? { dueSoon: await liquidationDueSoon(now, holidays), approvalWaiting: await approvalWaiting(now, holidays), digest: await tatDigest(now) }
    : { dueSoon: 0, approvalWaiting: 0, digest: 0 };
  const sent = await drainOutbox({ now });
  return { businessDay, ...r, ...sent };
}
