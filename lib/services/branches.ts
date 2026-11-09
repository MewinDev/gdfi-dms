import "server-only";
import { prisma, type Tx, type Prisma } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { parseBranchFile, BRANCH_FILE_MAX_BYTES, type MyLoansBranchRow } from "@/lib/branches/file";
import { branchRowHash, diffBranches, REVIEW_KIND_LABEL, type BranchDiff, type DiffItem, type DmsState, type GroupRef, type ReviewKind } from "@/lib/branches/diff";
import { accessImpact, rebuildAccess, type BranchPlace } from "@/lib/branches/access";
import { getMyLoansAdapter } from "@/lib/myloans";
import type { MyLoansAdapter } from "@/lib/myloans/types";
import { OPEN_STAGES } from "./settings-status";
import { UserError } from "./errors";

/**
 * Branches from MyLoans (MyLoans is the source of truth for code, name, area, division and status).
 *
 *  - Import from MyLoans (a file): preview (New, Changed, Unchanged, Not in this file, counts per
 *    Division and Area, hide suggestions, access impact) -> Admin confirms -> the listed changes are
 *    applied and recorded as accepted review items; anything left unticked and every "Not in this file"
 *    becomes an open item in the Branch review.
 *  - Branches from MyLoans (the API, the daily run, an unknown code in a PN): differences go to the
 *    Branch review as open items; nothing is applied until Admin accepts.
 *  - Nothing is ever deleted. A run that fails changes nothing.
 * The DMS never connects to the MyLoans database: only listBranches() (the API) or a file.
 */

const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type Db = Tx | typeof prisma;

export function canManageBranchSource(u: CurrentUser) { return can(u, PERMISSIONS.SOURCE_MANAGE); }
function assertManage(u: CurrentUser) {
  if (!canManageBranchSource(u)) throw new UserError("Only Admin can import branches from MyLoans or decide the Branch review (Manage MyLoans source).");
}

export async function loadDmsState(db: Db = prisma): Promise<DmsState> {
  const [divisions, areas, branches] = await Promise.all([
    db.division.findMany({ select: { id: true, myloansId: true, name: true } }),
    db.area.findMany({ select: { id: true, myloansId: true, name: true } }),
    db.branch.findMany({ select: { id: true, myloansBranchId: true, code: true, name: true, address: true, active: true, hidden: true, source: true, divisionId: true, areaId: true } }),
  ]);
  return { divisions, areas, branches };
}

