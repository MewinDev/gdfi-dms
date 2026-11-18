import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { holdsWhere } from "@/lib/auth/holders";
import { getSetting, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import type { MyLoansClientV1 } from "@/lib/myloans/v1/client";
import { recordOfRow } from "@/lib/myloans/v1/adapter";
import type { FeedPageV1, FeedRowV1 } from "@/lib/myloans/v1/schema";
import { fetchRun, planRun, CHECKPOINT_OVERLAP_MS, type HeldLoan } from "@/lib/myloans/r2/sync-plan";
import { feedStateWords, type FeedPage } from "@/lib/myloans/r2/contract";
import { getMyLoansAdapter } from "@/lib/myloans";
import { refreshLoan } from "./source-sync";
import { UserError } from "./errors";

/**
 * Piece 7 (D-047, D-052; IMPLEMENTATION_PLAN.md 8.2, 8.2a, 8.3, 8.10): the one myloans sync, on API 2.
 *
 *   runMyLoansSync({ mode })   CHANGE (since the checkpoint), CATCHUP (the last N hours, daily), FIRST_LOAD (pool mode)
 *   runScheduled()             what a scheduler calls every few minutes: the catch-up when it is due, else a change run
 *                              when the interval has passed (npm run sync:myloans; the cron route; the dev timer)
 *
 * Runs never overlap (a lease row). The checkpoint moves only after every page succeeded (page 1's RunStartedAt minus
 * 5 minutes); a catch-up never moves it back. Nothing is applied automatically (strict v2): a change becomes today's
 * review item for the loan (one per loan; the approvers of its branch decide). Released loans not yet in the DMS are
 * kept (from the cutoff) for the branch pool (10b). Every run is in the run log; N failed runs in a row alert Admin.
 */

export type SyncMode = "CHANGE" | "CATCHUP" | "FIRST_LOAD";
export type SyncTrigger = "schedule" | "script" | "run_now" | "dev_timer" | "test";
const LEASE_ID = "myloans-sync";
const LEASE_MS = 30 * 60_000;
const PAGE = 500;

export interface SyncConfig {
  intervalMinutes: number; catchUpTime: string; catchUpHours: number; alertAfterFailedRuns: number;
  /** Go-live (YYYY-MM-DD) and the branch-pool cutoff (YYYY-MM-DD; null: go-live minus 30 days, or 30 days ago until go-live is set). */
  goLiveDate: string | null; cutoffDate: string | null;
}
export interface SyncState { checkpoint: string | null; failedRuns: number; lastCatchUpDate: string | null; lastRunAt: string | null }

const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T12:00:00+08:00`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** The branch-pool cutoff (a Manila date): the setting, else go-live minus 30 days, else 30 days ago. */
export function cutoffOf(c: SyncConfig, now: Date): string {
  return c.cutoffDate ?? (c.goLiveDate ? addDays(c.goLiveDate, -30) : addDays(businessDate(now), -30));
}
/** Manila "HH:MM" now. */
const manilaTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function takeLease(holder: string, now: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "SyncLease" ("id", "holder", "expiresAt") VALUES (${LEASE_ID}, ${holder}, ${new Date(now.getTime() + LEASE_MS)})
    ON CONFLICT ("id") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "SyncLease"."expiresAt" < ${now}
    RETURNING "id"`;
  return rows.length === 1;
}
const releaseLease = (holder: string) => prisma.syncLease.deleteMany({ where: { id: LEASE_ID, holder } });

export interface RunOptions {
  mode: SyncMode; trigger: SyncTrigger; actor?: Actor; now?: Date;
  /** Tests: another client (no retries, a short timeout) and a smaller page. */
  client?: MyLoansClientV1; pageSize?: number;
}
export interface RunResult {
  ran: boolean; skipped?: string; ok?: boolean; error?: string; mode: SyncMode; runId?: string;
  pages?: number; rows?: number; unchanged?: number; reviews?: number; duplicates?: number; candidates?: number; checkpoint?: string | null;
}

/** Released and not in the DMS (from the cutoff): kept for the branch pool, only what its card needs. True: newly kept. */
async function keepCandidate(r: FeedRowV1, cutoff: string): Promise<boolean> {
  if (r.feedState !== "Released" || !r.releaseDate || r.releaseDate.slice(0, 10) < cutoff || !r.pnNo) {
    await prisma.sourceLoanCandidate.deleteMany({ where: { externalLoanId: r.externalLoanId } });
    return false;
  }
  const rec = recordOfRow(r);
  const data = { cin: r.cin, pn: r.pnNo, borrowerName: rec.borrowerName, branchCode: r.branchCode, branchName: r.branchName, productName: r.productName, amount: r.totalLoanAmount, releaseDate: new Date(r.releaseDate), lastSeenAt: new Date() };
  const was = await prisma.sourceLoanCandidate.findUnique({ where: { externalLoanId: r.externalLoanId }, select: { id: true } });
  if (was) { await prisma.sourceLoanCandidate.update({ where: { id: was.id }, data }); return false; }
  await prisma.sourceLoanCandidate.create({ data: { externalLoanId: r.externalLoanId, ...data } });
  return true;
}

