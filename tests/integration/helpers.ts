import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { resetLoanData } from "@/lib/test-data/reset-core";
import { setSetting } from "@/lib/settings";
import { assertTestDatabase } from "@/lib/env/test-db";

// They reset loan files and settings: only on the local test database (gdfi_dms_test), never on gdfi_dms.
assertTestDatabase("The integration tests");

/** Builds the same CurrentUser the app builds from the session. */
export async function asUser(email: string): Promise<CurrentUser> {
  return toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email }, include: CURRENT_USER_INCLUDE }));
}

/** No loan files, MyLoans reachable. (No audit row: test setup, not a user action.) */
export async function cleanLoans() {
  await prisma.$transaction((tx) => resetLoanData(tx), { timeout: 60_000 });
  await setSetting("myloans.simulateUnavailable", false);
}

/** Test helper: the DP works every stage of a job in order (Start, evidence, Finish; Check and verify ticks every paper). */
export async function workStages(u: CurrentUser, jobId: string, values: Record<string, unknown> = {}) {
  const { startStage, finishStage, verifyPaper, loadAssignment } = await import("@/lib/services/jobs");
  const { stageRows, verifiablePapers } = await import("@/lib/services/job-stages");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  for (;;) {
    const a = await loadAssignment(prisma, jobId);
    const rows = await stageRows(prisma, a);
    const row = rows.find((r) => r.status !== "DONE");
    if (!row) return;
    const id = row.id ?? row.code;
    if (row.status === "LATER") await startStage(u, jobId, id);
    const fresh = (await stageRows(prisma, await loadAssignment(prisma, jobId))).find((r) => r.code === row.code)!;
    if (fresh.kind === "VERIFY") {
      for (const d of verifiablePapers(a.transaction.documents)) await verifyPaper(u, jobId, fresh.id!, d.id);
      await finishStage(u, jobId, fresh.id!, { note: "" });
      continue;
    }
    const raw: Record<string, unknown> = {};
    for (const f of fresh.fields) raw[f.key] = values[f.key] ?? (f.key === "office" && a.ltoOffice ? a.ltoOffice.name : f.type === "date" ? today : f.type === "tick" ? "on" : f.type === "number" ? "1" : f.type === "file" ? "On file" : `Test ${f.label}`);
    await finishStage(u, jobId, fresh.id!, raw);
  }
}

/** Test helper: forward to the loan's own branch and the given LA (the DP chooses both). */
export async function forwardToLoanBranch(u: CurrentUser, jobId: string, laId: string) {
  const { forwardJob } = await import("@/lib/services/jobs");
  const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: jobId }, select: { loan: { select: { branchId: true } } } });
  return forwardJob(u, jobId, { branchId: a.loan.branchId, receivingLaId: laId });
}

/** Every paper of a transaction: what the processor ticks as "handed over" on a Return to LA. */
export async function allPapers(transactionId: string): Promise<string[]> {
  return (await prisma.documentItem.findMany({ where: { transactionId }, select: { id: true } })).map((d) => d.id);
}