/** A short fingerprint of a diff, so Confirm applies exactly what the preview showed. */
function fingerprint(d: BranchDiff): string {
  const s = JSON.stringify([d.items.map((i) => [i.status, i.row.code, i.branchId, i.fields.map((f) => f.now)]), d.missing.map((m) => m.id)]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export interface ImpactLine { name: string; gained: number; lost: number }

/** The access impact of applying these items (users who gain or lose branches), nothing saved. */
async function impactOf(items: DiffItem[], extra: BranchPlace[] = []): Promise<ImpactLine[]> {
  const groupId = (g: GroupRef) => g.dmsId ?? `new:${g.key}`;
  const patch: BranchPlace[] = [
    ...items.filter((i) => i.status === "new" || i.kinds.includes("MOVED")).map((i) => ({ id: i.branchId ?? `new:${i.row.code}`, divisionId: groupId(i.division), areaId: groupId(i.area) })),
    ...extra,
  ];
  return (await accessImpact(prisma, patch)).map((x) => ({ name: x.name, gained: x.gained.length, lost: x.lost.length }));
}

export interface ImportPreview {
  ok: true;
  fileName: string;
  shape: "dump" | "header";
  problems: { line: number; message: string }[];
  diff: BranchDiff;
  fingerprint: string;
  impact: ImpactLine[];
  ms: number;
}

async function readFile(input: string | Uint8Array): Promise<{ rows: (MyLoansBranchRow & { line: number })[]; problems: { line: number; message: string }[]; shape: "dump" | "header" }> {
  if ((typeof input === "string" ? input.length : input.byteLength) > BRANCH_FILE_MAX_BYTES) throw new UserError("The file is larger than 5 MB.");
  const f = parseBranchFile(input);
  if (!f.rows.length) throw new UserError(f.problems[0]?.message ?? "No branch rows were found in the file.");
  return f;
}

/** Import from MyLoans, step 1: the preview. Nothing is saved. */
export async function previewBranchFile(user: CurrentUser, input: string | Uint8Array, fileName: string): Promise<ImportPreview> {
  assertManage(user);
  const t0 = Date.now();
  const f = await readFile(input);
  const diff = diffBranches(f.rows, await loadDmsState(), { full: true });
  return { ok: true, fileName, shape: f.shape, problems: f.problems, diff, fingerprint: fingerprint(diff), impact: await impactOf(diff.items.filter((i) => i.status !== "unchanged")), ms: Date.now() - t0 };
}

export interface ConfirmChoices {
  /** Codes of new or changed rows to leave in the Branch review instead of applying now. */
  leave?: string[];
  /** Codes of new test-looking rows Admin switched on (imported Active). */
  activate?: string[];
  /** Codes of rows Admin chose to hide from the DMS. */
  hide?: string[];
}

export interface ApplyResult { applied: number; left: number; missing: number; unchanged: number; problems: string[]; runId: string; ms: number; accessChanged: number }

/** Import from MyLoans, step 2: Confirm. Applies the previewed changes in one transaction. */
export async function confirmBranchFile(user: CurrentUser | null, input: string | Uint8Array, fileName: string, expected: string | null, choices: ConfirmChoices = {}, o: { trigger?: string } = {}): Promise<ApplyResult> {
  if (user) assertManage(user);
  const t0 = Date.now();
  const f = await readFile(input);
  const diff = diffBranches(f.rows, await loadDmsState(), { full: true });
  if (expected && fingerprint(diff) !== expected) throw new UserError("The branches changed since the preview. Check the file again.");
  const actor = user ? actorOf(user) : SYSTEM_ACTOR;
  const leave = new Set(choices.leave ?? []);
  const toApply = diff.items.filter((i) => i.status !== "unchanged" && !leave.has(i.row.code));
  const toLeave = diff.items.filter((i) => i.status !== "unchanged" && leave.has(i.row.code));
  return recordRun({ trigger: o.trigger ?? "file", mode: "FILE", fileName, actor }, diff, t0, async (tx, runId) => {
    const r = await applyItems(tx, toApply, { actor, runId, source: "file", activate: new Set(choices.activate ?? []), hide: new Set(choices.hide ?? []), accepted: true });
    await queueItems(tx, toLeave, diff, runId, o.trigger === "seed" ? "seed" : "file");
    await touchUnchanged(tx, diff);
    return { applied: r.applied, problems: r.problems, left: toLeave.length + r.problems.length };
  });
}

/** The same import for the seed and the kit (no user; everything accepted, test-looking rows inactive). */
export async function importBranchRowsAsSystem(rows: MyLoansBranchRow[], fileName = "built-in subset") {
  const csvLike = rows.map((r, i) => ({ ...r, line: i + 1 }));
  const t0 = Date.now();
  const diff = diffBranches(csvLike, await loadDmsState(), { full: false });
  const items = diff.items.filter((i) => i.status !== "unchanged");
  return recordRun({ trigger: "seed", mode: "FILE", fileName, actor: SYSTEM_ACTOR }, diff, t0, async (tx, runId) => {
    const r = await applyItems(tx, items, { actor: SYSTEM_ACTOR, runId, source: "file", activate: new Set(), hide: new Set(), accepted: true });
    await touchUnchanged(tx, diff);
    return { applied: r.applied, problems: r.problems, left: r.problems.length };
  });
}

/** Records the run (a failed run changes nothing and says why). */
async function recordRun(
  meta: { trigger: string; mode: string; fileName?: string; actor: Actor },
  diff: BranchDiff,
  t0: number,
  work: (tx: Tx, runId: string) => Promise<{ applied: number; problems: string[]; left: number }>,
): Promise<ApplyResult> {
  const run = await prisma.branchSyncRun.create({ data: { trigger: meta.trigger, mode: meta.mode, ok: false, fileName: meta.fileName ?? null, byLabel: meta.actor.label } });
  try {
    const out = await prisma.$transaction(async (tx) => {
      const r = await work(tx, run.id);
      if (diff.missing.length) await queueMissing(tx, diff, run.id, meta.trigger === "file" ? "file" : meta.trigger);
      const accessChanged = (await rebuildAccess(tx, "groups")).length;
      await writeAudit(tx, {
        actor: meta.actor, mode: meta.actor.id ? "MANUAL" : "AUTOMATIC", action: "branches_imported", entityType: "Branch", entityId: run.id,
        summary: `Branches from MyLoans (${meta.fileName ?? meta.trigger}): ${r.applied} applied, ${r.left} left for review, ${diff.counts.unchanged} unchanged, ${diff.counts.missing} not in the list`,
        details: { counts: diff.counts, perGroup: diff.perGroup, problems: r.problems },
      });
      return { ...r, accessChanged };
    }, { timeout: 120_000, maxWait: 15_000 });
    const ms = Date.now() - t0;
    await prisma.branchSyncRun.update({ where: { id: run.id }, data: { ok: true, newCount: diff.counts.new, changedCount: diff.counts.changed, unchangedCount: diff.counts.unchanged, missingCount: diff.counts.missing, errorCount: out.problems.length, ms } });
    return { applied: out.applied, left: out.left, missing: diff.counts.missing, unchanged: diff.counts.unchanged, problems: out.problems, runId: run.id, ms, accessChanged: out.accessChanged };
  } catch (e) {
    await prisma.branchSyncRun.update({ where: { id: run.id }, data: { ok: false, error: e instanceof UserError ? e.message : "The import stopped; nothing was changed.", ms: Date.now() - t0 } });
    throw e;
  }
}

/** lastSeenAt for the branches the list still has. */
async function touchUnchanged(tx: Tx, diff: BranchDiff) {
  const ids = diff.items.filter((i) => i.branchId).map((i) => i.branchId!);
  if (ids.length) await tx.branch.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: new Date() } });
}

// ---------------------------------------------------------------------------------------------------
// Applying (Accept)
// ---------------------------------------------------------------------------------------------------