export async function runMyLoansSync(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? new Date();
  const config = await getSetting("myloans.sync");
  const state = await getSetting("myloans.syncState");
  const byLabel = o.actor?.label ?? (o.trigger === "schedule" ? "The schedule" : o.trigger === "script" ? "The console command" : o.trigger === "dev_timer" ? "The development timer" : "System");
  const skip = async (why: string): Promise<RunResult> => {
    await prisma.syncRun.create({ data: { mode: o.mode, trigger: o.trigger, startedAt: now, endedAt: now, ok: true, skipped: why, byLabel } });
    return { ran: false, skipped: why, mode: o.mode };
  };
  if (await getSetting("myloans.paused")) return skip("MyLoans calls are paused by Admin.");
  const holder = randomUUID();
  if (!(await takeLease(holder, now))) return skip("Another MyLoans sync is running.");

  const run = await prisma.syncRun.create({ data: { mode: o.mode, trigger: o.trigger, startedAt: now, byLabel, checkpointBefore: state.checkpoint ? new Date(state.checkpoint) : null } });
  try {
    const client = o.client ?? myLoansClientV1({ ceiling: false });
    const cutoff = cutoffOf(config, now);
    const since = o.mode === "CATCHUP" || !state.checkpoint ? new Date(now.getTime() - config.catchUpHours * 3_600_000) : new Date(state.checkpoint);
    const page = async (afterId: number): Promise<FeedPage> => {
      const r = o.mode === "FIRST_LOAD"
        ? await client.poolPage({ releasedSince: `${cutoff}T00:00:00+08:00`, afterId, limit: o.pageSize ?? PAGE })
        : await client.changesPage({ since: since.toISOString(), afterId, limit: o.pageSize ?? PAGE });
      if (!r.ok) throw new Error(r.message);
      return r.data as unknown as FeedPage;
    };
    const fetched = await fetchRun(page);
    if (!fetched.ok) throw new Error(fetched.error);
    const rows = fetched.rows as unknown as FeedRowV1[];

    // The loans we hold: by ExternalLoanId, by CIN, and (opened before the identity was kept) by PN, linked now.
    const ids = rows.map((r) => r.externalLoanId);
    const pns = rows.map((r) => r.pnNo).filter((x): x is string => !!x);
    const cins = rows.map((r) => r.cin).filter((x): x is string => !!x);
    const loans = await prisma.loan.findMany({ where: { OR: [{ externalLoanId: { in: ids } }, { cin: { in: cins } }, { pn: { in: pns } }], cancelledAt: null }, select: { id: true, pn: true, cin: true, externalLoanId: true, contentHash: true } });
    for (const l of loans.filter((x) => x.externalLoanId === null)) {
      const r = rows.find((x) => x.pnNo === l.pn && x.isSelectable === 1);
      if (r) {
        await prisma.loan.update({ where: { id: l.id }, data: { externalLoanId: r.externalLoanId, contentHash: r.contentHash, sourceIdentities: { create: { externalLoanId: r.externalLoanId, cin: r.cin, pnNo: r.pnNo, contentHash: r.contentHash, feedState: r.feedState } } } }).catch(() => null);
        l.externalLoanId = r.externalLoanId;
        l.contentHash = r.contentHash;
      }
    }
    const held: HeldLoan[] = loans.filter((l) => l.externalLoanId !== null).map((l) => ({ loanId: l.id, cin: l.cin ?? `pn:${l.pn}`, externalLoanId: l.externalLoanId!, contentHash: l.contentHash ?? "" }));
    const plan = planRun(rows as never, held);
    const counts = { unchanged: 0, reviews: 0, duplicates: 0, candidates: 0 };
    const actor = o.actor ?? SYSTEM_ACTOR;
    const review = async (loanId: string, lookup: Parameters<typeof refreshLoan>[1]["lookup"]) => {
      // Strict v2: nothing is applied; the change becomes the loan's review item (minor changes too).
      const r = await refreshLoan(loanId, { actor, mode: "AUTOMATIC", trigger: "sync", now, lookup, holdMinor: true });
      if (r.ok && r.outcome !== "none") counts.reviews++;
    };
    const dupIds: number[] = [];
    for (const d of plan) {
      if (d.kind === "duplicate") { counts.duplicates++; dupIds.push(d.externalLoanId); continue; }
      if (d.kind === "unchanged") { counts.unchanged++; continue; }
      if (d.kind === "not-held") {
        const r = rows.find((x) => x.externalLoanId === d.externalLoanId)!;
        if (r.pnNo && loans.some((l) => l.pn === r.pnNo)) continue; // a loan file we hold under another copy
        if (await keepCandidate(r, cutoff)) counts.candidates++;
        continue;
      }
      if (d.kind === "changed") {
        const r = d.row as unknown as FeedRowV1;
        const lookup = r.isSelectable === 1
          ? { ok: true as const, record: recordOfRow(r), raw: { loan: recordOfRow(r), contract: r }, adapter: getMyLoansAdapter().name, retrievedAt: now }
          : { ok: false as const, reason: "NOT_SELECTABLE" as const, feedState: r.feedState, statusId: r.transactionStatusId, replacedByPnNo: r.replacedByPnNo, message: `${feedStateWords(r.feedState)}${r.replacedByPnNo ? ` Replaced by ${r.replacedByPnNo}.` : ""}` };
        await review(d.loanId, lookup);
        await prisma.loan.update({ where: { id: d.loanId }, data: { contentHash: r.contentHash } });
        continue;
      }
      // A redo: the copy we hold was replaced (rule a, Superseded) or a new copy of its CIN arrived (rule b).
      const rep = d.kind === "record-replaced" ? (d.row as unknown as FeedRowV1).pnNo : d.replacedByPnNo;
      await review(d.loanId, { ok: false, reason: "NOT_SELECTABLE", feedState: "Superseded", replacedByPnNo: rep ?? null, message: `${feedStateWords("Superseded")}${rep ? ` Replaced by ${rep}.` : ""}` });
    }
    if (dupIds.length) {
      const admins = (await prisma.user.findMany({ where: { ...holdsWhere(PERMISSIONS.SOURCE_MANAGE), active: true }, select: { id: true } })).map((u) => u.id);
      await prisma.$transaction((tx) => notify(tx, { userIds: admins, title: `myloans sent ${dupIds.length} loan${dupIds.length === 1 ? "" : "s"} twice in one run`, body: `ExternalLoanId ${dupIds.join(", ")}: no review items from them this run. Ask the myloans team to check them.`, link: "/admin/settings?open=myloans-sync" }));
    }

    // The checkpoint: every page succeeded. A catch-up never moves it back; the first load starts it if there is none.
    const next = fetched.checkpoint.toISOString();
    const checkpoint = o.mode === "CHANGE" || !state.checkpoint || next > state.checkpoint ? next : state.checkpoint;
    await setSetting("myloans.syncState", { ...state, checkpoint, failedRuns: 0, lastRunAt: now.toISOString(), ...(o.mode === "CATCHUP" ? { lastCatchUpDate: businessDate(now) } : {}) });
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: true, endedAt: new Date(), since: o.mode === "FIRST_LOAD" ? null : since, pages: fetched.pages, rows: rows.length, ...counts, checkpointAfter: new Date(checkpoint) } });
    await writeAudit(prisma, { actor, mode: o.trigger === "run_now" ? "MANUAL" : "AUTOMATIC", action: "myloans_sync_run", entityType: "SyncRun", entityId: run.id, summary: `${byLabel} ran the myloans sync (${o.mode.toLowerCase().replace("_", " ")}): ${rows.length} rows, ${counts.reviews} review${counts.reviews === 1 ? "" : "s"}, ${counts.candidates} released not yet in the DMS${counts.duplicates ? `, ${counts.duplicates} sent twice` : ""}` });
    return { ran: true, ok: true, mode: o.mode, runId: run.id, pages: fetched.pages, rows: rows.length, ...counts, checkpoint };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const failedRuns = state.failedRuns + 1;
    await setSetting("myloans.syncState", { ...state, failedRuns, lastRunAt: now.toISOString() });
    await prisma.syncRun.update({ where: { id: run.id }, data: { ok: false, endedAt: new Date(), error: error.slice(0, 500) } });
    if (failedRuns >= config.alertAfterFailedRuns && failedRuns % config.alertAfterFailedRuns === 0) {
      const ids = (await prisma.user.findMany({ where: { ...holdsWhere(PERMISSIONS.SOURCE_MANAGE), active: true }, select: { id: true } })).map((u) => u.id);
      await prisma.$transaction((tx) => notify(tx, { userIds: ids, title: `The myloans sync failed ${failedRuns} times in a row`, body: `Last error: ${error.slice(0, 200)}. The checkpoint was kept: nothing is lost, the next good run catches up.`, link: "/admin/settings?open=myloans-sync" }));
    }
    return { ran: true, ok: false, error, mode: o.mode, runId: run.id };
  } finally {
    await releaseLease(holder);
  }
}

