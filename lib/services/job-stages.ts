import "server-only";
import type { JobStage, Prisma, ProcessingStage } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { businessDate } from "@/lib/time";
import {
  DEFAULT_OWN_STAGES, DEFAULT_SYSTEM_STAGES, checkEvidence, currentIndex, evidenceSummary, planStages,
  type EvidenceField, type StageKind,
} from "@/lib/stages/rules";
import { MAX_RECEIPT_BYTES, receiptStore, sniffReceipt } from "@/lib/storage/receipts";
import { noteDocs } from "./custody";
import { UserError } from "./errors";
import { LTO_BLOCK_MESSAGE, ltoBlocked, notifyProblem, type AssignmentFull, type Who } from "./jobs";

/**
 * Job stages. Each DP job runs its type's processing stages in order (Settings > Processing stages):
 * Start and Finish are system times, evidence is checked on the server, Check and verify ticks every
 * paper. A job's stages are copied from Settings at its first piece of work (a stage started, an
 * attempt, a hold or a problem); until then they follow Settings, so switching "Needs LTO processing"
 * adds or removes the LTO stages for jobs not yet started, and jobs already in a stage keep theirs.
 */

type Db = Tx | typeof prisma;
export type StageRow = Pick<JobStage, "code" | "name" | "kind" | "sortOrder" | "targetDays" | "status" | "startedAt" | "startedByLabel" | "finishedAt" | "finishedByLabel" | "migrated"> & {
  id: string | null;
  fields: EvidenceField[];
  evidence: Record<string, unknown> | null;
};

const asFields = (v: Prisma.JsonValue): EvidenceField[] => (Array.isArray(v) ? (v as unknown as EvidenceField[]) : []);
const asEvidence = (v: Prisma.JsonValue | null): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Makes sure a type that needs a processor has its system stages (and the proposed own stages on first use). */
export async function ensureTypeStages(db: Db, type: { id: string; code: string; requiresDp: boolean }) {
  if (!type.requiresDp) return;
  const have = await db.processingStage.findMany({ where: { typeId: type.id }, select: { code: true, kind: true } });
  const missing = [
    ...(have.some((h) => h.kind === "OWN") ? [] : DEFAULT_OWN_STAGES[type.code] ?? []),
    ...DEFAULT_SYSTEM_STAGES.filter((d) => !have.some((h) => h.kind === d.kind)),
  ].filter((d) => !have.some((h) => h.code === d.code));
  for (const d of missing) {
    await db.processingStage.create({ data: { typeId: type.id, code: d.code, name: d.name, kind: d.kind, sortOrder: d.sortOrder, fields: d.fields as unknown as Prisma.InputJsonValue } });
  }
}

/** The type's stages as a job would run them now (from Settings). */
export async function settingsPlan(db: Db, type: { id: string; code: string; requiresDp: boolean; needsLto: boolean }): Promise<ProcessingStage[]> {
  if (!type.requiresDp) return [];
  await ensureTypeStages(db, type);
  const rows = await db.processingStage.findMany({ where: { typeId: type.id } });
  return planStages(rows.map((r) => ({ ...r, kind: r.kind as StageKind })), type.needsLto);
}

const fromSetting = (s: ProcessingStage): StageRow => ({
  id: null, code: s.code, name: s.name, kind: s.kind, sortOrder: s.sortOrder, targetDays: s.targetDays, status: "LATER",
  startedAt: null, startedByLabel: null, finishedAt: null, finishedByLabel: null, migrated: false, fields: asFields(s.fields), evidence: null,
});
const fromJob = (j: JobStage): StageRow => ({ ...j, fields: asFields(j.fields), evidence: asEvidence(j.evidence) });

type JobRef = { id: string; transaction: { type: { id: string; code: string; requiresDp: boolean; needsLto: boolean } } };

/** The job's stages: its own copy once work began, otherwise the plan from Settings. */
export async function stageRows(db: Db, a: JobRef): Promise<StageRow[]> {
  const own = await db.jobStage.findMany({ where: { assignmentId: a.id }, orderBy: { sortOrder: "asc" } });
  if (own.length) return own.map(fromJob);
  return (await settingsPlan(db, a.transaction.type)).map(fromSetting);
}