async function ensureGroup(tx: Tx, level: "area" | "division", g: GroupRef, cache: Map<string, string>, actor: Actor): Promise<string> {
  const hit = cache.get(g.key);
  if (hit) return hit;
  const del = level === "area" ? tx.area : tx.division;
  let id: string;
  if (g.dmsId) {
    const cur = await (del as typeof tx.area).findUniqueOrThrow({ where: { id: g.dmsId } });
    const data: { name?: string; myloansId?: number; source?: "MYLOANS"; lastSyncedAt: Date } = { lastSyncedAt: new Date() };
    if (g.kind === "renamed" && cur.name !== g.name) data.name = g.name;
    if (g.myloansId !== null && cur.myloansId === null) data.myloansId = g.myloansId;
    if (g.myloansId !== null) data.source = "MYLOANS";
    await (del as typeof tx.area).update({ where: { id: g.dmsId }, data });
    if (data.name) {
      await writeAudit(tx, { actor, mode: actor.id ? "MANUAL" : "AUTOMATIC", action: `${level}_renamed`, entityType: level === "area" ? "Area" : "Division", entityId: g.dmsId, summary: `${level === "area" ? "Area" : "Division"} renamed from ${cur.name} to ${g.name} (MyLoans)`, before: { name: cur.name }, after: { name: g.name } });
    }
    id = g.dmsId;
  } else {
    const made = await (del as typeof tx.area).create({ data: { myloansId: g.myloansId, name: g.name, source: g.myloansId !== null ? "MYLOANS" : "DMS", lastSyncedAt: new Date() } });
    await writeAudit(tx, { actor, mode: actor.id ? "MANUAL" : "AUTOMATIC", action: `${level}_created`, entityType: level === "area" ? "Area" : "Division", entityId: made.id, summary: `${level === "area" ? "Area" : "Division"} ${g.name} added (MyLoans)` });
    id = made.id;
  }
  cache.set(g.key, id);
  return id;
}

interface ApplyOpts { actor: Actor; runId: string | null; source: string; activate: Set<string>; hide: Set<string>; accepted: boolean }

/** Applies diff items (in an order that frees codes first). Items that would clash are reported, not applied. */
async function applyItems(tx: Tx, items: DiffItem[], o: ApplyOpts): Promise<{ applied: number; problems: string[] }> {
  const problems: string[] = [];
  const cache = new Map<string, string>();
  const now = new Date();
  // Codes and names after the changes: refuse an item that would take a code or name another branch keeps.
  const all = await tx.branch.findMany({ select: { id: true, code: true, name: true } });
  const finalCode = new Map(all.map((b) => [b.id, b.code]));
  const finalName = new Map(all.map((b) => [b.id, b.name]));
  for (const i of items) if (i.branchId) { finalCode.set(i.branchId, i.row.code); finalName.set(i.branchId, i.row.name); }
  const clash = (i: DiffItem) => {
    for (const [id, c] of finalCode) if (id !== i.branchId && c === i.row.code) return `code ${i.row.code} is still used by ${all.find((b) => b.id === id)?.name ?? "another branch"}`;
    for (const [id, n] of finalName) if (id !== i.branchId && n.toLowerCase() === i.row.name.toLowerCase()) return `the name ${i.row.name} is used by another branch`;
    return null;
  };
  const ordered = [...items.filter((i) => i.status === "changed"), ...items.filter((i) => i.status === "new")];
  let applied = 0;
  const reviews: { kind: ReviewKind; branchId: string | null; code: string; title: string; payload: Prisma.InputJsonValue; myloansBranchId: number | null; myloansAreaId: number | null; myloansDivisionId: number | null }[] = [];
  for (const i of ordered) {
    const why = clash(i);
    if (why) { problems.push(`${i.row.name} (${i.row.code}): ${why}. Left in the Branch review.`); await queueItems(tx, [i], null, o.runId, o.source, why); continue; }
    if (i.status === "new") { finalCode.set(`new:${i.row.code}`, i.row.code); finalName.set(`new:${i.row.code}`, i.row.name); }
    const divisionId = await ensureGroup(tx, "division", i.division, cache, o.actor);
    const areaId = await ensureGroup(tx, "area", i.area, cache, o.actor);
    const base = {
      code: i.row.code, name: i.row.name, source: "MYLOANS" as const, divisionId, areaId, myloansBranchId: i.row.branchId,
      lastSeenAt: now, lastSyncedAt: now, syncHash: branchRowHash(i.row), myloansUpdatedAt: i.row.updatedAt ? new Date(i.row.updatedAt) : null,
      ...(i.row.address ? { address: i.row.address } : {}),
    };
    let branchId = i.branchId;
    if (i.status === "new") {
      const active = i.importActive || o.activate.has(i.row.code);
      const hide = o.hide.has(i.row.code);
      const made = await tx.branch.create({
        data: { ...base, active, ...(active ? {} : { deactivatedAt: now, deactivatedById: o.actor.id }), note: i.note, ...(hide ? { hidden: true, hiddenAt: now, hiddenById: o.actor.id } : {}) },
      });
      branchId = made.id;
      await writeAudit(tx, { actor: o.actor, mode: o.actor.id ? "MANUAL" : "AUTOMATIC", action: "branch_created", entityType: "Branch", entityId: made.id, summary: `Branch ${i.row.name} (${i.row.code}) added from MyLoans${active ? "" : " as inactive"}${hide ? ", hidden from the DMS" : ""}`, after: base });
    } else {
      const cur = await tx.branch.findUniqueOrThrow({ where: { id: i.branchId! } });
      const activeNow = i.row.active ?? cur.active;
      const data = {
        ...base, active: activeNow,
        ...(activeNow !== cur.active ? (activeNow ? { deactivatedAt: null, deactivatedById: null } : { deactivatedAt: now, deactivatedById: o.actor.id }) : {}),
        ...(o.hide.has(i.row.code) && !cur.hidden ? { hidden: true, hiddenAt: now, hiddenById: o.actor.id } : {}),
      };
      await tx.branch.update({ where: { id: cur.id }, data });
      await writeAudit(tx, {
        actor: o.actor, mode: o.actor.id ? "MANUAL" : "AUTOMATIC", action: "branch_updated_from_myloans", entityType: "Branch", entityId: cur.id,
        summary: `Branch ${cur.name}${cur.code ? ` (${cur.code})` : ""}: ${i.fields.map((f) => `${f.label} ${f.was} -> ${f.now}`).join("; ") || "linked to MyLoans"}`,
        before: { code: cur.code, name: cur.name, address: cur.address, active: cur.active, divisionId: cur.divisionId, areaId: cur.areaId }, after: data,
      });
    }
    applied++;
    reviews.push({ kind: i.kind ?? "DETAILS_CHANGED", branchId, code: i.row.code, title: `${i.row.name} (${i.row.code})`, payload: payloadOf(i), myloansBranchId: i.row.branchId, myloansAreaId: i.row.areaId, myloansDivisionId: i.row.divisionId });
  }
  if (reviews.length && o.accepted) {
    await tx.branchReview.createMany({
      data: reviews.map((r) => ({ ...r, state: "ACCEPTED" as const, source: o.source, runId: o.runId, decidedById: o.actor.id, decidedByLabel: o.actor.label, decidedAt: now, payload: r.payload })),
    });
  }
  return { applied, problems };
}

