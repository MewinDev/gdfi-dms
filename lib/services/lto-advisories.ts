import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { MONITOR_ROLE_KEY, PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/lib/time";
import { stageRows } from "./job-stages";
import { UserError } from "./errors";
import {
  ADVISORY_LABEL, advisoryTypeSchema, advisoryWarning, fileAdvisorySchema, isStale, mayEditAdvisory, mayResolveAdvisory, parseStartedAt, resolveAdvisorySchema,
  STALE_PROMPT, type AdvisoryType,
} from "@/lib/monitoring/advisories";
import { remarksSchema } from "@/lib/ui/holds";

/**
 * LTO advisories: a processor reports a problem at an LTO office (from a job at an LTO stage), or
 * Operations files one from the Monitoring page (ltoreports:manage). It stays Active until resolved
 * with remarks; who and when are recorded for both steps. Advisories only warn: nothing is blocked,
 * and they are not part of any loan's Journey. The Operations Monitors are told (in-app, and by email
 * when the switch is on); processors are not.
 */

const firstIssue = (e: z.ZodError) => { const i = e.issues[0]; return new UserError(i.message, String(i.path[0] ?? "")); };

/** The Operations Monitors (the people told about advisories). Processors are never told. */
async function monitorIds(tx: Tx): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { active: true, role: { active: true, key: MONITOR_ROLE_KEY, NOT: { permissions: { has: PERMISSIONS.DP_RECEIVE } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function tell(tx: Tx, a: { id: string; type: AdvisoryType; remarks: string; officeName: string }, status: "filed" | "resolved", who: string, note: string) {
  const ids = await monitorIds(tx);
  if (!ids.length) return;
  await notify(tx, {
    userIds: ids, title: `LTO advisory ${status}: ${a.officeName}`, body: `${ADVISORY_LABEL[a.type]}, ${status} by ${who}. ${note}`, link: "/monitoring?tab=lto",
    email: { event: "lto_advisory", vars: { office: a.officeName, kind: ADVISORY_LABEL[a.type], status, who, reason: note } },
  });
}

export interface FileAdvisoryInput {
  type: unknown;
  remarks: unknown;
  /** "YYYY-MM-DDTHH:mm" in PHT, blank for now. */
  startedAt?: string | null;
  /** From a DP job at an LTO stage (the job's office is used). */
  assignmentId?: string | null;
  /** From the Monitoring page (ltoreports:manage). */
  ltoOfficeId?: string | null;
}

/** Files an advisory. From a job: the processor's own job at an LTO stage. From Monitoring: ltoreports:manage. */
export async function fileAdvisory(u: CurrentUser, input: FileAdvisoryInput, now: Date = new Date()) {
  const p = fileAdvisorySchema.safeParse({ type: input.type, remarks: input.remarks });
  if (!p.success) throw firstIssue(p.error);
  const start = parseStartedAt(input.startedAt, now);
  if (!start.ok) throw new UserError(start.error, "startedAt");
  let officeId: string;
  let assignmentId: string | null = null;
  if (input.assignmentId) {
    if (!can(u, PERMISSIONS.LTO_REPORTS_CREATE) && !can(u, PERMISSIONS.LTO_REPORTS_MANAGE)) throw new UserError("Your role does not allow filing LTO advisories.");
    const a = await prisma.dpAssignment.findUnique({ where: { id: input.assignmentId }, include: { transaction: { include: { type: true } } } });
    if (!a) throw new UserError("Job not found.");
    if (a.dpUserId !== u.id && a.secondaryDpUserId !== u.id) throw new UserError("This job is assigned to someone else.");
    if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Report an LTO problem while you work on the job.");
    if (!a.ltoOfficeId) throw new UserError("This job has no LTO office yet.");
    const cur = (await stageRows(prisma, a)).find((r) => r.status !== "DONE");
    if (!cur || (cur.kind !== "LTO_DROP" && cur.kind !== "LTO_PICKUP")) throw new UserError("Report an LTO problem when the job is at an LTO stage (LTO drop off or LTO pickup).");
    officeId = a.ltoOfficeId;
    assignmentId = a.id;
  } else {
    if (!can(u, PERMISSIONS.LTO_REPORTS_MANAGE)) throw new UserError("Your role does not allow filing LTO advisories here.");
    if (!input.ltoOfficeId) throw new UserError("Pick the LTO office.", "ltoOfficeId");
    const o = await prisma.ltoOffice.findFirst({ where: { id: input.ltoOfficeId, active: true } });
    if (!o) throw new UserError("Pick an active LTO office.", "ltoOfficeId");
    officeId = o.id;
  }
  return prisma.$transaction(async (tx) => {
    const office = await tx.ltoOffice.findUniqueOrThrow({ where: { id: officeId } });
    const row = await tx.ltoAdvisory.create({
      data: { ltoOfficeId: office.id, type: p.data.type, remarks: p.data.remarks, startedAt: start.at, filedById: u.id, filedByLabel: u.name, assignmentId, createdAt: now },
    });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "lto_advisory_filed", entityType: "LtoAdvisory", entityId: row.id,
      summary: `${u.name} reported ${ADVISORY_LABEL[p.data.type]} at ${office.name} (since ${fmtDateTime(start.at)}): ${p.data.remarks}`,
      after: { type: p.data.type, remarks: p.data.remarks, startedAt: start.at.toISOString(), office: office.name },
    });
    await tell(tx, { ...row, officeName: office.name }, "filed", u.name, p.data.remarks);
    return row;
  });
}

async function loadActive(id: string) {
  const a = await prisma.ltoAdvisory.findUnique({ where: { id }, include: { ltoOffice: true } });
  if (!a) throw new UserError("Advisory not found.");
  if (a.resolvedAt) throw new UserError("This advisory is already resolved.");
  return a;
}

/** Resolves an advisory (remarks 5 to 500): the person who filed it, or ltoreports:manage. */
export async function resolveAdvisory(u: CurrentUser, id: string, raw: { remarks: unknown }, now: Date = new Date()) {
  const p = resolveAdvisorySchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const a = await loadActive(id);
  if (!mayResolveAdvisory(a, u)) throw new UserError("Only the person who filed it, or someone who manages LTO advisories, can resolve it.");
  return prisma.$transaction(async (tx) => {
    const done = await tx.ltoAdvisory.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: now, resolvedById: u.id, resolvedByLabel: u.name, resolveRemarks: p.data.remarks } });
    if (done.count !== 1) throw new UserError("This advisory is already resolved.");
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "lto_advisory_resolved", entityType: "LtoAdvisory", entityId: id,
      summary: `${u.name} resolved ${ADVISORY_LABEL[a.type]} at ${a.ltoOffice.name}: ${p.data.remarks}`, details: { remarks: p.data.remarks },
    });
    await tell(tx, { ...a, officeName: a.ltoOffice.name }, "resolved", u.name, p.data.remarks);
  });
}

