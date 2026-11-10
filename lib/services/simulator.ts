import { appEnv, refuseInProduction } from "@/lib/env";
import { isTestMode } from "@/lib/test-mode";
import { runSimulated } from "@/lib/email/context";
import "server-only";
import { prisma, withLoanLock } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getSetting } from "@/lib/settings";
import { recomputeStage } from "./stage";
import { UserError } from "./errors";
import { evaluateChecklist, refuseMissingPapers } from "./workflow";
import { moveDocs } from "./custody";
import { acceptCore, completeCore, declineCore, forwardCore, loadAssignment, receiveCore, receiverWhere, type Who } from "./jobs";
import { finishStageCore, materialize, startStageCore, verifiablePapers, verifyPaperCore } from "./job-stages";
import type { EvidenceField } from "@/lib/stages/rules";
import { nextNumber, refreshAdvance } from "./funds";
import { decimalToCents, liquidationDue, peso } from "@/lib/funds/rules";
import { businessDate } from "@/lib/time";

/**
 * Admin-only test simulator. Pushes work through other roles' steps (Finance, DP, receiving LA,
 * Vault). It calls the same functions as the real DP and LA screens; every event is labelled "Simulated".
 */

export type SimAction =
  | "FUNDS_REQUEST" | "CA_RELEASE" | "CA_REJECT" | "CA_LIQUIDATE" | "CA_CLOSE"
  | "DP_ACCEPT" | "DP_DECLINE" | "DP_PROCESS" | "DP_FORWARD"
  | "LA_ACCEPT_COMPLETE" | "LA_ACCEPT_INCOMPLETE"
  | "TRANSMIT" | "VAULT_RECEIVE";

/** Simulator steps that move a transaction into or through the DP stage. */
const DP_STEPS: SimAction[] = ["DP_ACCEPT", "DP_PROCESS", "DP_FORWARD"];

/**
 * The simulator calls the step functions directly (it bypasses the hold lock and the role checks), so
 * it runs only with TEST_MODE on and never on staging or production.
 */
export function assertSimulatorAllowed() {
  const env = appEnv();
  if (env === "staging" || env === "production") throw new UserError(`The test simulator is not available on ${env}.`);
  if (!isTestMode()) throw new UserError("The test simulator runs only in test mode (TEST_MODE=true).");
}

async function guard(user: CurrentUser) {
  refuseInProduction("The test simulator");
  assertSimulatorAllowed();
  if (!can(user, PERMISSIONS.SIMULATOR_USE)) throw new UserError("Your role does not allow using the test simulator.");
  if (!(await getSetting("simulator.enabled"))) throw new UserError("Turn on the test simulator in Settings first.");
}

const sim = (label: string): Actor => ({ id: null, label: `${label} (Simulated)` });

/** Emails from simulated steps follow the test-mode rule: never to a real person (lib/email/context.ts). */
export function simulate(user: CurrentUser, input: { loanId: string; action: SimAction; targetId?: string }) {
  return runSimulated(() => simulateInner(user, input));
}