function payloadOf(i: DiffItem): Prisma.InputJsonValue {
  return asJson(payloadData(i));
}
function payloadData(i: DiffItem) {
  return {
    row: i.row, kinds: i.kinds, fields: i.fields, matchedBy: i.matchedBy, suggestHide: i.suggestHide, note: i.note, importActive: i.importActive,
    division: i.division, area: i.area,
  };
}

/** Puts differences in the Branch review as open items (one open item per branch; a newer run updates it). */
async function queueItems(tx: Tx, items: DiffItem[], _diff: BranchDiff | null, runId: string | null, source: string, note?: string) {
  void _diff;
  for (const i of items) {
    const kind = i.kind ?? "DETAILS_CHANGED";
    const open = await tx.branchReview.findFirst({
      where: { state: "OPEN", kind: { notIn: ["UNKNOWN_CODE", "NEW_AREA", "NEW_DIVISION", "RENAMED_AREA", "RENAMED_DIVISION"] }, OR: [...(i.branchId ? [{ branchId: i.branchId }] : []), ...(i.row.branchId !== null ? [{ myloansBranchId: i.row.branchId }] : []), { branchId: null, code: i.row.code }] },
    });
    const data = { kind, code: i.row.code, title: `${i.row.name} (${i.row.code})`, payload: payloadOf(i), source, runId, detectedAt: new Date(), myloansBranchId: i.row.branchId, myloansAreaId: i.row.areaId, myloansDivisionId: i.row.divisionId, note: note ?? null };
    if (open) await tx.branchReview.update({ where: { id: open.id }, data });
    else await tx.branchReview.create({ data: { ...data, branchId: i.branchId } });
  }
}

async function queueMissing(tx: Tx, diff: BranchDiff, runId: string, source: string) {
  for (const b of diff.missing) {
    const open = await tx.branchReview.findFirst({ where: { state: "OPEN", branchId: b.id, kind: "NOT_IN_LIST" } });
    const data = { kind: "NOT_IN_LIST" as const, code: b.code, title: `${b.name}${b.code ? ` (${b.code})` : ""}`, payload: asJson({ branch: b }), source, runId, detectedAt: new Date(), myloansBranchId: b.myloansBranchId };
    if (open) await tx.branchReview.update({ where: { id: open.id }, data });
    else await tx.branchReview.create({ data: { ...data, branchId: b.id } });
  }
}

// ---------------------------------------------------------------------------------------------------
// The Branch review
// ---------------------------------------------------------------------------------------------------

export interface ReviewRow {
  id: string; kind: ReviewKind; kindLabel: string; state: "OPEN" | "ACCEPTED" | "IGNORED"; title: string; code: string | null; source: string;
  fields: { label: string; was: string; now: string }[]; detectedAt: Date; decidedByLabel: string | null; decidedAt: Date | null; note: string | null;
  pn: string | null; branchId: string | null; suggestHide: boolean; area: string | null; division: string | null;
  /** NEW_BRANCH from a source without ids: the branches "Not in the last list" it could be (Same branch, code changed). */
  linkable: { id: string; name: string; code: string | null }[];
}