/** Changes the type or the remarks of an active advisory (ltoreports:manage, or the filer). */
export async function editAdvisory(u: CurrentUser, id: string, raw: { type: unknown; remarks: unknown }, now: Date = new Date()) {
  const p = z.object({ type: advisoryTypeSchema, remarks: remarksSchema }).safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const a = await loadActive(id);
  if (!mayEditAdvisory(a, u)) throw new UserError("Only the person who filed it, or someone who manages LTO advisories, can change it.");
  if (a.type === p.data.type && a.remarks === p.data.remarks) throw new UserError("Nothing changed.");
  await prisma.$transaction(async (tx) => {
    await tx.ltoAdvisory.update({ where: { id }, data: { type: p.data.type, remarks: p.data.remarks, editedAt: now, editedByLabel: u.name } });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "lto_advisory_edited", entityType: "LtoAdvisory", entityId: id,
      summary: `${u.name} changed the advisory at ${a.ltoOffice.name}`, before: { type: a.type, remarks: a.remarks }, after: p.data,
    });
  });
}

export interface AdvisoryView {
  id: string;
  officeId: string;
  officeName: string;
  type: AdvisoryType;
  typeLabel: string;
  remarks: string;
  filedBy: string;
  startedAt: string; // ISO
  startedText: string;
  warning: string;
  active: boolean;
  resolvedBy: string | null;
  resolvedText: string | null;
  resolveRemarks: string;
  /** "Still active? Please confirm" for people who can resolve it (older than 24 hours), else null. */
  prompt: string | null;
  mayResolve: boolean;
  mayEdit: boolean;
}

type Row = Prisma.LtoAdvisoryGetPayload<{ include: { ltoOffice: true } }>;
export function advisoryView(a: Row, u: CurrentUser | null, now: Date = new Date()): AdvisoryView {
  const facts = { officeName: a.ltoOffice.name, type: a.type, filedByLabel: a.filedByLabel, filedById: a.filedById, startedAt: a.startedAt, resolvedAt: a.resolvedAt };
  const mayResolve = !!u && mayResolveAdvisory(facts, u);
  return {
    id: a.id, officeId: a.ltoOfficeId, officeName: a.ltoOffice.name, type: a.type, typeLabel: ADVISORY_LABEL[a.type], remarks: a.remarks, filedBy: a.filedByLabel,
    startedAt: a.startedAt.toISOString(), startedText: fmtDateTime(a.startedAt), warning: advisoryWarning(facts, now), active: !a.resolvedAt,
    resolvedBy: a.resolvedByLabel, resolvedText: a.resolvedAt ? fmtDateTime(a.resolvedAt) : null, resolveRemarks: a.resolveRemarks,
    prompt: mayResolve && isStale(facts, now) ? STALE_PROMPT : null, mayResolve, mayEdit: !!u && mayEditAdvisory(facts, u),
  };
}

/** Active advisories, newest first (optionally for some offices). */
export async function activeAdvisories(u: CurrentUser | null, officeIds?: string[], now: Date = new Date()): Promise<AdvisoryView[]> {
  const rows = await prisma.ltoAdvisory.findMany({
    where: { resolvedAt: null, ...(officeIds ? { ltoOfficeId: { in: officeIds } } : {}) },
    include: { ltoOffice: true }, orderBy: { startedAt: "desc" },
  });
  return rows.map((r) => advisoryView(r, u, now));
}

/** Warnings by office id (for the LTO office choice): the warning lines of its active advisories. */
export async function advisoryWarnings(now: Date = new Date()): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const a of await activeAdvisories(null, undefined, now)) (out[a.officeId] ??= []).push(a.warning);
  return out;
}
