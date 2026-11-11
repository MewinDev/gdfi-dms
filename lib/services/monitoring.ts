import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getSetting, getTatMap } from "@/lib/settings";
import { businessDate, fmtDate, fmtShort, startOfBusinessDay } from "@/lib/time";
import { stepClock, targetOf, txnStepKey } from "@/lib/workflow/tat";
import {
  AVAILABILITY, availability, avg, bucketOf, phtDate, buckets, businessDayCounter, onLeaveToday, parseRange, ymdAdd, type Availability, type DateRange,
} from "@/lib/monitoring/rules";
import { activeAdvisories, advisoryView, type AdvisoryView } from "./lto-advisories";

/**
 * The Monitoring page: the DP monitor and the LTO monitor. Counts are aggregated in SQL (indexes:
 * DpAssignment status+endorsedAt, decidedAt, returnedAt; JobStage kind+finishedAt; Hold
 * transactionId+resumedAt; LtoAdvisory resolvedAt). Business-day times are computed from narrow rows
 * with one precomputed calendar (lib/monitoring/rules.ts). A monitor sees counts, times and PN lists
 * only: a PN is a link only with loans:view on a loan in the person's branches; amounts only with
 * journey:view_amounts. The person's branch scope applies (Operations Monitor: all branches).
 *
 * The TAT clock never pauses: every time here includes time on hold.
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type MonitorTab = "dp" | "lto";
export type MonitorView = "totals" | "day";

export interface MonitorQuery {
  tab: MonitorTab;
  view: MonitorView;
  range: DateRange;
  branchId: string | null;
  /** Area filter (an Area id): jobs and processors of any branch in that area. */
  areaId: string | null;
  typeCode: string | null;
  /** By day: one DP (or all). Drill-down: the DP opened. */
  dpId: string | null;
  /** By day: one office (or all). Drill-down: the office opened. */
  officeId: string | null;
  /** Drill-down open: "dp" or "lto" with the id above. */
  open: boolean;
  /** Collapsed groups (keys). */
  collapsed: string[];
  /** "Has missing papers": the loan files with a paper marked Missing (as of now), instead of the tab. */
  missing: boolean;
}

export type MonitorSearch = Partial<Record<"tab" | "view" | "range" | "from" | "to" | "area" | "branch" | "type" | "dp" | "office" | "open" | "hide" | "missing", string>>;

export function parseMonitorQuery(sp: MonitorSearch, user: CurrentUser, today: string = businessDate(new Date())): MonitorQuery {
  const canDp = can(user, PERMISSIONS.MONITOR_DP), canLto = can(user, PERMISSIONS.MONITOR_LTO);
  const tab: MonitorTab = sp.tab === "lto" && canLto ? "lto" : sp.tab === "dp" && canDp ? "dp" : canDp ? "dp" : "lto";
  return {
    tab, view: sp.view === "day" ? "day" : "totals", range: parseRange(sp, today),
    branchId: sp.branch || null, areaId: sp.area || null, typeCode: sp.type || null, dpId: sp.dp || null, officeId: sp.office || null, open: sp.open === "1",
    collapsed: (sp.hide ?? "").split(",").filter(Boolean),
    missing: sp.missing === "1",
  };
}