/** Copies the plan onto the job (once). Returns the job's stage rows, in order. */
export async function materialize(tx: Tx, a: JobRef & { status: string }, simulated = false): Promise<JobStage[]> {
  const own = await tx.jobStage.findMany({ where: { assignmentId: a.id }, orderBy: { sortOrder: "asc" } });
  if (own.length || a.status !== "ACCEPTED") return own;
  const plan = await settingsPlan(tx, a.transaction.type);
  for (const s of plan) {
    await tx.jobStage.create({
      data: { assignmentId: a.id, stageId: s.id, code: s.code, name: s.name, kind: s.kind, sortOrder: s.sortOrder, fields: s.fields as Prisma.InputJsonValue, targetDays: s.targetDays, simulated },
    });
  }
  return tx.jobStage.findMany({ where: { assignmentId: a.id }, orderBy: { sortOrder: "asc" } });
}

/** The stage that is current on a transaction's open, accepted job (attempts, holds and problems attach to it). */
export async function currentStageIdFor(tx: Tx, transactionId: string): Promise<string | null> {
  const a = await tx.dpAssignment.findFirst({
    where: { transactionId, status: "ACCEPTED", transaction: { status: "IN_PROCESS" } },
    orderBy: { createdAt: "desc" },
    include: { transaction: { include: { type: true } } },
  });
  if (!a || a.processing) return null;
  const rows = await materialize(tx, a);
  const i = currentIndex(rows);
  return i >= 0 ? rows[i].id : null;
}

/**
 * Papers checked in Check and verify: every paper of the transaction that was confirmed present and went
 * to the processor. Not a paper marked Missing (expected again), nor one received late that is still at
 * the branch: the processor never had it, and it is not a reason to stop the file.
 */
export const verifiablePapers = <D extends { documentId: string | null; stage?: string }>(docs: D[]) => docs.filter((d) => !!d.documentId && d.stage !== "EXPECTED" && d.stage !== "AT_BRANCH");

const JOURNEY_STEP: Record<string, string> = { NOTARY: "4.2", PPSR: "4.3", MORTGAGE: "4.4" };
const stepOf = (a: AssignmentFull) => JOURNEY_STEP[a.transaction.type.code] ?? "4.4";
const auditStage = (tx: Tx, who: Who, a: AssignmentFull, action: string, summary: string, details?: unknown) =>
  writeAudit(tx, {
    actor: who.actor, mode: who.mode, action, entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn, journeyStep: stepOf(a),
    summary: who.mode === "SIMULATED" ? `Simulated: ${summary}` : summary, ...(details ? { details } : {}),
  });

function requireWorking(a: AssignmentFull) {
  if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Accept the job first.");
  if (a.processing) throw new UserError("The job is already complete.");
}

/** The current stage (stages run in order), checked against the one the person pressed. */
async function current(tx: Tx, a: AssignmentFull, stageId: string, simulated: boolean) {
  requireWorking(a);
  const rows = await materialize(tx, a, simulated);
  const i = currentIndex(rows);
  if (i < 0) throw new UserError("Every stage is done. Complete the job.");
  const row = rows.find((r) => r.id === stageId || r.code === stageId);
  if (!row) throw new UserError("Stage not found.");
  if (row.id !== rows[i].id) throw new UserError(row.status === "DONE" ? `${row.name} is already done.` : `Stages run in order. Finish ${rows[i].name} first.`);
  return row;
}

export async function startStageCore(tx: Tx, a: AssignmentFull, who: Who, stageId: string, now: Date = new Date()) {
  const row = await current(tx, a, stageId, who.mode === "SIMULATED");
  if (row.status === "STARTED") throw new UserError(`${row.name} is already started.`);
  if (row.kind === "LTO_DROP" && (await ltoBlocked(tx, a))) throw new UserError(LTO_BLOCK_MESSAGE);
  await tx.jobStage.update({ where: { id: row.id }, data: { status: "STARTED", startedAt: now, startedById: who.userId, startedByLabel: who.actor.label } });
  await auditStage(tx, who, a, "stage_started", `${row.name} started on ${a.transaction.type.name} by ${who.actor.label}`, { stage: row.code });
  return row;
}