async function simulateInner(user: CurrentUser, input: { loanId: string; action: SimAction; targetId?: string }) {
  await guard(user);
  const loan = await prisma.loan.findUnique({ where: { id: input.loanId }, include: { branch: true } });
  if (!loan) throw new UserError("Loan File not found.");
  const base = { loanId: loan.id, pn: loan.pn };

  // Same rule as the LA: a transaction cannot move to a DP step until every required paper is ticked.
  if (DP_STEPS.includes(input.action) && input.targetId) {
    const a = await prisma.dpAssignment.findFirst({
      where: { id: input.targetId, loanId: loan.id },
      include: { transaction: { include: { type: true, checks: { include: { rule: true } } } } },
    });
    if (a) {
      const status = evaluateChecklist(a.transaction.checks);
      if (!status.complete) {
        await refuseMissingPapers({ id: user.id, label: `${user.name} (Simulated)` }, { ...a.transaction, loan: { pn: loan.pn } }, status.missing, "SIMULATED");
      }
    }
  }
  const now = new Date();

  await withLoanLock(loan.id, async (tx) => {
    const audit = (actor: Actor, action: string, entityType: string, entityId: string, journeyStep: string | null, summary: string, extra: Partial<{ before: unknown; after: unknown; details: unknown }> = {}) =>
      writeAudit(tx, { actor, mode: "SIMULATED", action, entityType, entityId, journeyStep, summary: `Simulated: ${summary}`, ...base, ...extra, details: { simulatedBy: user.name, ...(extra.details as object | undefined) } });

    const getCa = async () => {
      const ca = await tx.cashAdvance.findFirst({ where: { id: input.targetId, lines: { some: { transaction: { loanId: loan.id } } } }, include: { lines: { include: { receipts: true, spends: true, returns: true } }, requestedBy: true } });
      if (!ca) throw new UserError("Cash advance not found.");
      return ca;
    };
    const getAssignment = () => loadAssignment(tx, input.targetId ?? "");
    const as = (label: string, id: string | null = null): Who => ({ actor: { id, label: `${label} (Simulated)` }, userId: id, mode: "SIMULATED" });

    switch (input.action) {
      case "FUNDS_REQUEST": {
        // The DP asks for funds for one flagged job (suggested amounts from Settings).
        const a = await getAssignment();
        if (a.status !== "ACCEPTED" || a.transaction.fundsNeeded !== "YES") throw new UserError("The job must be accepted and flagged as needing funds.");
        if (a.transaction.advanceLines.some((l) => !l.denied && !["DENIED", "CANCELLED"].includes(l.advance.status))) throw new UserError("Funds were already requested for this job.");
        const rules = await tx.cashAdvanceRule.findMany({ where: { transactionTypeId: a.transaction.typeId, active: true } });
        const kinds = a.transaction.fundsKinds.length ? a.transaction.fundsKinds : ["OTHER" as const];
        const lines = kinds.map((k) => ({ transactionId: a.transactionId, kind: k, otherDescription: k === "OTHER" ? "Simulator test" : "", requestedCents: decimalToCents(rules.find((r) => r.kind === k)?.suggestedAmount ?? null) ?? 100000 }));
        const total = lines.reduce((x, l) => x + l.requestedCents, 0);
        const adv = await tx.cashAdvance.create({ data: { number: await nextNumber(tx, now), requestedById: a.dpUserId, branchId: a.dpBranchId, requestedCents: total, lines: { create: lines } } });
        await audit(sim(a.dpUser.name), "advance_requested", "CashAdvance", adv.id, "3.4", `${adv.number} requested by ${a.dpUser.name}: ${peso(total)} for ${a.transaction.type.name}`);
        break;
      }
      case "CA_RELEASE": {
        // Approve in full and release (Finance).
        const ca = await getCa();
        if (ca.status !== "REQUESTED" && ca.status !== "APPROVED") throw new UserError("Only a requested or approved advance can be released.");
        const holidays = await getHolidaySet(tx);
        for (const l of ca.lines) await tx.cashAdvanceLine.update({ where: { id: l.id }, data: { approvedCents: l.approvedCents ?? l.requestedCents, releasedCents: l.approvedCents ?? l.requestedCents } });
        const total = ca.lines.reduce((x, l) => x + (l.approvedCents ?? l.requestedCents), 0);
        await tx.cashAdvance.update({ where: { id: ca.id }, data: { status: "RELEASED", approvedCents: total, approvedAt: now, releasedCents: total, releasedAt: now, releaseRef: "SIM-RELEASE", liquidationDueAt: liquidationDue(now, await getSetting("funds.liquidationDueDays", tx), holidays) } });
        await audit(sim("Finance"), "advance_released", "CashAdvance", ca.id, "3.5", `${ca.number} approved and released: ${peso(total)}; jobs Funded`);
        break;
      }
      case "CA_REJECT": {
        const ca = await getCa();
        if (ca.status !== "REQUESTED") throw new UserError("Only a requested advance can be denied.");
        await tx.cashAdvance.update({ where: { id: ca.id }, data: { status: "DENIED", deniedReason: "Insufficient budget this cycle (simulated)" } });
        await tx.cashAdvanceLine.updateMany({ where: { advanceId: ca.id }, data: { denied: true, approvedCents: 0 } });
        const txIds = ca.lines.map((l) => l.transactionId).filter((x): x is string => !!x);
        for (const tid of txIds) {
          await tx.loanException.create({ data: { loanId: loan.id, transactionId: tid, type: "NO_FUNDS", reason: "Finance denied the cash advance (insufficient budget this cycle). Resolve or reschedule.", raisedByLabel: "Finance (Simulated)", simulated: true } });
        }
        await audit(sim("Finance"), "advance_denied", "CashAdvance", ca.id, "3.5", `${ca.number} denied; No Funds exception raised`);
        await notify(tx, { userIds: await branchLaUserIds(tx, loan.branchId), loanId: loan.id, title: `${loan.pn}: cash advance denied`, body: "No Funds exception raised. Resolve or reschedule.", link: `/loans/${loan.pn}` });
        break;
      }
      case "CA_LIQUIDATE": {
        // Receipts for what is left on each line (simulated OR numbers).
        const ca = await getCa();
        if (!["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(ca.status)) throw new UserError("Only a released advance can be liquidated.");
        for (const [i, l] of ca.lines.entries()) {
          const left = l.releasedCents - l.receipts.reduce((x, r) => x + r.cents, 0) - l.returns.reduce((x, r) => x + r.cents, 0);
          if (left > 0) await tx.receipt.create({ data: { lineId: l.id, date: businessDate(now), cents: left, number: `OR-SIM-${String(i + 1).padStart(3, "0")}`, uploadedById: ca.requestedById } });
        }
        await refreshAdvance(tx, ca.id);
        await audit(sim(ca.requestedBy.name), "advance_liquidated", "CashAdvance", ca.id, "4.5", `${ca.number} liquidated with receipts`);
        break;
      }
      case "CA_CLOSE": {
        const ca = await getCa();
        if (ca.status !== "LIQUIDATED") throw new UserError("Only a liquidated advance can be closed.");
        await tx.cashAdvance.update({ where: { id: ca.id }, data: { status: "CLOSED", closedAt: now } });
        await audit(sim("Finance"), "advance_closed", "CashAdvance", ca.id, "4.5", `${ca.number} closed`);
        break;
      }
      case "DP_ACCEPT": {
        const a = await getAssignment();
        await acceptCore(tx, a, as(a.dpUser.name, null), true);
        break;
      }
      case "DP_DECLINE": {
        const a = await getAssignment();
        await declineCore(tx, a, as(a.dpUser.name, null), ["Incomplete documents"], "Chattel Mortgage page 2 unsigned");
        break;
      }
      case "DP_PROCESS": {
        // The same stage functions as the Job page: each stage started and finished with sample
        // evidence, every paper ticked in Check and verify, then Complete job.
        const today = businessDate(now);
        const sample: Record<string, unknown> = {
          name: "Atty. Ramon Uy (Simulated)", docNo: "123", pageNo: "45", bookNo: "VI", series: today.slice(0, 4),
          registrationNo: `PPSR-SIM-${loan.pn.slice(-4)}`, certificate: "Uploaded (simulated)", orNumber: `OR-SIM-${loan.pn.slice(-4)}`,
        };
        const first = await getAssignment();
        const who = as(first.dpUser.name, null);
        const rows = await materialize(tx, first, true);
        for (const row of rows.filter((r) => r.status !== "DONE")) {
          const a = await getAssignment();
          if (row.status === "LATER") await startStageCore(tx, a, who, row.id, now);
          if (row.kind === "VERIFY") {
            for (const d of verifiablePapers(a.transaction.documents)) await verifyPaperCore(tx, a, who, row.id, d.id, now);
            await finishStageCore(tx, await getAssignment(), who, row.id, { note: "Verified (simulated)" }, now);
            continue;
          }
          const values: Record<string, unknown> = {};
          for (const f of row.fields as unknown as EvidenceField[]) {
            values[f.key] = f.type === "date" ? today : f.type === "tick" ? true : f.type === "number" ? "1" : f.key === "office" ? a.ltoOffice?.name ?? "LTO (Simulated)" : sample[f.key] ?? "Simulated";
          }
          await finishStageCore(tx, a, who, row.id, values, now);
        }
        const a = await getAssignment();
        const code = a.transaction.type.code;
        const details =
          code === "NOTARY" ? { name: "Atty. Ramon Uy (Simulated)", docNo: "123", pageNo: "45", bookNo: "VI", series: "2026" }
          : code === "PPSR" ? { registrationNo: `PPSR-SIM-${loan.pn.slice(-4)}`, registrationDate: today, certificate: "Uploaded (simulated)" }
          : code === "MORTGAGE" ? { droppedAt: today, pickedUpAt: today, annotatedOrCr: true }
          : { note: "Done (simulated)" };
        await completeCore(tx, a, who, details);
        break;
      }
      case "DP_FORWARD": {
        // The simulated DP chooses the loan's branch and its first Loan Associate (the real screen asks).
        const a = await getAssignment();
        const la = await tx.user.findFirst({ where: receiverWhere(a.loan.branchId), orderBy: { createdAt: "asc" } });
        if (!la) throw new UserError(`No active Loan Associate at ${a.loan.branch.name} to receive the package.`);
        await forwardCore(tx, a, as(a.dpUser.name, null), { branchId: a.loan.branchId, receivingLaId: la.id, note: "" });
        break;
      }
      case "LA_ACCEPT_COMPLETE":
      case "LA_ACCEPT_INCOMPLETE": {
        const a = await getAssignment();
        const receiving = a.receivingLaId ? await tx.user.findUnique({ where: { id: a.receivingLaId } }) : null;
        await receiveCore(tx, a, as(receiving?.name ?? "Receiving LA", null), input.action === "LA_ACCEPT_COMPLETE", "Annotated CR missing");
        break;
      }
      case "TRANSMIT": {
        const cur = await tx.loan.findUniqueOrThrow({ where: { id: loan.id } });
        if (cur.stage !== "For Vault Transmittal") throw new UserError("The Loan File must be at For Vault Transmittal.");
        const docs = await tx.documentItem.findMany({ where: { loanId: loan.id, documentId: { not: null }, stage: "AT_BRANCH" } });
        if (!docs.length) throw new UserError("No labelled documents at the branch to transmit.");
        const count = await tx.transmittal.count();
        const t = await tx.transmittal.create({ data: { number: `TR-SIM-${String(count + 1).padStart(5, "0")}`, fromBranchId: loan.branchId, method: "COURIER", status: "IN_TRANSIT", dispatchedAt: now, simulated: true, items: { create: docs.map((d) => ({ loanId: loan.id, documentItemId: d.id })) } } });
        await moveDocs(tx, docs, { stage: "IN_TRANSIT", custodian: null, role: "LA", userId: null, location: `In transit to Main Vault (${t.number})`, action: "TRANSMITTED_TO_VAULT" }, { simulated: true, by: sim("Branch LA") });
        await audit(sim("Branch LA"), "transmittal_dispatched", "Transmittal", t.id, "6.1", `Transmittal ${t.number} dispatched by courier with ${docs.length} item(s); sender stays accountable`);
        break;
      }
      case "VAULT_RECEIVE": {
        const t = await tx.transmittal.findFirst({ where: { status: "IN_TRANSIT", items: { some: { loanId: loan.id } } }, include: { items: { include: { documentItem: true } } } });
        if (!t) throw new UserError("No transmittal in transit for this Loan File.");
        await tx.transmittal.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: now, receivedBy: "Vault Custodian (Simulated)" } });
        const free = await tx.vaultLocation.findMany({ where: { occupied: false }, orderBy: { label: "asc" }, take: t.items.length });
        if (free.length < t.items.length) throw new UserError("Not enough free vault slots. Add vault locations.");
        for (const [i, item] of t.items.entries()) {
          await tx.transmittalItem.update({ where: { id: item.id }, data: { received: true } });
          const slot = free[i];
          await tx.vaultLocation.update({ where: { id: slot.id }, data: { occupied: true } });
          await tx.documentItem.update({ where: { id: item.documentItemId }, data: { stage: "IN_SAFEKEEPING", custodianLabel: "Vault Custodian (Main Vault)", custodianRole: "VAULT", custodianUserId: null, location: slot.label, vaultLocationId: slot.id, since: now } });
          await tx.documentMovement.create({ data: { documentItemId: item.documentItemId, action: "VAULTED", fromCustodian: item.documentItem.custodianLabel, toCustodian: "Vault Custodian (Main Vault)", remarks: `Received by scan, verified, tagged at ${slot.label}`, actorLabel: "Vault Custodian (Simulated)", location: slot.label, acknowledgedAt: now, simulated: true } });
        }
        await audit(sim("Vault Custodian"), "vault_received", "Transmittal", t.id, "6.2", `Vault received ${t.number} by scan against the manifest`);
        await audit(sim("Vault Custodian"), "vault_verified", "Transmittal", t.id, "6.3", "Verified originals, annotation, plate, engine and chassis");
        await audit(sim("Vault Custodian"), "vault_tagged", "Transmittal", t.id, "6.4", `Tagged and located ${t.items.length} item(s); In Safekeeping`);
        break;
      }
      default:
        throw new UserError("Unknown simulator action.");
    }
    await recomputeStage(tx, loan.id, { simulated: true });
  });
}
