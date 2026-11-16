import "server-only";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { getHolidaySet, getSetting, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { buildPn } from "@/lib/pn/format";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, recordEdst, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, finishStage, forwardJob, loadAssignment, receivePackage, startStage, verifyPaper } from "@/lib/services/jobs";
import { stageRows, verifiablePapers } from "@/lib/services/job-stages";
import { closeAsCancelled, simulateSourceChange } from "@/lib/services/source-sync";
import { simulate } from "@/lib/services/simulator";
import { shiftBusinessDays } from "@/lib/kit/rebase";
import { KIT_EMAIL_DOMAIN } from "@/lib/kit/catalog";

/**
 * Part of npm run db:reset-seed (lib/seed/foundation.ts): fake loans spread across every loan-file
 * stage the app can reach today, each moved there through the app's own services, a few backdated to
 * be near or over their TAT (the kit's own way: only times are set directly).
 *
 * Reachable and seeded here: For checklist, Assigned to DP, In process, Awaiting LA acceptance,
 * For Vault Transmittal, In transit to Vault and In Safekeeping (the vault steps through the test
 * simulator, the only way they exist today), Cancelled in MyLoans.
 * Not reachable today (UNREACHABLE_STAGES says why).
 */

type Log = (line: string) => void;

export const UNREACHABLE_STAGES: Record<string, string> = {
  Opened: "Only while a file has no live transaction; the rules always create Notary and For EDST, so no file stays here.",
  "No DP assignment required": "Needs every live transaction to be LA-only, but the rules always create Notary, which needs a DP (unless an Admin makes Notary LA-only in Settings).",
  Closed: "No step sets Loan.closedAt yet (Closure comes with the safekeeping and archive modules).",
  Archived: "No step sets Loan.archivedAt yet (archive module).",
  Disposed: "No step sets Loan.disposedAt yet (retention and disposal).",
};

/** The fake loans: one target stage each; tat: "near" (due within a day) or "over" (past due). */
const SPREAD: { n: number; borrower: string; target: Target; tat?: "near" | "over" }[] = [
  { n: 1, borrower: "Sample Borrower Uno", target: "FOR_CHECKLIST", tat: "near" },
  { n: 2, borrower: "Sample Borrower Dos", target: "FOR_CHECKLIST", tat: "over" },
  { n: 3, borrower: "Sample Borrower Tres", target: "ASSIGNED" },
  { n: 4, borrower: "Sample Borrower Cuatro", target: "ASSIGNED", tat: "over" },
  { n: 5, borrower: "Sample Borrower Singko", target: "IN_PROCESS" },
  { n: 6, borrower: "Sample Borrower Seis", target: "IN_PROCESS", tat: "near" },
  { n: 7, borrower: "Sample Borrower Siyete", target: "IN_PROCESS", tat: "over" },
  { n: 8, borrower: "Sample Borrower Otso", target: "FORWARDED" },
  { n: 9, borrower: "Sample Borrower Nuwebe", target: "FORWARDED", tat: "over" },
  { n: 10, borrower: "Sample Borrower Diyes", target: "VAULT_TRANSMITTAL" },
  { n: 11, borrower: "Sample Borrower Onse", target: "IN_TRANSIT" },
  { n: 12, borrower: "Sample Borrower Dose", target: "SAFEKEEPING" },
  { n: 13, borrower: "Sample Borrower Trese", target: "CANCELLED" },
];
type Target = "FOR_CHECKLIST" | "ASSIGNED" | "IN_PROCESS" | "FORWARDED" | "VAULT_TRANSMITTAL" | "IN_TRANSIT" | "SAFEKEEPING" | "CANCELLED";

const BRANCH = "101"; // Antipolo: the kit's LA 1 and DP 1 work there
export const spreadPn = (n: number) => buildPn(BRANCH, 2026, 7000 + n); // GD101202690700nn: clear of the kit's numbers

async function asUser(email: string): Promise<CurrentUser> {
  return toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email }, include: CURRENT_USER_INCLUDE }));
}