/** The query string of a query (with changes), for links that keep the filters. */
export function monitorHref(q: MonitorQuery, change: Partial<Record<keyof MonitorSearch, string | null>> = {}): string {
  const base: MonitorSearch = {
    tab: q.tab, view: q.view === "day" ? "day" : undefined, range: q.range.preset === "custom" ? undefined : q.range.preset,
    from: q.range.preset === "custom" ? q.range.from : undefined, to: q.range.preset === "custom" ? q.range.to : undefined,
    area: q.areaId ?? undefined, branch: q.branchId ?? undefined, type: q.typeCode ?? undefined, dp: q.dpId ?? undefined, office: q.officeId ?? undefined, open: q.open ? "1" : undefined,
    hide: q.collapsed.length ? q.collapsed.join(",") : undefined,
    missing: q.missing ? "1" : undefined,
  };
  const merged = { ...base, ...change } as Record<string, string | null | undefined>;
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => !!v) as [string, string][]).toString();
  return `/monitoring${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

interface Bounds { start: Date; end: Date }
const boundsOf = (r: DateRange): Bounds => ({ start: startOfBusinessDay(r.from), end: startOfBusinessDay(ymdAdd(r.to, 1)) });
/** A PHT calendar day of a stored UTC timestamp. */
const phtDay = (col: Prisma.Sql) => Prisma.sql`to_char((${col} + interval '8 hours')::date, 'YYYY-MM-DD')`;

/** The person's branch scope and the Area and Branch filters on the loan (alias l). */
function loanBranchParts(user: CurrentUser, q: Pick<MonitorQuery, "branchId" | "areaId">): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (user.scopeBranchIds !== null) parts.push(user.scopeBranchIds.length ? Prisma.sql`l."branchId" IN (${Prisma.join(user.scopeBranchIds)})` : Prisma.sql`false`);
  if (q.areaId) parts.push(Prisma.sql`l."branchId" IN (SELECT b."id" FROM "Branch" b WHERE b."areaId" = ${q.areaId})`);
  if (q.branchId) parts.push(Prisma.sql`l."branchId" = ${q.branchId}`);
  return parts;
}

/** Loan scope, area, branch and transaction type filters on a job (aliases a, l, ty). */
function jobFilter(user: CurrentUser, q: Pick<MonitorQuery, "branchId" | "areaId" | "typeCode">): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`a."status" <> 'PULLED_BACK'`, ...loanBranchParts(user, q)];
  if (q.typeCode) parts.push(Prisma.sql`ty."code" = ${q.typeCode}`);
  return Prisma.join(parts, " AND ");
}
const JOIN = Prisma.sql`JOIN "Loan" l ON l."id" = a."loanId" JOIN "LoanTransaction" t ON t."id" = a."transactionId" JOIN "TransactionType" ty ON ty."id" = t."typeId"`;
/** The processor working the job: the second processor (Pasuyo) once there is one, else the one it was sent to. */
const PROC = Prisma.sql`COALESCE(a."secondaryDpUserId", a."dpUserId")`;

/** May this person open the loan file (the PN becomes a link)? */
const linkable = (user: CurrentUser, branchId: string) => can(user, PERMISSIONS.LOANS_VIEW) && inScope(user, branchId);

// ---------------------------------------------------------------------------
// Open jobs (today's state, "as of now")
// ---------------------------------------------------------------------------

export type OpenState = "ASSIGNED" | "IN_PROCESS" | "ON_HOLD";
export const OPEN_STATE_LABEL: Record<OpenState, string> = { ASSIGNED: "Assigned", IN_PROCESS: "In process", ON_HOLD: "On hold" };

interface OpenRow {
  id: string; owner: string; pn: string; branchId: string; typeCode: string; typeName: string; endorsedAt: Date; state: OpenState; overdue: boolean;
  /** The current step's start and target (the due date is worked out only for the drill-down rows). */
  stepStart: Date; target: number | null;
}

async function openJobs(user: CurrentUser, q: MonitorQuery, now: Date): Promise<OpenRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; dp: string; proc: string; status: string; tstatus: string; statusSince: Date; endorsedAt: Date; code: string; name: string; pn: string; branchId: string; held: boolean }[]>`
    SELECT a."id", a."dpUserId" AS dp, ${PROC} AS proc, a."status"::text AS status, t."status"::text AS tstatus, t."statusSince" AS "statusSince", a."endorsedAt" AS "endorsedAt",
      ty."code" AS code, ty."name" AS name, l."pn" AS pn, l."branchId" AS "branchId",
      EXISTS (SELECT 1 FROM "Hold" h WHERE h."transactionId" = t."id" AND h."resumedAt" IS NULL) AS held
    FROM "DpAssignment" a ${JOIN}
    WHERE (a."status" = 'PENDING_ACCEPTANCE' OR (a."status" = 'ACCEPTED' AND t."status" = 'IN_PROCESS')) AND ${jobFilter(user, q)}`;
  const [tats, holidays] = await Promise.all([getTatMap(), getHolidaySet()]);
  const today = businessDate(now);
  const first = rows.reduce((m, r) => { const d = phtDate(r.statusSince); return d < m ? d : m; }, today);
  const bd = businessDayCounter(holidays, ymdAdd(first, -1), today);
  return rows.map((r) => {
    const pending = r.status === "PENDING_ACCEPTANCE";
    // The existing late logic (stepClock in lib/workflow/tat.ts): the current step is late when the
    // business days used since it began are more than its target. One lookup per job.
    const target = targetOf(tats, txnStepKey(r.tstatus, r.code));
    return {
      id: r.id, owner: pending ? r.dp : r.proc, pn: r.pn, branchId: r.branchId, typeCode: r.code, typeName: r.name, endorsedAt: r.endorsedAt,
      state: r.held ? "ON_HOLD" : pending ? "ASSIGNED" : "IN_PROCESS", overdue: target !== null && bd(r.statusSince, now) > target, stepStart: r.statusSince, target,
    };
  });
}

/** Open jobs per processor right now (assigned + in process + on hold): the Send panel and the monitor use the same count. */
export async function openJobCounts(dpIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ owner: string; n: bigint }[]>`
    SELECT CASE WHEN a."status" = 'PENDING_ACCEPTANCE' THEN a."dpUserId" ELSE ${PROC} END AS owner, count(*) AS n
    FROM "DpAssignment" a JOIN "LoanTransaction" t ON t."id" = a."transactionId"
    WHERE (a."status" = 'PENDING_ACCEPTANCE' OR (a."status" = 'ACCEPTED' AND t."status" = 'IN_PROCESS'))
    ${dpIds ? (dpIds.length ? Prisma.sql`AND CASE WHEN a."status" = 'PENDING_ACCEPTANCE' THEN a."dpUserId" ELSE ${PROC} END IN (${Prisma.join(dpIds)})` : Prisma.sql`AND false`) : Prisma.empty}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.owner, Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export interface DpPerson {
  id: string;
  name: string;
  /** All branches (no rows): branchIds then lists every active branch shown in the DMS. */
  allBranches: boolean;
  /** The branches in the processor's access (every active, shown branch with All branches). */
  branchIds: string[];
  branchNames: string[];
  capacity: number;
  ownCapacity: number | null;
  onLeave: boolean;
  leaveUntil: string | null;
}