export async function reviewRows(state: "OPEN" | "DECIDED" = "OPEN", take = 200): Promise<ReviewRow[]> {
  const rows = await prisma.branchReview.findMany({
    where: state === "OPEN" ? { state: "OPEN" } : { state: { in: ["ACCEPTED", "IGNORED"] } },
    orderBy: state === "OPEN" ? [{ detectedAt: "desc" }] : [{ decidedAt: "desc" }], take,
  });
  const missing = state === "OPEN" ? rows.filter((r) => r.kind === "NOT_IN_LIST" && r.branchId) : [];
  const missingBranches = missing.length ? await prisma.branch.findMany({ where: { id: { in: missing.map((m) => m.branchId!) } }, select: { id: true, name: true, code: true } }) : [];
  const order: ReviewKind[] = ["UNKNOWN_CODE", "NEW_BRANCH", "CODE_CHANGED", "RENAMED", "MOVED", "CLOSED", "REOPENED", "NOT_IN_LIST", "NEW_AREA", "RENAMED_AREA", "NEW_DIVISION", "RENAMED_DIVISION", "DETAILS_CHANGED"];
  const out = rows.map((r) => {
    const p = (r.payload ?? {}) as { fields?: { label: string; was: string; now: string }[]; suggestHide?: boolean; area?: GroupRef; division?: GroupRef; row?: MyLoansBranchRow };
    return {
      id: r.id, kind: r.kind as ReviewKind, kindLabel: REVIEW_KIND_LABEL[r.kind as ReviewKind], state: r.state, title: r.title, code: r.code, source: r.source,
      fields: p.fields ?? [], detectedAt: r.detectedAt, decidedByLabel: r.decidedByLabel, decidedAt: r.decidedAt, note: r.note, pn: r.pn, branchId: r.branchId,
      suggestHide: !!p.suggestHide, area: p.area?.name ?? null, division: p.division?.name ?? null,
      linkable: r.kind === "NEW_BRANCH" && p.row?.branchId === null ? missingBranches : [],
    };
  });
  return state === "OPEN" ? out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title)) : out;
}

export async function openReviewCount(): Promise<number> {
  return prisma.branchReview.count({ where: { state: "OPEN" } });
}

/** What accepting an item would do to access and work, before it applies (the impact preview). */
export async function reviewImpact(id: string): Promise<{ users: ImpactLine[]; activeUsers: number; openLoans: number; text: string }> {
  const r = await prisma.branchReview.findUniqueOrThrow({ where: { id } });
  const p = r.payload as { kinds?: ReviewKind[]; division?: GroupRef; area?: GroupRef; row?: MyLoansBranchRow };
  let users: ImpactLine[] = [];
  if ((r.kind === "NEW_BRANCH" || p.kinds?.includes("MOVED")) && p.area && p.division) {
    users = (await accessImpact(prisma, [{ id: r.branchId ?? `new:${r.code}`, divisionId: p.division.dmsId ?? `new:${p.division.key}`, areaId: p.area.dmsId ?? `new:${p.area.key}` }])).map((x) => ({ name: x.name, gained: x.gained.length, lost: x.lost.length }));
  }
  let activeUsers = 0;
  let openLoans = 0;
  if (r.branchId && (r.kind === "CLOSED" || r.kind === "NOT_IN_LIST" || p.kinds?.includes("CLOSED"))) {
    ({ activeUsers, openLoans } = await branchWorkload(r.branchId));
  }
  const gain = users.filter((u) => u.gained).map((u) => u.name);
  const lose = users.filter((u) => u.lost).map((u) => u.name);
  const text = [
    gain.length ? `${gain.length} ${gain.length === 1 ? "person gains" : "people gain"} access: ${gain.join(", ")}.` : "",
    lose.length ? `${lose.length} ${lose.length === 1 ? "person loses" : "people lose"} access: ${lose.join(", ")}.` : "",
    activeUsers || openLoans ? `It still has ${activeUsers} active user${activeUsers === 1 ? "" : "s"} and ${openLoans} open loan file${openLoans === 1 ? "" : "s"}; they stay, but no new work can start there.` : "",
  ].filter(Boolean).join(" ");
  return { users, activeUsers, openLoans, text: text || "Nobody gains or loses access." };
}

/** Active users who work there (access or home branch; All users not counted) and open loan files. */
export async function branchWorkload(branchId: string): Promise<{ activeUsers: number; openLoans: number }> {
  const [activeUsers, openLoans] = await Promise.all([
    prisma.user.count({ where: { active: true, OR: [{ branches: { some: { branchId } } }, { homeBranchId: branchId }] } }),
    prisma.loan.count({ where: { branchId, stage: { in: OPEN_STAGES } } }),
  ]);
  return { activeUsers, openLoans };
}