export async function applyStageSpread(log: Log = console.log): Promise<void> {
  const today = businessDate(new Date());
  const holidays = await getHolidaySet();
  const daysAgo = (n: number, hhmm = "09:00") => new Date(`${shiftBusinessDays(today, -n, holidays)}T${hhmm}:00+08:00`);
  const la = await asUser(`kit.la1${KIT_EMAIL_DOMAIN}`);
  const dp = await asUser(`kit.dp1${KIT_EMAIL_DOMAIN}`);
  // The kit Admin: decides the myloans cancellation (Admin keeps that until piece 8) and runs the test simulator.
  const superadmin = await asUser(`kit.admin${KIT_EMAIL_DOMAIN}`);

  // The sample MyLoans gets one record per loan (released 1 business day ago, or 5 for "over" at the checklist).
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: BRANCH } });
  const records: MyLoansRecord[] = SPREAD.map((s) => ({
    pn: spreadPn(s.n), cin: `CIN-SPREAD-${s.n}`, cif: `CIF-SPREAD-${s.n}`, sourceLoanId: `ML-SPREAD-${s.n}`, borrowerName: s.borrower,
    branchName: branch.name, branchCode: BRANCH, status: "RELEASED", loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 600000,
    releaseDate: shiftBusinessDays(today, s.tat === "over" && s.target === "FOR_CHECKLIST" ? -5 : -1, holidays),
    vehicle: { plateNo: `SPR ${s.n}`, engineNo: `ENG-S${s.n}`, chassisNo: `CHS-S${s.n}`, make: "Sample Make" }, address: `${s.n} Sample St, ${branch.name}`,
  }));
  const extra = (await getSetting("myloans.mockExtra")) as MyLoansRecord[];
  await setSetting("myloans.mockExtra", [...extra.filter((r) => !records.some((x) => x.pn === r.pn)), ...records]);

  const txn = (pn: string, code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn }, type: { code } }, include: { checks: true } });
  const tickAll = async (pn: string) => {
    for (const t of await prisma.loanTransaction.findMany({ where: { loan: { pn }, status: { not: "CANCELLED" } }, include: { checks: true } })) {
      await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.map((c) => c.id), newOthers: [] });
    }
  };
  const send = async (pn: string) => {
    await tickAll(pn);
    await recordEdst(la, { transactionId: (await txn(pn, "EDST")).id, reference: `EDST-SAMPLE-${pn.slice(-4)}` });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
    const office = branch.usualLtoOfficeId ?? (await prisma.ltoOffice.findFirstOrThrow({ where: { code: "LTO-QC" } })).id;
    const t = await txn(pn, "NOTARY");
    await assignToDp(la, { transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Sample data", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    return (await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id }, orderBy: { createdAt: "desc" } })).id;
  };
  const workAll = async (jobId: string) => {
    for (;;) {
      const row = (await stageRows(prisma, await loadAssignment(prisma, jobId))).find((r) => r.status !== "DONE");
      if (!row) return;
      if (row.status === "LATER") await startStage(dp, jobId, row.id ?? row.code);
      const a = await loadAssignment(prisma, jobId);
      const cur = (await stageRows(prisma, a)).find((r) => r.code === row.code)!;
      if (cur.kind === "VERIFY") {
        for (const d of verifiablePapers(a.transaction.documents)) await verifyPaper(dp, jobId, cur.id!, d.id);
        await finishStage(dp, jobId, cur.id!, { note: "Every paper back and complete" });
      } else {
        const raw: Record<string, unknown> = {};
        for (const f of cur.fields) raw[f.key] = f.key === "office" && a.ltoOffice ? a.ltoOffice.name : f.type === "date" ? today : f.type === "tick" ? "on" : f.type === "number" ? "1" : f.type === "file" ? "On file" : `Sample ${f.label.toLowerCase()}`;
        await finishStage(dp, jobId, cur.id!, raw);
      }
    }
  };
  const simulatorWas = await getSetting("simulator.enabled");
  await setSetting("simulator.enabled", true);

  try {
    for (const s of SPREAD) {
      const pn = spreadPn(s.n);
      await openLoanFile(la, { pn });
      const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
      if (s.target === "FOR_CHECKLIST") continue; // released 1 day ago (near "Day 2") or 5 days ago (over)
      if (s.target === "CANCELLED") {
        await simulateSourceChange(superadmin, loan.id, "cancel"); // raises the review item (refreshLoan)
        const item = await prisma.sourceChange.findFirstOrThrow({ where: { loanId: loan.id, state: "OPEN" }, orderBy: { detectedAt: "desc" } });
        await closeAsCancelled(superadmin, item.id, "Sample data: cancelled in MyLoans.");
        continue;
      }
      const jobId = await send(pn);
      if (s.target === "ASSIGNED") {
        if (s.tat === "over") await backdateJob(jobId, { sent: daysAgo(2) });
        continue;
      }
      await acceptJob(dp, jobId);
      if (s.target === "IN_PROCESS") {
        if (s.tat) await backdateJob(jobId, { sent: daysAgo(s.tat === "near" ? 3 : 6), accepted: daysAgo(s.tat === "near" ? 2 : 5, "09:30") });
        continue;
      }
      await workAll(jobId);
      await completeJob(dp, jobId, {});
      await forwardJob(dp, jobId, { branchId: loan.branchId, receivingLaId: la.id });
      if (s.target === "FORWARDED") {
        if (s.tat === "over") await prisma.loanTransaction.update({ where: { id: (await txn(pn, "NOTARY")).id }, data: { statusSince: daysAgo(3, "15:00") } });
        continue;
      }
      await receivePackage(la, jobId, { result: "complete", note: "" });
      if (s.target === "VAULT_TRANSMITTAL") continue;
      await simulate(superadmin, { loanId: loan.id, action: "TRANSMIT" });
      if (s.target === "IN_TRANSIT") continue;
      await simulate(superadmin, { loanId: loan.id, action: "VAULT_RECEIVE" });
    }
  } finally {
    await setSetting("simulator.enabled", simulatorWas);
  }

  const stages = await prisma.loan.groupBy({ by: ["stage"], where: { pn: { in: SPREAD.map((s) => spreadPn(s.n)) } }, _count: { _all: true } });
  log(`Stage spread: opened ${SPREAD.length} more fake loans (${stages.map((g) => `${g.stage} ${g._count._all}`).join(", ")}); some near or over TAT.`);
  log(`Stages no step can reach today: ${Object.keys(UNREACHABLE_STAGES).join(", ")} (see lib/seed/stage-spread.ts).`);
}

/** Moves a job's sent and accepted times (the kit's way: only times are set directly). */
async function backdateJob(jobId: string, t: { sent: Date; accepted?: Date }) {
  const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: jobId }, include: { transaction: true } });
  await prisma.dpAssignment.update({ where: { id: jobId }, data: { endorsedAt: t.sent, createdAt: t.sent, ...(t.accepted ? { decidedAt: t.accepted } : {}) } });
  const since = a.transaction.status === "IN_PROCESS" && t.accepted ? t.accepted : t.sent;
  await prisma.loanTransaction.update({ where: { id: a.transactionId }, data: { statusSince: since } });
}
