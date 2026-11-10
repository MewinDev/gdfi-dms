import type { JobStage } from "@prisma/client";
import { evidenceSummary, type EvidenceField } from "@/lib/stages/rules";
import "server-only";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { FUNDS_LABEL, peso } from "@/lib/funds/rules";
import { kindText } from "@/lib/funds/kinds";
import { amountWords } from "./funds";
import { txnFunds } from "@/lib/jobs/view";
import { historySentence, progressStep } from "@/lib/ui/plain";
import { NO_DETAILS, holdReasonName } from "@/lib/ui/holds";
import { buildJourney, type EventRec, type Journey, type JourneyInput, type StageRec } from "@/lib/workflow/build-journey";
import { buildJourneyStory, type JourneyStory } from "@/lib/workflow/journey-story";
import type { LoanDetail } from "./queries";

/**
 * The Journey for one viewer: reads the stored records once and hands them to buildJourney (pure).
 * Cash amounts never leave the server unless the viewer has "See cash amounts in the Journey"
 * (journey:view_amounts): without it, amounts are removed here (advances carry no cents, and peso
 * amounts are cut from the event sentences), so the page never receives them.
 */
export async function loadJourney(user: CurrentUser, loan: LoanDetail, now: Date = new Date()): Promise<{ journey: Journey; story: JourneyStory; amounts: boolean; holidays: Set<string> }> {
  const amounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  const [tats, holidays, audit, movements, advances] = await Promise.all([
    getTatMap(),
    getHolidaySet(),
    prisma.auditLog.findMany({ where: { loanId: loan.id }, orderBy: { at: "asc" }, take: 2000 }),
    // Rows written in one database transaction can share a timestamp: the id (cuid) keeps their order.
    prisma.documentMovement.findMany({ where: { documentItem: { loanId: loan.id } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.cashAdvance.findMany({
      where: { lines: { some: { transaction: { loanId: loan.id } } } },
      select: { id: true, number: true, status: true, createdAt: true, approvedAt: true, releasedAt: true, requestedCents: true, releasedCents: true, lines: { select: { transactionId: true, kind: true, otherDescription: true, amountSource: true, presetCents: true, locked: true, requestedCents: true, kindRef: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const input = journeyInput(loan, { audit, movements, advances }, amounts);
  const journey = buildJourney(input, tats, holidays, now);
  // Story, By document and "Where it is now" read the same records (read only).
  return { journey, story: buildJourneyStory(input, journey), amounts, holidays };
}

/** Peso amounts in a sentence ("₱1,500.00", "PHP 1,500.00", "1500.00 for ..."), removed for viewers without the permission. */
export function stripAmounts(text: string): string {
  return text
    .replace(/(?:₱|PHP\s?)\s?-?[\d,]+(?:\.\d+)?/g, "")
    .replace(/\bkeep\s+[\d,]+(?:\.\d{2})\b/g, "keep the balance")
    .replace(/:\s+(for|to|on)\b/g, " $1")
    .replace(/\s+([:,.;)])/g, "$1")
    .replace(/:\s*\./g, ".")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Audit = Awaited<ReturnType<typeof prisma.auditLog.findMany>>[number];
type Movement = Awaited<ReturnType<typeof prisma.documentMovement.findMany>>[number];
type AdvanceLine = { transactionId: string | null; kind?: string; otherDescription?: string; amountSource?: string; presetCents?: number | null; locked?: boolean; requestedCents?: number; kindRef?: { name: string } };
type Advance = { id: string; number: string; status: string; createdAt: Date; approvedAt: Date | null; releasedAt: Date | null; requestedCents: number; releasedCents: number; lines: AdvanceLine[] };

/** Plain sentence for an audit row (the old History text, plus holds and problems). */
export function eventText(r: Audit): string {
  const who = r.actorLabel.replace(/ \(Simulated\)$/, "");
  const s = r.summary.replace(/^Simulated: /, "");
  switch (r.action) {
    // "Put on hold · reason · remarks · by" and "Resumed · remarks · by" (the time is shown beside every event).
    case "hold_started": {
      const note = String((r.details as { note?: unknown } | null)?.note ?? "").trim();
      return `Put on hold · ${s.replace(/^.+? put on hold: /, "")} · ${note || NO_DETAILS} · by ${who}`;
    }
    case "hold_ended": return who === "System" ? "The hold ended when the work was finished." : `Resumed · ${/\): (.+)$/.exec(s)?.[1] ?? NO_DETAILS} · by ${who}`;
    case "hold_transferred": return s.replace(/^.+?: /, "");
    case "hold_details_added": return `${who} added the hold details: ${String((r.details as { note?: unknown } | null)?.note ?? "")}`;
    case "problem_raised": return `${who} raised a problem: ${s.replace(/^Problem on .+?: /, "")}.`;
    case "problem_resolved": return `${who} resolved the problem.`;
    case "problem_outside_control": return `${who} ${s.includes("no longer") ? "removed the tag" : "tagged the problem"} “Outside our control”.`;
    case "attempt_logged": return `${who}: ${s}.`;
    case "job_passed_pasuyo": return `${who} passed the work to a second processor (Pasuyo).`;
    case "lto_office_changed": return `${s}.`;
    case "assigned_to_dp": {
      const lto = (r.after as { ltoOffice?: string | null } | null)?.ltoOffice;
      const m = /Assigned (.+?) to DP/.exec(s);
      return `${historySentence(r)}${lto ? ` ${who} chose ${lto} for ${m?.[1] ?? "it"}.` : ""}`;
    }
    case "sent_job_updated": {
      if ((r.details as { change?: string } | null)?.change === "lto") return `${s}.`;
      const changes = ((r.details as { changes?: string[] } | null)?.changes ?? []).map((c) => c.charAt(0).toLowerCase() + c.slice(1));
      return `${who} ${changes.length ? changes.join(", ") : "changed it"} before the processor accepted.`;
    }
    case "sent_job_pulled_back": return `${who} pulled it back before the processor accepted. ${s.replace(/^.*before they accepted: /, "Reason: ")}.`;
    case "job_returned_to_la": return `${s}.`;
    case "checklist_saved": return historySentence(r);
    default: return historySentence(r);
  }
}

export function journeyInput(loan: LoanDetail, rows: { audit: Audit[]; movements: Movement[]; advances: Advance[] }, amounts: boolean): JourneyInput {
  const txnOfAssignment = new Map(loan.transactions.flatMap((t) => t.dpAssignments.map((a) => [a.id, t.id] as const)));
  const txnOfProblem = new Map(loan.transactions.flatMap((t) => t.problems.map((p) => [p.id, t.id] as const)));
  const txnOfHold = new Map(loan.transactions.flatMap((t) => t.holds.map((h) => [h.id, t.id] as const)));
  const txnOfException = new Map(loan.exceptions.map((e) => [e.id, e.transactionId] as const));
  const txnIds = new Set(loan.transactions.map((t) => t.id));
  const txnOf = (r: Audit): string | null => {
    if (!r.entityId) return null;
    switch (r.entityType) {
      case "LoanTransaction": return txnIds.has(r.entityId) ? r.entityId : null;
      case "DpAssignment": return txnOfAssignment.get(r.entityId) ?? null;
      case "Problem": return txnOfProblem.get(r.entityId) ?? null;
      case "Hold": return txnOfHold.get(r.entityId) ?? null;
      case "LoanException": return txnOfException.get(r.entityId) ?? null;
      default: return null;
    }
  };

  // Which phase the loan was in when each event happened (replaying the stage changes).
  let stage = "Opened";
  const events: EventRec[] = rows.audit.map((r) => {
    if (r.action === "stage_changed") stage = String((r.after as { stage?: string } | null)?.stage ?? stage);
    const text = eventText(r);
    return {
      id: r.id, at: r.at, action: r.action, by: r.actorLabel, simulated: r.mode === "SIMULATED", journeyStep: r.journeyStep,
      text: amounts ? text : stripAmounts(text), txnId: txnOf(r), phase: Math.min(10, progressStep(stage)),
    };
  });

  const cents = (n: number) => (amounts ? n : null);
  const advRec = (a: Advance) => ({
    id: a.id, number: a.number, status: a.status, requestedAt: a.createdAt, approvedAt: a.approvedAt, releasedAt: a.releasedAt,
    requestedCents: cents(a.requestedCents), releasedCents: a.releasedAt ? cents(a.releasedCents) : null,
    // "Other: Courier ₱300.00 (typed; preset was ₱250.00)": the kind and where the amount came from (amounts only with the tick).
    linesText: a.lines.filter((l) => l.kind).map((l) => {
      const amt = amounts && l.requestedCents != null ? ` ${peso(l.requestedCents)}` : "";
      const src = amountWords(l.amountSource ?? "TYPED", amounts ? l.presetCents ?? null : null, !!l.locked, l.requestedCents ?? 0);
      return `${kindText(l.kind!, l.kindRef?.name, l.otherDescription)}${amt} (${src})`;
    }).join("; "),
  });

  return {
    loan: {
      pn: loan.pn, stage: loan.stage, stageSince: loan.stageSince, classification: loan.classification, mortgageResult: loan.mortgageResult,
      overridden: loan.overridden, openedAt: loan.openedAt, openedBy: { id: loan.openedById, name: loan.openedBy.name }, branchName: loan.branch.name,
      openSourceChange: loan.exceptions.some((e) => e.type === "SOURCE_CHANGE" && e.status === "OPEN"),
      transmittalDispatched: loan.transmittalItems.some((i) => i.transmittal.dispatchedAt),
      transmittalReceived: loan.transmittalItems.some((i) => i.transmittal.receivedAt),
    },
    transactions: loan.transactions.map((t) => {
      const sends = t.dpAssignments.map((a) => a.endorsedAt).sort((a, b) => a.getTime() - b.getTime());
      const completes = rows.audit.filter((r) => r.action === "checklist_saved" && r.journeyStep === "3.1" && r.entityId === t.id && (!sends[0] || r.at <= sends[0]));
      const readyAt = t.status === "FOR_CHECKLIST" && !sends.length ? null : completes.at(-1)?.at ?? null;
      return {
        id: t.id, code: t.type.code, name: t.type.name, requiresDp: t.type.requiresDp, ownerRole: t.type.ownerRole, status: t.status, statusSince: t.statusSince,
        createdAt: t.createdAt, completedAt: t.completedAt, cancelledAt: t.cancelledAt, readyAt, fundsNeeded: t.fundsNeeded,
        ltoOffice: t.dpAssignments.find((a) => a.ltoOffice)?.ltoOffice?.name ?? null,
        fundsStatus: FUNDS_LABEL[txnFunds(t)],
        assignments: t.dpAssignments.map((a) => ({
          id: a.id, status: a.status, endorsedAt: a.endorsedAt, decidedAt: a.decidedAt, returnedAt: a.returnedAt,
          processedAt: processedAtOf(a.processing), forwardedAt: a.forwardedAt, closedAt: a.closedAt,
          dp: { id: a.dpUserId, name: a.dpUser.name }, second: a.secondaryDpUserId && a.secondaryDpUser ? { id: a.secondaryDpUserId, name: a.secondaryDpUser.name } : null,
          receivingLa: a.receivingLaId && a.receivingLa ? { id: a.receivingLaId, name: a.receivingLa.name } : null,
          assignedBy: { id: a.assignedById, name: a.assignedBy.name },
          stages: a.stages.map((st) => stageRec(st)),
          // The DP's findings as recorded (the same text the rounds and the "Do this now" card show).
          findings: a.status === "DECLINED" ? a.declineReasons : a.status === "WITHDRAWN" && a.returnedAt ? a.returnReasons : null,
          papersHandedAt: a.papersHandedAt, papersReceivedAt: a.papersReceivedAt, papersReceivedBy: a.papersReceivedBy,
        })),
        attempts: t.attempts.map((x) => ({
          id: x.id, date: x.date, result: x.result, reason: x.reason?.name ?? null, note: x.note, by: x.dpUser.name, createdAt: x.createdAt, simulated: x.simulated, stageId: x.jobStageId,
        })),
        problems: t.problems.map((p) => ({
          id: p.id, reason: p.reason.name, note: p.note, raisedAt: p.raisedAt, raisedBy: p.raisedByLabel, resolvedAt: p.resolvedAt, resolvedBy: p.resolvedByLabel,
          resolutionNote: p.resolutionNote, outsideControl: p.outsideControl, simulated: p.simulated, stageId: p.jobStageId,
        })),
        holds: t.holds.map((h) => ({
          id: h.id, reason: holdReasonName(h), note: h.note, raisedAt: h.raisedAt, raisedBy: h.raisedByLabel,
          resumedAt: h.resumedAt, resumedBy: h.resumedByLabel, resumeNote: h.resumeNote, simulated: h.simulated, stageId: h.jobStageId,
          transfers: h.transfers.map((x) => ({ fromLabel: x.fromLabel, toLabel: x.toLabel, byLabel: x.byLabel, note: x.note, at: x.at })),
        })),
        advances: rows.advances.filter((a) => a.lines.some((l) => l.transactionId === t.id)).map(advRec),
      };
    }),
    documents: loan.documents.map((d) => ({
      id: d.id, documentId: d.documentId, label: d.label, originality: d.originality, txnId: d.transactionId, stage: d.stage,
      custodianLabel: d.custodianLabel, location: d.location, since: d.since,
      movements: rows.movements.filter((m) => m.documentItemId === d.id).map((m) => ({
        id: m.id, action: m.action, at: m.createdAt, from: m.fromCustodian, to: m.toCustodian, location: m.location, by: m.actorLabel,
        acknowledgedAt: m.acknowledgedAt, remarks: m.remarks, simulated: m.simulated,
      })),
    })),
    advances: rows.advances.map(advRec),
    events,
  };
}

function processedAtOf(processing: unknown): Date | null {
  const v = (processing as { processedAt?: string } | null)?.processedAt;
  return v ? new Date(v) : null;
}

/** A job stage for the Journey: who, when and a summary of the evidence (file names only, never the file). */
function stageRec(st: JobStage): StageRec {
  const ev = (st.evidence ?? {}) as Record<string, unknown>;
  const summary = st.kind === "VERIFY"
    ? [`${Object.keys((ev.papers ?? {}) as object).length} paper(s) received back and complete`, typeof ev.note === "string" && ev.note ? ev.note : ""].filter(Boolean).join(" · ")
    : evidenceSummary((st.fields as unknown as EvidenceField[]) ?? [], ev);
  return {
    id: st.id, name: st.name, status: st.status, startedAt: st.startedAt, finishedAt: st.finishedAt,
    by: st.finishedByLabel ?? st.startedByLabel, summary: st.migrated && st.kind === "VERIFY" ? String(ev.note ?? "") : summary, migrated: st.migrated,
  };
}