/** Accept a review item: applies the change (and its new area or division), audited. */
export async function acceptReview(user: CurrentUser, id: string, o: { hide?: boolean; activate?: boolean } = {}) {
  assertManage(user);
  const actor = actorOf(user);
  await prisma.$transaction(async (tx) => {
    const r = await tx.branchReview.findUnique({ where: { id } });
    if (!r || r.state !== "OPEN") throw new UserError("This item was already decided. Refresh the list.");
    const p = r.payload as unknown as ReturnType<typeof payloadData> & { branch?: { id: string }; branchName?: string | null };
    if (r.kind === "NOT_IN_LIST") {
      const b = await tx.branch.findUniqueOrThrow({ where: { id: r.branchId! } });
      if (b.active) {
        await tx.branch.update({ where: { id: b.id }, data: { active: false, deactivatedAt: new Date(), deactivatedById: user.id } });
        await writeAudit(tx, { actor, mode: "MANUAL", action: "made_inactive", entityType: "branch", entityId: b.id, summary: `Branch ${b.name} switched off: not in the last MyLoans list`, before: { active: true }, after: { active: false } });
      }
    } else if (r.kind === "UNKNOWN_CODE") {
      const code = r.code!;
      if (await tx.branch.findUnique({ where: { code } })) throw new UserError(`A branch with code ${code} exists now. Ignore this item.`);
      const name = (p.branchName ?? "").trim() || `Branch ${code}`;
      if (await tx.branch.findUnique({ where: { name } })) throw new UserError(`A branch called ${name} exists without this code. Give it code ${code} in Settings, Branches, then ignore this item.`);
      const made = await tx.branch.create({ data: { code, name, source: "DMS", note: `Added from the Branch review: code seen in ${r.pn ?? "a PN"}` } });
      await writeAudit(tx, { actor, mode: "MANUAL", action: "branch_created", entityType: "Branch", entityId: made.id, summary: `Branch ${name} (${code}) added: unknown code seen in ${r.pn ?? "a PN"}` });
      await tx.branchReview.update({ where: { id }, data: { branchId: made.id } });
    } else {
      const fresh = diffBranches([p.row], await loadDmsState(tx), { full: false }).items[0];
      if (fresh.status === "unchanged") {
        // Already the same in the DMS: nothing to apply.
      } else {
        const res = await applyItems(tx, [fresh], { actor, runId: r.runId, source: r.source, activate: new Set(o.activate ? [fresh.row.code] : []), hide: new Set(o.hide ? [fresh.row.code] : []), accepted: false });
        if (res.problems.length) throw new UserError(res.problems[0]);
      }
    }
    await tx.branchReview.update({ where: { id }, data: { state: "ACCEPTED", decidedById: user.id, decidedByLabel: user.name, decidedAt: new Date() } });
    const changed = await rebuildAccess(tx, "groups");
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "branch_review_accepted", entityType: "BranchReview", entityId: id,
      summary: `Branch review accepted: ${REVIEW_KIND_LABEL[r.kind as ReviewKind]}, ${r.title}${changed.length ? `; access changed for ${changed.length} user${changed.length === 1 ? "" : "s"}` : ""}`,
      details: { access: changed },
    });
  }, { timeout: 60_000 });
}

export async function ignoreReview(user: CurrentUser, id: string, note: string) {
  assertManage(user);
  await prisma.$transaction(async (tx) => {
    const r = await tx.branchReview.findUnique({ where: { id } });
    if (!r || r.state !== "OPEN") throw new UserError("This item was already decided. Refresh the list.");
    await tx.branchReview.update({ where: { id }, data: { state: "IGNORED", decidedById: user.id, decidedByLabel: user.name, decidedAt: new Date(), note: note.trim() || null } });
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "branch_review_ignored", entityType: "BranchReview", entityId: id, summary: `Branch review ignored: ${REVIEW_KIND_LABEL[r.kind as ReviewKind]}, ${r.title}${note.trim() ? ` (${note.trim()})` : ""}` });
  });
}

/**
 * "Same branch, code changed" (only for sources without a MyLoans branch id): a NEW_BRANCH item and a
 * branch "Not in the last list" are the same branch. The old branch gets the new code and name, keeping
 * its id (so its loans, users and history stay); both items close.
 */
export async function linkSameBranch(user: CurrentUser, newItemId: string, oldBranchId: string) {
  assertManage(user);
  await prisma.$transaction(async (tx) => {
    const r = await tx.branchReview.findUnique({ where: { id: newItemId } });
    if (!r || r.state !== "OPEN" || r.kind !== "NEW_BRANCH") throw new UserError("Pick an open New branch item.");
    const p = r.payload as unknown as ReturnType<typeof payloadData>;
    if (p.row.branchId !== null) throw new UserError("MyLoans gives this branch a stable id: a changed code shows as Code changed, no link needed.");
    const old = await tx.branch.findUnique({ where: { id: oldBranchId } });
    const missing = await tx.branchReview.findFirst({ where: { state: "OPEN", kind: "NOT_IN_LIST", branchId: oldBranchId } });
    if (!old || !missing) throw new UserError("Pick a branch that is Not in the last list.");
    const item = diffBranches([p.row], { ...(await loadDmsState(tx)), branches: [{ ...old, source: "MYLOANS", code: p.row.code, myloansBranchId: null }] }, { full: false }).items[0];
    const res = await applyItems(tx, [{ ...item, status: "changed", branchId: old.id }], { actor: actorOf(user), runId: r.runId, source: r.source, activate: new Set(), hide: new Set(), accepted: false });
    if (res.problems.length) throw new UserError(res.problems[0]);
    const now = new Date();
    for (const x of [r.id, missing.id]) await tx.branchReview.update({ where: { id: x }, data: { state: "ACCEPTED", decidedById: user.id, decidedByLabel: user.name, decidedAt: now, branchId: old.id, note: `Same branch, code changed: ${old.code ?? "(none)"} -> ${p.row.code}` } });
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "branch_code_linked", entityType: "Branch", entityId: old.id, summary: `Same branch, code changed: ${old.name} ${old.code ?? "(none)"} -> ${p.row.name} ${p.row.code}`, before: { code: old.code, name: old.name }, after: { code: p.row.code, name: p.row.name } });
    await rebuildAccess(tx, "groups");
  });
}