/** What a scheduler calls every few minutes: the daily catch-up when it is due, else a change run when the interval passed. */
export async function runScheduled(trigger: SyncTrigger = "schedule", now: Date = new Date()): Promise<RunResult> {
  const [config, state] = await Promise.all([getSetting("myloans.sync"), getSetting("myloans.syncState")]);
  if (state.lastCatchUpDate !== businessDate(now) && manilaTime(now) >= config.catchUpTime) return runMyLoansSync({ mode: "CATCHUP", trigger, now });
  if (state.lastRunAt && now.getTime() - new Date(state.lastRunAt).getTime() < config.intervalMinutes * 60_000 - 30_000) return { ran: false, skipped: `Ran less than ${config.intervalMinutes} minutes ago.`, mode: "CHANGE" };
  return runMyLoansSync({ mode: "CHANGE", trigger, now });
}

/** Settings, MyLoans sync, Run now (myloans:sync). */
export async function runSyncNow(u: CurrentUser, mode: "CHANGE" | "CATCHUP" = "CHANGE") {
  if (!can(u, PERMISSIONS.MYLOANS_SYNC)) throw new UserError("Ask a Superadmin to turn on \"Run the MyLoans sync now\" for your role.");
  return runMyLoansSync({ mode: mode === "CATCHUP" ? "CATCHUP" : "CHANGE", trigger: "run_now", actor: { id: u.id, label: u.name } });
}