/** Active processors (processing:receive), with capacity and leave. */
export async function processors(today: string = businessDate(new Date())): Promise<DpPerson[]> {
  const [rows, def, everyBranch] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } } }, orderBy: { name: "asc" },
      select: { id: true, name: true, allBranches: true, dpCapacity: true, dpOnLeave: true, dpLeaveUntil: true, branches: { select: { branch: { select: { id: true, name: true } } } } },
    }),
    defaultCapacity(),
    prisma.branch.findMany({ where: { active: true, hidden: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => {
    const b = r.allBranches ? everyBranch : r.branches.map((x) => x.branch).sort((x, y) => x.name.localeCompare(y.name));
    return {
      id: r.id, name: r.name, allBranches: r.allBranches, branchIds: b.map((x) => x.id), branchNames: r.allBranches ? ["All branches"] : b.map((x) => x.name), capacity: r.dpCapacity ?? def, ownCapacity: r.dpCapacity,
      onLeave: onLeaveToday(r, today), leaveUntil: r.dpOnLeave ? r.dpLeaveUntil : null,
    };
  });
}

export async function defaultCapacity(): Promise<number> {
  const v = Number(await getSetting("dp.defaultCapacity"));
  return Number.isFinite(v) && v >= AVAILABILITY.minCapacity ? Math.round(v) : AVAILABILITY.defaultCapacity;
}

/** A branch with its code and Area, for the groups, chips and filters. On screen: the name only ("Antipolo"). */
export interface BranchPlace { id: string; name: string; code: string | null; areaId: string | null; areaName: string | null; hidden: boolean }
export const branchLabel = (b: { name: string; code: string | null }) => b.name;

export async function branchPlaces(): Promise<Map<string, BranchPlace>> {
  const rows = await prisma.branch.findMany({ select: { id: true, name: true, code: true, areaId: true, hidden: true, area: { select: { name: true } } } });
  return new Map(rows.map((b) => [b.id, { id: b.id, name: b.name, code: b.code, areaId: b.areaId, areaName: b.area?.name ?? null, hidden: b.hidden }]));
}

export const SEVERAL_AREAS = "Several areas";
export const NO_BRANCH = "No branch";
export const NO_AREA = "Area needed";

/**
 * Where a processor is grouped: their Area when all their branches share one, otherwise "Several areas"
 * (never twice); inside it the branch, or their branches together ("Angono · Antipolo").
 */
export function dpPlace(p: Pick<DpPerson, "branchIds">, places: Map<string, BranchPlace>): { area: string; areaId: string | null; branch: string; chips: string[] } {
  const mine = p.branchIds.map((id) => places.get(id)).filter((b): b is BranchPlace => !!b).sort((x, y) => x.name.localeCompare(y.name));
  if (!mine.length) return { area: NO_BRANCH, areaId: null, branch: NO_BRANCH, chips: [] };
  const areas = [...new Set(mine.map((b) => b.areaId ?? ""))];
  const chips = mine.map(branchLabel);
  const area = areas.length > 1 ? SEVERAL_AREAS : mine[0].areaName ?? NO_AREA;
  return { area, areaId: areas.length === 1 ? mine[0].areaId : null, branch: chips.length > 3 ? `${chips.length} branches` : chips.join(" · "), chips };
}

/** The group of a processor (the Area level), for By day and the drill-down. */
export const dpGroup = (p: Pick<DpPerson, "branchIds">, places: Map<string, BranchPlace>) => dpPlace(p, places).area;

/** Does a processor match the Area and Branch filters (any of their branches)? */
function dpMatches(p: Pick<DpPerson, "branchIds">, q: Pick<MonitorQuery, "branchId" | "areaId">, places: Map<string, BranchPlace>): boolean {
  if (q.branchId && !p.branchIds.includes(q.branchId)) return false;
  if (q.areaId && !p.branchIds.some((id) => places.get(id)?.areaId === q.areaId)) return false;
  return true;
}
const lastLabels = new Set([SEVERAL_AREAS, NO_AREA, NO_BRANCH]);
const byLabel = (a: string, z: string) => (lastLabels.has(a) !== lastLabels.has(z) ? (lastLabels.has(a) ? 1 : -1) : a.localeCompare(z));

// ---------------------------------------------------------------------------
// DP monitor
// ---------------------------------------------------------------------------

export interface Avg { days: number | null; n: number }
export interface DpRow {
  id: string;
  name: string;
  /** The Area group ("LUZON 1 (NGMA + RIZAL)", "Several areas"). */
  group: string;
  /** The branch group inside the Area ("Antipolo (101)", or the branches together). */
  branchGroup: string;
  /** Every branch of the processor, as chips (names only). */
  branches: string[];
  assigned: number;
  inProcess: number;
  onHold: number;
  overdue: number;
  declined: number;
  returned: number;
  accept: Avg;
  processing: Avg;
  total: Avg;
  finished: number;
  open: number;
  avail: Availability;
  leaveUntil: string | null;
}
export type DpSub = Omit<DpRow, "id" | "name" | "group" | "branchGroup" | "branches" | "avail" | "leaveUntil"> & { availPct: number | null };
export interface DpBranchGroup { key: string; label: string; rows: DpRow[]; sub: DpSub }
/** An Area with its branch groups; each processor is in exactly one Area and one branch group. */
export interface DpGroup { key: string; label: string; rows: DpRow[]; branches: DpBranchGroup[]; sub: DpSub }
export interface DpMonitor {
  tiles: { activeDps: number; assigned: number; inProcess: number; onHold: number; overdue: number; avgTotal: Avg; avgAvailability: number | null };
  groups: DpGroup[];
  rows: DpRow[];
}

interface Finished { proc: string; endorsedAt: Date; decidedAt: Date | null; finishedAt: Date }

async function finishedJobs(user: CurrentUser, q: MonitorQuery, b: Bounds): Promise<Finished[]> {
  return prisma.$queryRaw<Finished[]>`
    SELECT ${PROC} AS proc, a."endorsedAt" AS "endorsedAt", a."decidedAt" AS "decidedAt", v."finishedAt" AS "finishedAt"
    FROM "JobStage" v JOIN "DpAssignment" a ON a."id" = v."assignmentId" ${JOIN}
    WHERE v."kind" = 'VERIFY' AND v."finishedAt" >= ${b.start} AND v."finishedAt" < ${b.end} AND ${jobFilter(user, q)}`;
}

async function sentBackCounts(user: CurrentUser, q: MonitorQuery, b: Bounds) {
  return prisma.$queryRaw<{ who: string; kind: "declined" | "returned"; n: bigint }[]>`
    SELECT a."dpUserId" AS who, 'declined' AS kind, count(*) AS n FROM "DpAssignment" a ${JOIN}
      WHERE a."status" = 'DECLINED' AND a."decidedAt" >= ${b.start} AND a."decidedAt" < ${b.end} AND ${jobFilter(user, q)} GROUP BY 1
    UNION ALL
    SELECT ${PROC} AS who, 'returned' AS kind, count(*) AS n FROM "DpAssignment" a ${JOIN}
      WHERE a."status" = 'WITHDRAWN' AND a."returnedAt" >= ${b.start} AND a."returnedAt" < ${b.end} AND ${jobFilter(user, q)} GROUP BY 1`;
}

const sumKeys = ["assigned", "inProcess", "onHold", "overdue", "declined", "returned", "finished", "open"] as const;

export async function dpMonitor(user: CurrentUser, q: MonitorQuery, now: Date = new Date()): Promise<DpMonitor> {
  const today = businessDate(now);
  const b = boundsOf(q.range);
  const [people, open, finished, back, holidays, places] = await Promise.all([processors(today), openJobs(user, q, now), finishedJobs(user, q, b), sentBackCounts(user, q, b), getHolidaySet(), branchPlaces()]);
  const minDay = finished.reduce((m, f) => { const d = phtDate(f.endorsedAt); return d < m ? d : m; }, q.range.from);
  const bd = businessDayCounter(holidays, ymdAdd(minDay, -1), ymdAdd(q.range.to, 1));
  const seen = new Set([...open.map((o) => o.owner), ...finished.map((f) => f.proc), ...back.map((x) => x.who)]);
  // In the person's branches (and the Area and Branch filters: any of their branches): processors of
  // those branches, plus anyone with work there.
  const inBranches = (p: DpPerson) =>
    (user.scopeBranchIds === null || p.branchIds.some((x) => user.scopeBranchIds!.includes(x))) && dpMatches(p, q, places);
  const list = people.filter((p) => inBranches(p) || seen.has(p.id));
  const times = new Map<string, { accept: number[]; processing: number[]; total: number[] }>();
  for (const f of finished) {
    const t = times.get(f.proc) ?? { accept: [], processing: [], total: [] };
    if (f.decidedAt) { t.accept.push(bd(f.endorsedAt, f.decidedAt)); t.processing.push(bd(f.decidedAt, f.finishedAt)); }
    t.total.push(bd(f.endorsedAt, f.finishedAt));
    times.set(f.proc, t);
  }
  const rows: DpRow[] = list.map((p) => {
    const mine = open.filter((o) => o.owner === p.id);
    const t = times.get(p.id) ?? { accept: [], processing: [], total: [] };
    const assigned = mine.filter((o) => o.state === "ASSIGNED").length;
    const inProcess = mine.filter((o) => o.state === "IN_PROCESS").length;
    const onHold = mine.filter((o) => o.state === "ON_HOLD").length;
    const openN = assigned + inProcess + onHold;
    const place = dpPlace(p, places);
    return {
      id: p.id, name: p.name, group: place.area, branchGroup: place.branch, branches: place.chips, assigned, inProcess, onHold, overdue: mine.filter((o) => o.overdue).length,
      declined: Number(back.find((x) => x.who === p.id && x.kind === "declined")?.n ?? 0), returned: Number(back.find((x) => x.who === p.id && x.kind === "returned")?.n ?? 0),
      accept: { days: avg(t.accept), n: t.accept.length }, processing: { days: avg(t.processing), n: t.processing.length }, total: { days: avg(t.total), n: t.total.length },
      finished: t.total.length, open: openN, avail: availability(p.capacity, openN, p.onLeave), leaveUntil: p.onLeave ? p.leaveUntil : null,
    };
  });
  const subOf = (rs: DpRow[]): DpSub => {
    const pick = (k: "accept" | "processing" | "total") => rs.flatMap((r) => times.get(r.id)?.[k] ?? []);
    const working = rs.filter((r) => r.avail.status !== "ON_LEAVE");
    const sub = Object.fromEntries(sumKeys.map((k) => [k, rs.reduce((s, r) => s + r[k], 0)])) as Record<(typeof sumKeys)[number], number>;
    return { ...sub, accept: { days: avg(pick("accept")), n: pick("accept").length }, processing: { days: avg(pick("processing")), n: pick("processing").length }, total: { days: avg(pick("total")), n: pick("total").length }, availPct: working.length ? Math.round(working.reduce((s, r) => s + r.avail.pct, 0) / working.length) : null };
  };
  const byGroup = new Map<string, DpRow[]>();
  for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  // Area, then Branch: each processor is in one Area group and one branch group, so nobody counts twice.
  const groups: DpGroup[] = [...byGroup.entries()].sort(([a], [z]) => byLabel(a, z)).map(([label, rs]) => {
    const byBranch = new Map<string, DpRow[]>();
    for (const r of rs) byBranch.set(r.branchGroup, [...(byBranch.get(r.branchGroup) ?? []), r]);
    const key = groupKey(label);
    const branches = [...byBranch.entries()].sort(([a], [z]) => byLabel(a, z)).map(([bl, brs]) => ({ key: `${key}--${groupKey(bl)}`, label: bl, rows: brs, sub: subOf(brs) }));
    return { key, label, rows: branches.flatMap((x) => x.rows), branches, sub: subOf(rs) };
  });
  const allTotals = [...times.values()].flatMap((t) => t.total);
  const working = rows.filter((r) => r.avail.status !== "ON_LEAVE");
  return {
    tiles: {
      activeDps: rows.length, assigned: sum(rows, "assigned"), inProcess: sum(rows, "inProcess"), onHold: sum(rows, "onHold"), overdue: sum(rows, "overdue"),
      avgTotal: { days: avg(allTotals), n: allTotals.length },
      avgAvailability: working.length ? Math.round(working.reduce((s, r) => s + r.avail.pct, 0) / working.length) : null,
    },
    groups, rows,
  };
}
const sum = <T,>(rows: T[], k: keyof T) => rows.reduce((s, r) => s + Number(r[k]), 0);
export const groupKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "none";

// ---------------------------------------------------------------------------
// DP drill-down
// ---------------------------------------------------------------------------

export interface DrillJob { id: string; pn: string; href: string | null; typeName: string; status: string; age: string; due: string; overdue: boolean; when?: string; note?: string }
export interface DpDrill { id: string; name: string; group: string; branches: string[]; open: DrillJob[]; declined: DrillJob[]; returned: DrillJob[]; avail: Availability; leaveUntil: string | null }

export async function dpDrill(user: CurrentUser, q: MonitorQuery, dpId: string, now: Date = new Date()): Promise<DpDrill | null> {
  const today = businessDate(now);
  const [p, places] = await Promise.all([processors(today).then((ps) => ps.find((x) => x.id === dpId)), branchPlaces()]);
  if (!p) return null;
  const b = boundsOf(q.range);
  const [open, back, holidays] = await Promise.all([
    openJobs(user, q, now),
    prisma.$queryRaw<{ id: string; pn: string; branchId: string; name: string; status: string; at: Date; note: string | null }[]>`
      SELECT a."id", l."pn" AS pn, l."branchId" AS "branchId", ty."name" AS name, a."status"::text AS status,
        CASE WHEN a."status" = 'DECLINED' THEN a."decidedAt" ELSE a."returnedAt" END AS at,
        CASE WHEN a."status" = 'DECLINED' THEN a."declineReasons" ELSE a."returnReasons" END AS note
      FROM "DpAssignment" a ${JOIN}
      WHERE ((a."status" = 'DECLINED' AND a."dpUserId" = ${dpId} AND a."decidedAt" >= ${b.start} AND a."decidedAt" < ${b.end})
          OR (a."status" = 'WITHDRAWN' AND ${PROC} = ${dpId} AND a."returnedAt" >= ${b.start} AND a."returnedAt" < ${b.end}))
        AND ${jobFilter(user, q)}
      ORDER BY at DESC`,
    getHolidaySet(),
  ]);
  const bd = businessDayCounter(holidays, ymdAdd(today, -400), today);
  const mine = open.filter((o) => o.owner === dpId).sort((x, y) => Number(y.overdue) - Number(x.overdue) || x.endorsedAt.getTime() - y.endorsedAt.getTime());
  const due = (o: OpenRow) => (o.target === null ? null : stepClock({ targetDays: o.target, start: o.stepStart }, holidays, now).deadline);
  const ageText = (d: Date) => { const n = bd(d, now); return `${n} business day${n === 1 ? "" : "s"}`; };
  const openN = mine.length;
  return {
    id: p.id, name: p.name, group: dpGroup(p, places), branches: dpPlace(p, places).chips, avail: availability(p.capacity, openN, p.onLeave), leaveUntil: p.onLeave ? p.leaveUntil : null,
    open: mine.map((o) => ({
      id: o.id, pn: o.pn, href: linkable(user, o.branchId) ? `/loans/${o.pn}` : null, typeName: o.typeName, status: OPEN_STATE_LABEL[o.state],
      age: ageText(o.endorsedAt), due: (() => { const d = due(o); return d ? fmtDate(d) : "No target"; })(), overdue: o.overdue,
    })),
    declined: back.filter((x) => x.status === "DECLINED").map((x) => sentBackRow(user, x, ageText)),
    returned: back.filter((x) => x.status === "WITHDRAWN").map((x) => sentBackRow(user, x, ageText)),
  };
}
function sentBackRow(user: CurrentUser, x: { id: string; pn: string; branchId: string; name: string; status: string; at: Date; note: string | null }, ageText: (d: Date) => string): DrillJob {
  return { id: x.id, pn: x.pn, href: linkable(user, x.branchId) ? `/loans/${x.pn}` : null, typeName: x.name, status: x.status === "DECLINED" ? "Declined" : "Returned to LA", age: ageText(x.at), due: "-", overdue: false, when: fmtShort(x.at), note: x.note ?? "" };
}

// ---------------------------------------------------------------------------
// By day (DPs or LTO offices)
// ---------------------------------------------------------------------------

export interface DayRow { key: string; label: string; counts: Record<string, number> }
export interface DayGroup { key: string; label: string; rows: DayRow[]; sub: Record<string, number> }
export interface ByDay { unit: "day" | "week"; columns: { key: string; label: string }[]; groups: DayGroup[]; total: Record<string, number> }

export const DP_DAY_COLUMNS = [
  { key: "assigned", label: "Assigned" }, { key: "accepted", label: "Accepted" }, { key: "finished", label: "Finished" }, { key: "declined", label: "Declined" }, { key: "returned", label: "Returned" },
];
export const LTO_DAY_COLUMNS = [{ key: "dropped", label: "Dropped off" }, { key: "picked", label: "Picked up" }, { key: "advisories", label: "Advisories filed" }];

function assembleByDay(range: DateRange, columns: { key: string; label: string }[], events: { kind: string; day: string; who: string; n: number }[], groupOf: (who: string) => string | null): ByDay {
  const { unit, rows: bs } = buckets(range.from, range.to);
  const zero = () => Object.fromEntries(columns.map((c) => [c.key, 0])) as Record<string, number>;
  const g = new Map<string, Map<string, Record<string, number>>>();
  for (const e of events) {
    const label = groupOf(e.who);
    if (!label) continue;
    const per = g.get(label) ?? new Map<string, Record<string, number>>();
    const k = bucketOf(e.day, unit);
    const c = per.get(k) ?? zero();
    c[e.kind] = (c[e.kind] ?? 0) + e.n;
    per.set(k, c);
    g.set(label, per);
  }
  const total = zero();
  const groups: DayGroup[] = [...g.entries()].sort(([a], [z]) => byLabel(a, z)).map(([label, per]) => {
    const sub = zero();
    const rows = bs.map((bk) => {
      const counts = per.get(bk.key) ?? zero();
      for (const c of columns) { sub[c.key] += counts[c.key]; total[c.key] += counts[c.key]; }
      return { key: bk.key, label: bk.label, counts };
    });
    return { key: groupKey(label), label, rows, sub };
  });
  return { unit, columns, groups, total };
}

export async function dpByDay(user: CurrentUser, q: MonitorQuery): Promise<ByDay> {
  const b = boundsOf(q.range);
  const f = jobFilter(user, q);
  const one = q.dpId ? Prisma.sql`AND who = ${q.dpId}` : Prisma.empty;
  const events = await prisma.$queryRaw<{ kind: string; day: string; who: string; n: bigint }[]>`
    SELECT kind, day, who, count(*) AS n FROM (
      SELECT 'assigned' AS kind, ${phtDay(Prisma.sql`a."endorsedAt"`)} AS day, a."dpUserId" AS who FROM "DpAssignment" a ${JOIN}
        WHERE a."endorsedAt" >= ${b.start} AND a."endorsedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'accepted', ${phtDay(Prisma.sql`a."decidedAt"`)}, a."dpUserId" FROM "DpAssignment" a ${JOIN}
        WHERE a."status" IN ('ACCEPTED', 'CLOSED', 'WITHDRAWN') AND a."decidedAt" >= ${b.start} AND a."decidedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'finished', ${phtDay(Prisma.sql`v."finishedAt"`)}, ${PROC} FROM "JobStage" v JOIN "DpAssignment" a ON a."id" = v."assignmentId" ${JOIN}
        WHERE v."kind" = 'VERIFY' AND v."finishedAt" >= ${b.start} AND v."finishedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'declined', ${phtDay(Prisma.sql`a."decidedAt"`)}, a."dpUserId" FROM "DpAssignment" a ${JOIN}
        WHERE a."status" = 'DECLINED' AND a."decidedAt" >= ${b.start} AND a."decidedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'returned', ${phtDay(Prisma.sql`a."returnedAt"`)}, ${PROC} FROM "DpAssignment" a ${JOIN}
        WHERE a."status" = 'WITHDRAWN' AND a."returnedAt" >= ${b.start} AND a."returnedAt" < ${b.end} AND ${f}
    ) x WHERE true ${one} GROUP BY kind, day, who`;
  const [people, places] = await Promise.all([processors().then((ps) => new Map(ps.map((p) => [p.id, p]))), branchPlaces()]);
  return assembleByDay(q.range, DP_DAY_COLUMNS, events.map((e) => ({ ...e, n: Number(e.n) })), (who) => {
    const p = people.get(who);
    return p ? (q.dpId ? p.name : dpGroup(p, places)) : null;
  });
}

// ---------------------------------------------------------------------------
// LTO monitor
// ---------------------------------------------------------------------------

export interface LtoRow {
  id: string;
  name: string;
  area: string;
  distanceKm: number | null;
  used: number;
  atNow: number;
  avgAt: Avg;
  activeAdvisories: number;
  latest: AdvisoryView | null;
  /** Only for journey:view_amounts (null otherwise). */
  money: { estimateCents: number | null; spentCents: number } | null;
}
export interface LtoGroup { key: string; label: string; rows: LtoRow[]; sub: { used: number; atNow: number; avgAt: Avg; activeAdvisories: number; estimateCents: number | null; spentCents: number } }
export interface LtoMonitor {
  tiles: { withAdvisory: number; atNow: number; avgAt: Avg; busiest: { name: string; used: number } | null };
  groups: LtoGroup[];
  rows: LtoRow[];
  advisories: AdvisoryView[];
  resolved: AdvisoryView[];
  showAmounts: boolean;
}

interface LtoJob { id: string; officeId: string; pn: string; branchId: string; typeName: string; dpName: string; drop: Date; pick: Date | null; open: boolean }

async function ltoJobs(user: CurrentUser, q: MonitorQuery, b: Bounds, officeId?: string): Promise<LtoJob[]> {
  return prisma.$queryRaw<LtoJob[]>`
    SELECT a."id", a."ltoOfficeId" AS "officeId", l."pn" AS pn, l."branchId" AS "branchId", ty."name" AS "typeName", u."name" AS "dpName",
      d."finishedAt" AS drop, p."finishedAt" AS pick, (a."status" = 'ACCEPTED' AND t."status" = 'IN_PROCESS') AS open
    FROM "DpAssignment" a ${JOIN}
      JOIN "JobStage" d ON d."assignmentId" = a."id" AND d."kind" = 'LTO_DROP'
      LEFT JOIN "JobStage" p ON p."assignmentId" = a."id" AND p."kind" = 'LTO_PICKUP'
      JOIN "User" u ON u."id" = ${PROC}
    WHERE a."ltoOfficeId" IS NOT NULL AND d."finishedAt" IS NOT NULL AND ${jobFilter(user, q)}
      ${officeId ? Prisma.sql`AND a."ltoOfficeId" = ${officeId}` : Prisma.empty}
      AND ((p."finishedAt" IS NULL AND a."status" = 'ACCEPTED' AND t."status" = 'IN_PROCESS')
        OR (d."finishedAt" >= ${b.start} AND d."finishedAt" < ${b.end})
        OR (p."finishedAt" >= ${b.start} AND p."finishedAt" < ${b.end}))`;
}

const inB = (d: Date | null, b: Bounds) => !!d && d >= b.start && d < b.end;

export async function ltoMonitor(user: CurrentUser, q: MonitorQuery, now: Date = new Date()): Promise<LtoMonitor> {
  const b = boundsOf(q.range);
  const showAmounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  const [offices, jobs, active, resolvedRows, holidays, spent] = await Promise.all([
    prisma.ltoOffice.findMany({ orderBy: { name: "asc" } }),
    ltoJobs(user, q, b),
    activeAdvisories(user, undefined, now),
    prisma.ltoAdvisory.findMany({ where: { resolvedAt: { gte: b.start, lt: b.end } }, include: { ltoOffice: true }, orderBy: { resolvedAt: "desc" }, take: 50 }),
    getHolidaySet(),
    showAmounts ? travelSpent(user, q) : Promise.resolve(new Map<string, number>()),
  ]);
  const bd = businessDayCounter(holidays, ymdAdd(q.range.from, -120), ymdAdd(q.range.to, 1));
  const timesByOffice = new Map<string, number[]>();
  const rows: LtoRow[] = [];
  for (const o of offices) {
    const mine = jobs.filter((j) => j.officeId === o.id);
    const usedJobs = mine.filter((j) => inB(j.drop, b));
    const times = mine.filter((j) => inB(j.pick, b)).map((j) => bd(j.drop, j.pick!));
    const adv = active.filter((a) => a.officeId === o.id);
    const r: LtoRow = {
      id: o.id, name: o.name, area: o.city || "No area", distanceKm: o.distanceKm, used: usedJobs.length, atNow: mine.filter((j) => !j.pick && j.open).length,
      avgAt: { days: avg(times), n: times.length }, activeAdvisories: adv.length, latest: adv[0] ?? null,
      money: showAmounts ? { estimateCents: o.suggestedTransportCents != null ? o.suggestedTransportCents * usedJobs.length : null, spentCents: spent.get(o.id) ?? 0 } : null,
    };
    // Inactive offices only when they still have something to show.
    if (!o.active && !r.used && !r.atNow && !r.avgAt.n && !r.activeAdvisories) continue;
    timesByOffice.set(o.id, times);
    rows.push(r);
  }
  const byArea = new Map<string, LtoRow[]>();
  for (const r of rows) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  const groups: LtoGroup[] = [...byArea.entries()].sort(([a], [z]) => (a === "No area" ? 1 : z === "No area" ? -1 : a.localeCompare(z))).map(([label, rs]) => {
    const t = rs.flatMap((r) => timesByOffice.get(r.id) ?? []);
    const est = rs.map((r) => r.money?.estimateCents).filter((x): x is number => x != null);
    return {
      key: groupKey(label), label, rows: rs,
      sub: { used: sum(rs, "used"), atNow: sum(rs, "atNow"), avgAt: { days: avg(t), n: t.length }, activeAdvisories: sum(rs, "activeAdvisories"), estimateCents: est.length ? est.reduce((s, x) => s + x, 0) : null, spentCents: rs.reduce((s, r) => s + (r.money?.spentCents ?? 0), 0) },
    };
  });
  const allTimes = rows.flatMap((r) => timesByOffice.get(r.id) ?? []);
  const busiest = rows.filter((r) => r.used > 0).sort((x, y) => y.used - x.used || x.name.localeCompare(y.name))[0];
  return {
    tiles: { withAdvisory: new Set(active.map((a) => a.officeId)).size, atNow: sum(rows, "atNow"), avgAt: { days: avg(allTimes), n: allTimes.length }, busiest: busiest ? { name: busiest.name, used: busiest.used } : null },
    groups, rows, advisories: active, resolved: resolvedRows.map((r) => advisoryView(r, user, now)), showAmounts,
  };
}
/**
 * Actual travel cash spent per office in the period: the spends logged on Transport lines of funds
 * records for that office (what the funds code stores at each attempt), attempt dates in the period.
 */
async function travelSpent(user: CurrentUser, q: MonitorQuery): Promise<Map<string, number>> {
  const parts: Prisma.Sql[] = [Prisma.sql`ln."kind" = 'TRANSPORT'`, Prisma.sql`ln."ltoOfficeId" IS NOT NULL`, Prisma.sql`at."date" >= ${q.range.from}`, Prisma.sql`at."date" <= ${q.range.to}`];
  parts.push(...loanBranchParts(user, q));
  if (q.typeCode) parts.push(Prisma.sql`ty."code" = ${q.typeCode}`);
  const rows = await prisma.$queryRaw<{ office: string; cents: bigint }[]>`
    SELECT ln."ltoOfficeId" AS office, SUM(s."cents") AS cents
    FROM "AttemptSpend" s JOIN "CashAdvanceLine" ln ON ln."id" = s."lineId" JOIN "TransactionAttempt" at ON at."id" = s."attemptId"
      JOIN "LoanTransaction" t ON t."id" = at."transactionId" JOIN "Loan" l ON l."id" = t."loanId" JOIN "TransactionType" ty ON ty."id" = t."typeId"
    WHERE ${Prisma.join(parts, " AND ")} GROUP BY 1`;
  return new Map(rows.map((r) => [r.office, Number(r.cents)]));
}

export interface LtoDrillJob { id: string; pn: string; href: string | null; typeName: string; dpName: string; dropText: string; pickText: string; days: string }
export interface LtoDrill { id: string; name: string; area: string; atNow: LtoDrillJob[]; finished: LtoDrillJob[]; advisories: AdvisoryView[] }

export async function ltoDrill(user: CurrentUser, q: MonitorQuery, officeId: string, now: Date = new Date()): Promise<LtoDrill | null> {
  const o = await prisma.ltoOffice.findUnique({ where: { id: officeId } });
  if (!o) return null;
  const b = boundsOf(q.range);
  const [jobs, holidays, adv] = await Promise.all([ltoJobs(user, q, b, officeId), getHolidaySet(), activeAdvisories(user, [officeId], now)]);
  const bd = businessDayCounter(holidays, ymdAdd(businessDate(now), -400), businessDate(now));
  const row = (j: LtoJob): LtoDrillJob => {
    const n = bd(j.drop, j.pick ?? now);
    return { id: j.id, pn: j.pn, href: linkable(user, j.branchId) ? `/loans/${j.pn}` : null, typeName: j.typeName, dpName: j.dpName, dropText: fmtShort(j.drop), pickText: j.pick ? fmtShort(j.pick) : "Not yet", days: `${n} business day${n === 1 ? "" : "s"}${j.pick ? "" : " so far"}` };
  };
  return {
    id: o.id, name: o.name, area: o.city || "No area", advisories: adv,
    atNow: jobs.filter((j) => !j.pick && j.open).sort((x, y) => x.drop.getTime() - y.drop.getTime()).map(row),
    finished: jobs.filter((j) => inB(j.pick, b)).sort((x, y) => y.pick!.getTime() - x.pick!.getTime()).map(row),
  };
}

export async function ltoByDay(user: CurrentUser, q: MonitorQuery): Promise<ByDay> {
  const b = boundsOf(q.range);
  const f = jobFilter(user, q);
  const one = q.officeId ? Prisma.sql`AND who = ${q.officeId}` : Prisma.empty;
  const events = await prisma.$queryRaw<{ kind: string; day: string; who: string; n: bigint }[]>`
    SELECT kind, day, who, count(*) AS n FROM (
      SELECT 'dropped' AS kind, ${phtDay(Prisma.sql`d."finishedAt"`)} AS day, a."ltoOfficeId" AS who
        FROM "JobStage" d JOIN "DpAssignment" a ON a."id" = d."assignmentId" ${JOIN}
        WHERE d."kind" = 'LTO_DROP' AND a."ltoOfficeId" IS NOT NULL AND d."finishedAt" >= ${b.start} AND d."finishedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'picked', ${phtDay(Prisma.sql`p."finishedAt"`)}, a."ltoOfficeId"
        FROM "JobStage" p JOIN "DpAssignment" a ON a."id" = p."assignmentId" ${JOIN}
        WHERE p."kind" = 'LTO_PICKUP' AND a."ltoOfficeId" IS NOT NULL AND p."finishedAt" >= ${b.start} AND p."finishedAt" < ${b.end} AND ${f}
      UNION ALL
      SELECT 'advisories', ${phtDay(Prisma.sql`x."startedAt"`)}, x."ltoOfficeId" FROM "LtoAdvisory" x
        WHERE x."startedAt" >= ${b.start} AND x."startedAt" < ${b.end}
    ) e WHERE true ${one} GROUP BY kind, day, who`;
  const offices = new Map((await prisma.ltoOffice.findMany()).map((o) => [o.id, o]));
  return assembleByDay(q.range, LTO_DAY_COLUMNS, events.map((e) => ({ ...e, n: Number(e.n) })), (who) => {
    const o = offices.get(who);
    return o ? (q.officeId ? o.name : o.city || "No area") : null;
  });
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

/** Filter choices: Areas, then Branches as "Name (code)" (the person's scope; hidden branches left out). */
export async function filterOptions(user: CurrentUser) {
  const [rows, types, offices, people] = await Promise.all([
    prisma.branch.findMany({
      where: { hidden: false, ...(user.scopeBranchIds === null ? {} : { id: { in: user.scopeBranchIds } }) }, orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, area: { select: { id: true, name: true } } },
    }),
    prisma.transactionType.findMany({ where: { requiresDp: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    prisma.ltoOffice.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
    processors(),
  ]);
  const branches = rows.map((b) => ({ id: b.id, name: branchLabel(b), areaId: b.area?.id ?? null }));
  const areas = [...new Map(rows.filter((b) => b.area).map((b) => [b.area!.id, { id: b.area!.id, name: b.area!.name }])).values()].sort((a, z) => a.name.localeCompare(z.name));
  return { areas, branches, types, offices, dps: people.map((p) => ({ id: p.id, name: p.name })) };
}

// ---------------------------------------------------------------------------
// Has missing papers (as of now; derived from the paper rows). No alerts and no emails: this list only.
// ---------------------------------------------------------------------------

export interface MissingPaperRow { label: string; txnName: string; reason: string | null; remarks: string | null; days: number; by: string | null }
export interface MissingLoanRow { loanId: string; pn: string; href: string | null; borrower: string; branch: string; stage: string; papers: MissingPaperRow[] }

/** Papers marked Missing on live transactions, in the person's branches and the Area, Branch and type filters. */
function missingWhere(user: CurrentUser, q: Pick<MonitorQuery, "branchId" | "areaId" | "typeCode">): Prisma.ChecklistCheckWhereInput {
  const ids: string[][] = [];
  if (user.scopeBranchIds !== null) ids.push(user.scopeBranchIds);
  if (q.branchId) ids.push([q.branchId]);
  const branchIds = ids.length ? ids.reduce((a, b) => a.filter((x) => b.includes(x))) : null;
  const loan: Prisma.LoanWhereInput = { ...(branchIds ? { branchId: { in: branchIds } } : {}), ...(q.areaId ? { branch: { areaId: q.areaId } } : {}) };
  return { missingState: "MISSING", transaction: { status: { not: "CANCELLED" }, loan, ...(q.typeCode ? { type: { code: q.typeCode } } : {}) } };
}

const calendarDays = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** How many loan files have missing papers (the count beside the filter). */
export async function missingPapersCount(user: CurrentUser, q: MonitorQuery): Promise<number> {
  const rows = await prisma.checklistCheck.findMany({ where: missingWhere(user, q), select: { transaction: { select: { loanId: true } } } });
  return new Set(rows.map((r) => r.transaction.loanId)).size;
}

/** The loan files with missing papers: which papers, and how many days each has been missing (calendar days, PHT). */
export async function missingPapersMonitor(user: CurrentUser, q: MonitorQuery, now: Date = new Date()): Promise<MissingLoanRow[]> {
  const today = businessDate(now);
  const checks = await prisma.checklistCheck.findMany({
    where: missingWhere(user, q),
    orderBy: [{ missingAt: "asc" }],
    include: { rule: true, missingReason: { select: { name: true } }, transaction: { include: { type: { select: { name: true, code: true } }, loan: { include: { branch: { select: { name: true } } } } } } },
    take: 2000,
  });
  const out = new Map<string, MissingLoanRow>();
  for (const c of checks) {
    const l = c.transaction.loan;
    const row = out.get(l.id) ?? { loanId: l.id, pn: l.pn, href: linkable(user, l.branchId) ? `/loans/${l.pn}?tab=todo&tx=${c.transaction.type.code}` : null, borrower: l.borrowerName, branch: l.branch.name, stage: l.stage, papers: [] };
    row.papers.push({
      label: c.rule?.label ?? c.otherLabel ?? "Other paper", txnName: c.transaction.type.name, reason: c.missingReason?.name ?? null,
      remarks: c.missingRemarks, by: c.missingByLabel, days: calendarDays(c.missingAt ? businessDate(c.missingAt) : today, today),
    });
    out.set(l.id, row);
  }
  // The longest missing first.
  const longest = (r: MissingLoanRow) => Math.max(...r.papers.map((p) => p.days));
  return [...out.values()].sort((a, b) => longest(b) - longest(a) || a.pn.localeCompare(b.pn));
}

/** Runs some work and says how long it took (milliseconds). */
export async function measured<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}