// ---------------------------------------------------------------------------------------------------
// Hide from DMS, and the DMS-only fields
// ---------------------------------------------------------------------------------------------------

export async function setBranchHidden(user: CurrentUser, id: string, hidden: boolean) {
  assertManage(user);
  await prisma.$transaction(async (tx) => {
    const b = await tx.branch.findUnique({ where: { id } });
    if (!b) throw new UserError("Branch not found.");
    if (b.hidden === hidden) return;
    if (hidden) {
      const homes = await tx.user.count({ where: { active: true, homeBranchId: id } });
      if (homes) throw new UserError(`${b.name} is the home branch of ${homes} active user${homes === 1 ? "" : "s"}. Give them another home branch first.`);
    }
    await tx.branch.update({ where: { id }, data: hidden ? { hidden: true, hiddenAt: new Date(), hiddenById: user.id } : { hidden: false, hiddenAt: null, hiddenById: null } });
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: hidden ? "branch_hidden" : "branch_shown", entityType: "Branch", entityId: id, summary: `Branch ${b.name}${b.code ? ` (${b.code})` : ""} ${hidden ? "hidden from the DMS" : "shown in the DMS again"}`, before: { hidden: b.hidden }, after: { hidden } });
  });
}

// ---------------------------------------------------------------------------------------------------
// Branches from MyLoans through the API (listBranches), the daily run, an unknown code in a PN
// ---------------------------------------------------------------------------------------------------

const LOCK_KEY = 7_120_002; // pg advisory lock: one branch sync at a time
const LOOKUP_EVERY_MS = 60 * 60_000;

export interface BranchRunResult { ok: boolean; mode: "FULL" | "INCREMENTAL"; queued: number; unchanged: number; missing: number; message: string; runId: string | null }

/**
 * Reads the branch list through the MyLoans adapter and puts every difference in the Branch review.
 * Incremental (updated since the last successful run) when the API supports it, a full read otherwise,
 * and a full read once a week (to find branches that disappeared). Paging supported. Changes no branch.
 */
export async function runBranchSync(o: { trigger: "api" | "cron" | "lookup"; user?: CurrentUser; mode?: "auto" | "full"; adapter?: MyLoansAdapter; now?: Date }): Promise<BranchRunResult | null> {
  if (o.user) assertManage(o.user);
  const adapter = o.adapter ?? getMyLoansAdapter();
  const now = o.now ?? new Date();
  return prisma.$transaction(async (lockTx) => {
    const got = await lockTx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
    if (!got[0]?.ok) return null;
    const s = await getSetting("branches.sync");
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const canSince = !!adapter.capabilities.branchesUpdatedSince;
    const full = o.mode === "full" || !canSince || !s.lastSuccessAt || !s.lastFullAt || new Date(s.lastFullAt).getTime() <= weekAgo;
    const t0 = Date.now();
    const actor = o.user ? actorOf(o.user) : SYSTEM_ACTOR;
    const rows: MyLoansBranchRow[] = [];
    let page: number | null = 1;
    let failure: string | null = null;
    while (page !== null) {
      if (!adapter.listBranches) { failure = "MyLoans has no branch list yet. Use Import from MyLoans (a file)."; break; }
      const r = await adapter.listBranches({ updatedSince: full ? null : new Date(s.lastSuccessAt!), page, pageSize: 500 });
      if (!r.ok) { failure = r.message; break; }
      rows.push(...r.branches);
      page = r.nextPage;
      if (rows.length > 20_000) { failure = "MyLoans returned more than 20,000 branches; stopped."; break; }
    }
    const mode = full ? "FULL" : "INCREMENTAL";
    if (failure) {
      const run = await prisma.branchSyncRun.create({ data: { trigger: o.trigger, mode, ok: false, error: failure, ms: Date.now() - t0, byLabel: actor.label } });
      return { ok: false, mode, queued: 0, unchanged: 0, missing: 0, message: `Branches from MyLoans did not run: ${failure} Nothing was changed.`, runId: run.id };
    }
    const diff = diffBranches(rows.map((r, i) => ({ ...r, line: i + 1 })), await loadDmsState(), { full });
    const items = diff.items.filter((i) => i.status !== "unchanged");
    const run = await prisma.branchSyncRun.create({ data: { trigger: o.trigger, mode, ok: true, newCount: diff.counts.new, changedCount: diff.counts.changed, unchangedCount: diff.counts.unchanged, missingCount: diff.counts.missing, ms: 0, byLabel: actor.label } });
    await prisma.$transaction(async (tx) => {
      await queueItems(tx, items, diff, run.id, o.trigger);
      if (diff.missing.length) await queueMissing(tx, diff, run.id, o.trigger);
      // An open item whose branch is now the same as MyLoans again: closed by the system (nothing to do).
      const same = diff.items.filter((i) => i.status === "unchanged" && i.branchId).map((i) => i.branchId!);
      if (same.length) await tx.branchReview.updateMany({ where: { state: "OPEN", branchId: { in: same }, kind: { notIn: ["NOT_IN_LIST", "UNKNOWN_CODE"] } }, data: { state: "IGNORED", decidedByLabel: "System", decidedAt: now, note: "No longer different in the last MyLoans list." } });
      await touchUnchanged(tx, diff);
    }, { timeout: 60_000 });
    await prisma.branchSyncRun.update({ where: { id: run.id }, data: { ms: Date.now() - t0 } });
    await setSetting("branches.sync", { ...s, lastSuccessAt: now.toISOString(), ...(full ? { lastFullAt: now.toISOString() } : {}) });
    return { ok: true, mode, queued: items.length + diff.missing.length, unchanged: diff.counts.unchanged, missing: diff.counts.missing, message: `${items.length + diff.missing.length} difference${items.length + diff.missing.length === 1 ? "" : "s"} for the Branch review; ${diff.counts.unchanged} unchanged.`, runId: run.id };
  }, { timeout: 5 * 60_000, maxWait: 10_000 });
}