/** A file for a "file" evidence field: checked like a receipt (PNG, JPG, PDF or WEBP, at most 5 MB). */
export async function storeEvidenceFile(file: File): Promise<{ key: string; name: string; mime: string }> {
  if (file.size > MAX_RECEIPT_BYTES) throw new UserError("The file is larger than 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffReceipt(bytes);
  if (!kind) throw new UserError("Attach a PNG, JPG, PDF or WEBP file.");
  return { key: await receiptStore.put(bytes, kind.ext), name: file.name.slice(0, 120) || `file.${kind.ext}`, mime: kind.mime };
}

export async function finishStageCore(tx: Tx, a: AssignmentFull, who: Who, stageId: string, raw: Record<string, unknown>, now: Date = new Date()) {
  const row = await current(tx, a, stageId, who.mode === "SIMULATED");
  if (row.status !== "STARTED") throw new UserError(`Press Start on ${row.name} first.`);
  const sim = who.mode === "SIMULATED";
  const withDp = a.transaction.documents.filter((d) => d.stage === "WITH_DP");
  let evidence: Record<string, unknown>;
  let summary: string;

  if (row.kind === "VERIFY") {
    const papers = verifiablePapers(a.transaction.documents);
    const ticked = (asEvidence(row.evidence)?.papers ?? {}) as Record<string, unknown>;
    const left = papers.filter((p) => !ticked[p.id]);
    if (left.length) throw new UserError(`Tick every paper as received back and complete first (${left.length} left).`);
    const open = a.transaction.problems.find((p) => !p.resolvedAt);
    if (open) throw new UserError("A problem is open on this job. Resolve it when the paper is found, then verify again.");
    const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 500) : "";
    evidence = { papers: ticked, note, verifiedBy: who.actor.label };
    summary = `${papers.length} paper${papers.length === 1 ? "" : "s"} received back and complete${note ? ` · ${note}` : ""}`;
    await noteDocs(tx, papers, { action: "VERIFIED_BY_DP", remarks: "Verified by DP: received back and complete", by: who.actor, simulated: sim });
  } else {
    const fields = asFields(row.fields);
    const checked = checkEvidence(fields, raw, businessDate(now));
    if (!checked.ok) throw new UserError(checked.error, checked.field);
    evidence = checked.values;
    summary = evidenceSummary(fields, evidence);
    const office = String(evidence.office ?? a.ltoOffice?.name ?? "the LTO");
    if (row.kind === "LTO_DROP") await noteDocs(tx, withDp, { action: "AT_LTO", location: office, remarks: `Dropped at ${office}${evidence.droppedAt ? ` on ${evidence.droppedAt}` : ""}`, by: who.actor, simulated: sim });
    if (row.kind === "LTO_PICKUP") {
      const drop = await tx.jobStage.findFirst({ where: { assignmentId: a.id, kind: "LTO_DROP" } });
      const at = String(asEvidence(drop?.evidence ?? null)?.office ?? a.ltoOffice?.name ?? "the LTO");
      await noteDocs(tx, withDp, { action: "RETURNED_FROM_LTO", location: `With DP ${a.dpUser.name}`, remarks: `Picked up from ${at}${evidence.pickedUpAt ? ` on ${evidence.pickedUpAt}` : ""}${evidence.annotatedOrCr ? " (annotated OR/CR)" : ""}`, by: who.actor, simulated: sim });
    }
  }
  await tx.jobStage.update({ where: { id: row.id }, data: { status: "DONE", finishedAt: now, finishedById: who.userId, finishedByLabel: who.actor.label, evidence: evidence as Prisma.InputJsonValue } });
  await auditStage(tx, who, a, "stage_finished", `${row.name} finished on ${a.transaction.type.name} by ${who.actor.label}${summary ? `: ${summary}` : ""}`, { stage: row.code, evidence: redactFiles(asFields(row.fields), evidence) });
  return row;
}

/** Audit details without file keys (the file name only). */
function redactFiles(fields: EvidenceField[], ev: Record<string, unknown>) {
  const out = { ...ev };
  for (const f of fields) if (f.type === "file" && out[f.key] && typeof out[f.key] === "object") out[f.key] = { name: (out[f.key] as { name?: string }).name };
  return out;
}

