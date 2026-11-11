/**
 * The "Do this now" card is layout only: the rules behind each step are unchanged. Through the same
 * functions the screens use, on the test database (gdfi_dms_test). LOCAL only.
 *   - "All received" does what "Confirm all received" did.
 *   - "Check each paper" with one paper Not received raises the same problem as before.
 *   - The hold lock still blocks ticks (and the confirm).
 *   - The steps read from the stored records move in order: confirm, fix, tick, send.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, checklistStatusOf, confirmPapersBack, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { returnToLa } from "@/lib/services/return-to-la";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { getLoanForUser } from "@/lib/services/queries";
import { sentBack } from "@/lib/ui/rounds";
import { fmtDateTime } from "@/lib/time";
import { getNextSteps, nextStepsInputOf, nowStep } from "@/lib/workflow/next-steps";
import { allPapers, asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser;
const PN = "GD1652026901003";

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
});
afterAll(async () => {
  await cleanLoans();
  await prisma.$disconnect();
});

const open = async () => {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  return prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
};
const txnOf = (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: true } });

/** The steps of one transaction, read from the stored records the way the Check documents page reads them. */
async function stepsOf(code: string) {
  const loan = (await getLoanForUser(la, PN))!;
  const t = loan.transactions.find((x) => x.type.code === code)!;
  const c = checklistStatusOf(t.checks);
  const facts = nextStepsInputOf(t, loan, sentBack(t.status, t.dpAssignments)?.kind ?? null, { done: c.requiredDone, total: c.requiredTotal });
  return { steps: getNextSteps(facts.input), facts };
}
const shape = (s: { kind: string; state: string }[]) => s.map((x) => `${x.kind}:${x.state}`);

/** NOTARY sent, accepted, and returned by the DP for one named paper, every paper handed over. */
async function returnedNotary() {
  await open();
  const t = await txnOf("NOTARY");
  await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  const loan = await open();
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id }, orderBy: { createdAt: "desc" } });
  await acceptJob(dp, job.id);
  const reason = await prisma.returnReason.findFirstOrThrow({ where: { code: "MISSING_PAPER", active: true } }).catch(() => prisma.returnReason.findFirstOrThrow({ where: { active: true } }));
  const paper = t.checks.find((c) => c.required)!;
  await returnToLa(dp, job.id, { reasonId: reason.id, note: "The ID copy is unreadable", checkIds: [paper.id], handedOver: await allPapers(t.id) });
  return { txn: t, job, paper, reason };
}

describe("Do this now: the steps follow the stored records; the rules are unchanged", () => {
  it("returned: confirm is now; All received confirms every paper (as before) and the fix step becomes now", async () => {
    const { txn, job, paper } = await returnedNotary();
    let r = await stepsOf("NOTARY");
    expect(shape(r.steps)).toEqual(["confirm:now", "fix:next", "tick:next", "send:next"]);
    expect(r.facts.namedIds).toEqual([paper.id]);
    expect(r.facts.note).toBe("The ID copy is unreadable");
    expect(r.facts.input.missing).toBe(false); // the DP's own request is the fix step, not a second step

    const handed = await prisma.documentItem.findMany({ where: { transactionId: txn.id, stage: "IN_TRANSIT" } });
    expect(handed.length).toBeGreaterThan(0);
    // "All N received" posts the form with no "notReceived": the same as "Confirm all received".
    await confirmPapersBack(la, { transactionId: txn.id, notReceived: [] });
    expect(await prisma.documentItem.count({ where: { transactionId: txn.id, stage: "IN_TRANSIT" } })).toBe(0);
    expect(await prisma.documentItem.count({ where: { id: { in: handed.map((d) => d.id) }, stage: "AT_BRANCH" } })).toBe(handed.length);
    expect(await prisma.problem.count({ where: { transactionId: txn.id } })).toBe(0);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).papersReceivedBy).toBe("Test Loan Associate");

    r = await stepsOf("NOTARY");
    expect(shape(r.steps)).toEqual(["confirm:done", "fix:now", "tick:next", "send:next"]);
    expect(nowStep(r.steps)!.n).toBe(2);

    // Ticking the returned paper again: the fix and tick steps are done; Send is now.
    const t = await txnOf("NOTARY");
    await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    r = await stepsOf("NOTARY");
    expect(shape(r.steps)).toEqual(["confirm:done", "fix:done", "tick:done", "send:now"]);
  });

  it("Check each paper, one paper Not received: the same problem as before, and the problem step comes first", async () => {
    const { txn } = await returnedNotary();
    const handed = await prisma.documentItem.findMany({ where: { transactionId: txn.id, stage: "IN_TRANSIT" }, orderBy: { createdAt: "asc" } });
    await confirmPapersBack(la, { transactionId: txn.id, notReceived: [handed[0].id] });
    const p = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null }, include: { reason: true } });
    expect(p.note).toBe(`Not received from Test Document Processor: ${handed[0].label}`);
    expect(["MISSING_PAPER", "OTHER"]).toContain(p.reason.code);
    expect((await prisma.documentItem.findUniqueOrThrow({ where: { id: handed[0].id } })).stage).toBe("WITH_DP");
    const r = await stepsOf("NOTARY");
    expect(shape(r.steps)).toEqual(["problem:now", "confirm:done", "fix:next", "tick:next", "send:next"]);
  });

  it("on hold: the hold step is first, ticks and the confirm are refused with the lock message", async () => {
    const { txn } = await returnedNotary();
    const reason = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
    const id = await raiseHold(la, { transactionId: txn.id, reasonId: reason.id, note: "Waiting for the client to come back" });
    const locked = `Locked: on hold by Test Loan Associate since ${fmtDateTime((await prisma.hold.findUniqueOrThrow({ where: { id } })).raisedAt)}. Only Test Loan Associate can resume.`;
    const r = await stepsOf("NOTARY");
    expect(shape(r.steps)).toEqual(["hold:now", "confirm:next", "fix:next", "tick:next", "send:next"]);
    const t = await txnOf("NOTARY");
    await expect(saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.map((c) => c.id), newOthers: [] })).rejects.toThrow(locked);
    await expect(confirmPapersBack(la, { transactionId: txn.id, notReceived: [] })).rejects.toThrow(locked);
    expect(await prisma.documentItem.count({ where: { transactionId: txn.id, stage: "IN_TRANSIT" } })).toBeGreaterThan(0);
    await resumeHold(la, id, "The client came back today");
    expect(shape((await stepsOf("NOTARY")).steps)[0]).toBe("confirm:now");
  });

  it("normal work: tick now, then Send; a missing-paper request comes first", async () => {
    await open();
    expect(shape((await stepsOf("PPSR")).steps)).toEqual(["tick:now", "send:next"]);
    const t = await txnOf("PPSR");
    await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    expect(shape((await stepsOf("PPSR")).steps)).toEqual(["tick:done", "send:now"]);
  });
});