/** The daily run: once a day from the set time (PHT), unless paused. Called by the cron endpoint. */
export async function runScheduledBranchSync(now: Date = new Date()): Promise<BranchRunResult | { skipped: string }> {
  const s = await getSetting("branches.sync");
  if (s.paused) return { skipped: "paused" };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = `${v("year")}-${v("month")}-${v("day")}`;
  const hm = `${v("hour")}:${v("minute")}`;
  if (s.lastRunDate === day) return { skipped: "already ran today" };
  if (hm < s.time) return { skipped: `waits for ${s.time} PHT` };
  if (!getMyLoansAdapter().capabilities.branches) return { skipped: "MyLoans has no branch list yet (use Import from MyLoans)" };
  await setSetting("branches.sync", { ...s, lastRunDate: day });
  return (await runBranchSync({ trigger: "cron", now })) ?? { skipped: "another run is going" };
}

/**
 * A loan came through MyLoans with a branch code that no DMS branch has (in its PN or its branch field).
 * The lookup is never blocked: an "Unknown branch code seen in a PN" item goes to the Branch review, and
 * at most once an hour one small refresh of the branch list runs, so a brand-new branch shows up soon.
 */
export async function reportUnknownBranchCode(code: string, pn: string, branchName: string | null) {
  if (!/^\d{3}$/.test(code)) return;
  if (await prisma.branch.findUnique({ where: { code }, select: { id: true } })) return;
  const open = await prisma.branchReview.findFirst({ where: { state: "OPEN", kind: "UNKNOWN_CODE", code } });
  if (open) await prisma.branchReview.update({ where: { id: open.id }, data: { detectedAt: new Date(), pn, payload: { ...(open.payload as object), branchName, pns: [...new Set([...(((open.payload as { pns?: string[] }).pns) ?? []), pn])].slice(-10) } } });
  else await prisma.branchReview.create({ data: { kind: "UNKNOWN_CODE", code, title: `Code ${code}${branchName ? ` (${branchName})` : ""}`, pn, source: "lookup", payload: { branchName, pns: [pn] } } });
  const s = await getSetting("branches.sync");
  const last = s.lastLookupAt ? new Date(s.lastLookupAt).getTime() : 0;
  if (Date.now() - last < LOOKUP_EVERY_MS || !getMyLoansAdapter().capabilities.branches) return;
  await setSetting("branches.sync", { ...s, lastLookupAt: new Date().toISOString() });
  void runBranchSync({ trigger: "lookup" }).catch(() => null);
}

/** The last runs, for the history on Settings, Branches. */
export async function recentBranchRuns(take = 10) {
  return prisma.branchSyncRun.findMany({ orderBy: { at: "desc" }, take });
}

// ---------------------------------------------------------------------------------------------------
// A MyLoans loan -> a DMS branch
// ---------------------------------------------------------------------------------------------------

export interface BranchHit { id: string; code: string | null; name: string; active: boolean; hidden: boolean }

/** The DMS branch of a MyLoans loan: by the branch code first, by the name only when there is no code match. */
export async function resolveLoanBranch(db: Db, rec: { branchCode: string | null; branchName: string | null }): Promise<BranchHit | null> {
  const select = { id: true, code: true, name: true, active: true, hidden: true } as const;
  const code = rec.branchCode?.trim();
  if (code) {
    const b = await db.branch.findUnique({ where: { code }, select });
    if (b) return b;
  }
  const name = rec.branchName?.trim();
  if (!name) return null;
  return db.branch.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select });
}

/** "Antipolo (101)"; "Antipolo (code needed)". */
export const branchLabel = (b: { name: string; code: string | null }) => `${b.name} (${b.code ?? "code needed"})`;