/** The run log and the state, for the Settings card. */
export async function syncOverview() {
  const [runs, config, state, candidates, paused] = await Promise.all([
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 }), getSetting("myloans.sync"), getSetting("myloans.syncState"), prisma.sourceLoanCandidate.count(), getSetting("myloans.paused"),
  ]);
  return { runs, config, state, candidates, paused, cutoff: cutoffOf(config, new Date()) };
}

export const SYNC_PAGE_SIZE = PAGE;
export const OVERLAP_MS = CHECKPOINT_OVERLAP_MS;
export type { FeedPageV1 };

const whole = (what: string, min: number, max: number) => z.coerce.number({ message: `Enter ${what}.` }).int(`Whole ${what}.`).min(min, `At least ${min}.`).max(max, `At most ${max.toLocaleString("en-PH")}.`);
const ymdOrNull = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").nullable());
export const syncSettingsSchema = z.object({
  refreshOnOpenMinutes: whole("minutes", 0, 1440),
  refreshOnFindHours: whole("hours", 0, 720),
  hourlyCeiling: whole("calls", 10, 100_000),
  intervalMinutes: whole("minutes", 5, 1440),
  catchUpTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time like 02:00."),
  catchUpHours: whole("hours", 1, 168),
  alertAfterFailedRuns: whole("runs", 1, 50),
  goLiveDate: ymdOrNull,
  cutoffDate: ymdOrNull,
});

/** Settings, MyLoans sync (myloans:manage). Audited. */
export async function saveSyncSettings(u: CurrentUser, raw: unknown) {
  if (!can(u, PERMISSIONS.SOURCE_MANAGE)) throw new UserError("Ask a Superadmin to turn on \"Change MyLoans sync settings\" for your role.");
  const p = syncSettingsSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  await prisma.$transaction(async (tx) => {
    const before = { refreshOnOpenMinutes: await getSetting("myloans.refreshOnOpenMinutes", tx), refreshOnFindHours: await getSetting("myloans.refreshOnFindHours", tx), hourlyCeiling: await getSetting("myloans.hourlyCeiling", tx), sync: await getSetting("myloans.sync", tx) };
    await setSetting("myloans.refreshOnOpenMinutes", d.refreshOnOpenMinutes, tx);
    await setSetting("myloans.refreshOnFindHours", d.refreshOnFindHours, tx);
    await setSetting("myloans.hourlyCeiling", d.hourlyCeiling, tx);
    await setSetting("myloans.sync", { intervalMinutes: d.intervalMinutes, catchUpTime: d.catchUpTime, catchUpHours: d.catchUpHours, alertAfterFailedRuns: d.alertAfterFailedRuns, goLiveDate: d.goLiveDate, cutoffDate: d.cutoffDate }, tx);
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "myloans_sync_settings", entityType: "Setting", entityId: "myloans.sync", summary: `${u.name} changed the MyLoans sync settings`, before, after: d });
  });
}