/** Check and verify: one paper received back and complete ("Returned to DP" custody movement). */
export async function verifyPaperCore(tx: Tx, a: AssignmentFull, who: Who, stageId: string, documentItemId: string, now: Date = new Date()) {
  const row = await current(tx, a, stageId, who.mode === "SIMULATED");
  if (row.kind !== "VERIFY") throw new UserError("Papers are ticked in Check and verify.");
  if (row.status !== "STARTED") throw new UserError(`Press Start on ${row.name} first.`);
  const paper = verifiablePapers(a.transaction.documents).find((d) => d.id === documentItemId);
  if (!paper) throw new UserError("That paper is not part of this transaction.");
  const ev = asEvidence(row.evidence) ?? {};
  const papers = { ...((ev.papers ?? {}) as Record<string, unknown>) };
  if (papers[paper.id]) return row;
  papers[paper.id] = { at: now.toISOString(), by: who.actor.label };
  await tx.jobStage.update({ where: { id: row.id }, data: { evidence: { ...ev, papers } as Prisma.InputJsonValue } });
  await noteDocs(tx, [paper], { action: "RETURNED_TO_DP", remarks: "Received back and complete", by: who.actor, simulated: who.mode === "SIMULATED" });
  await auditStage(tx, who, a, "paper_verified", `${paper.label} received back and complete (${a.transaction.type.name})`, { documentItemId: paper.id });
  return row;
}

/** Check and verify: a paper is not back. Opens a Problem "Missing paper" on this stage, naming the papers. */
export async function somethingMissingCore(tx: Tx, a: AssignmentFull, who: Who, stageId: string, documentItemIds: string[], note: string) {
  const row = await current(tx, a, stageId, who.mode === "SIMULATED");
  if (row.kind !== "VERIFY" || row.status !== "STARTED") throw new UserError("Start Check and verify first.");
  const papers = verifiablePapers(a.transaction.documents).filter((d) => documentItemIds.includes(d.id));
  if (!papers.length) throw new UserError("Pick the papers that are missing.", "papers");
  if (a.transaction.problems.some((p) => !p.resolvedAt)) throw new UserError("A problem is already open on this job. Resolve it first.");
  const reason = (await tx.problemReason.findFirst({ where: { code: "MISSING_PAPER", active: true } })) ?? (await tx.problemReason.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } }));
  if (!reason) throw new UserError("No active problem reason. Ask Admin to add one in Settings.");
  const names = papers.map((p) => p.label).join(", ");
  const text = `Missing: ${names}${note.trim() ? `. ${note.trim()}` : ""}`.slice(0, 500);
  const p = await tx.problem.create({ data: { loanId: a.loanId, transactionId: a.transactionId, reasonId: reason.id, note: text, raisedById: who.userId, raisedByLabel: who.actor.label, jobStageId: row.id, simulated: who.mode === "SIMULATED" } });
  await auditStage(tx, who, a, "problem_raised", `Check and verify on ${a.transaction.type.name}: ${text}`, { problemId: p.id, papers: papers.map((x) => x.id) });
  await notifyProblem(tx, a, `${reason.name} (${names})`, "opened");
  return p;
}

/** Complete job: every active stage must be Done. Returns the stage evidence as the old completion record. */
export async function stagesForCompletion(tx: Tx, a: AssignmentFull): Promise<Record<string, unknown> | null> {
  const rows = await materialize(tx, a);
  if (!rows.length) return null; // no stages at all (every stage made inactive): the old Complete form applies
  const next = rows.find((r) => r.status !== "DONE");
  if (next) throw new UserError(`Finish every stage first. Next: ${next.name}.`);
  const ev = (code: string) => asEvidence(rows.find((r) => r.code === code)?.evidence ?? null);
  const kind = (k: string) => asEvidence(rows.find((r) => r.kind === k)?.evidence ?? null);
  const drop = kind("LTO_DROP");
  const pick = kind("LTO_PICKUP");
  const own = rows.filter((r) => r.kind === "OWN").map((r) => ({ stage: r.name, ...(asEvidence(r.evidence) ?? {}) }));
  return {
    ...(ev("NOTARIZATION") ? { notary: ev("NOTARIZATION") } : {}),
    ...(ev("PPSR-REG") ? { ppsr: ev("PPSR-REG") } : {}),
    ...(drop || pick ? { lto: { ...(drop ?? {}), ...(pick ?? {}) } } : {}),
    ...(own.length ? { stages: own } : {}),
  };
}

/** Forward needs Check and verify Done (when the job has it; Admin may have made it inactive in Settings). */
export async function requireVerified(tx: Tx, a: { id: string }) {
  const v = await tx.jobStage.findFirst({ where: { assignmentId: a.id, kind: "VERIFY" } });
  if (v && v.status !== "DONE") throw new UserError("Finish Check and verify before forwarding.");
}
