/**
 * Missing papers with reasons (confirmed rule; TEST database only, removes all loan files first).
 * A missing paper no longer blocks the file: it is marked Missing with a reason and remarks for that
 * paper; Send waits only for papers without saved remarks. Optional papers count only when included.
 * The processor cannot return the file for a missing-with-remarks paper; the vault gate lets the file
 * through "Complete with exceptions"; Received clears the flag with the last one. Every check here is
 * on the server (the services), not the page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, recordEdst, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, receivePackage } from "@/lib/services/jobs";
import { acceptWithMissing, returnToLa } from "@/lib/services/return-to-la";
import {
  loanHasMissingPapers, markPaperMissing, receiveMissingPaper, saveMissingRemarks, setPaperIncluded, unmarkPaperMissing,
} from "@/lib/services/papers";
import { MissingPapersError } from "@/lib/services/errors";
import { businessDate } from "@/lib/time";
import { allPapers, asUser, cleanLoans, forwardToLoanBranch, workStages } from "./helpers";

let la: CurrentUser;
let dp: CurrentUser;
let admin: CurrentUser;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const REQUIRED = ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Valid IDs of borrower (2)", "Sales Invoice"];
const reasonId = async (code = "LATER") => (await prisma.missingPaperReason.findUniqueOrThrow({ where: { code } })).id;
const returnReason = async (code: string) => (await prisma.returnReason.findUniqueOrThrow({ where: { code } })).id;

/** Opens a loan (default GD1012026901001: 4 transactions) and returns its Notary transaction, by paper label. */
async function openNotary(pn = "GD1012026901001", picks: { financingType?: "UNDERTAKING"; orcrStatus?: "TRANSFERRED" | "UNTRANSFERRED" } = {}) {
  await openLoanFile(la, { pn, ...picks });
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: { include: { rule: true } } } });
  const id = (label: string) => txn.checks.find((c) => c.rule?.label === label)!.id;
  return { loan, txn, id };
}

async function sendInput(loanBranchId: string, transactionId: string) {
  return {
    transactionId, dpBranchId: loanBranchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id,
    fundsNeeded: "NO" as const, fundsKinds: [] as string[], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  };
}

/** Every required Notary paper ticked except `missing`, which is marked Missing (with remarks unless told not to). */
async function notaryWithMissing(missing: string, remarks: string | null = "Borrower brings it on Monday") {
  const n = await openNotary();
  await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.filter((l) => l !== missing).map(n.id), newOthers: [] });
  await markPaperMissing(la, { checkId: n.id(missing) });
  if (remarks) await saveMissingRemarks(la, { checkId: n.id(missing), reasonId: await reasonId(), remarks });
  return n;
}

describe("Send gate", () => {
  it("blocks Send naming the papers marked Missing without remarks, on the server, and writes the refusal", async () => {
    const n = await openNotary();
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.filter((l) => !["Promissory Note", "Valid IDs of borrower (2)"].includes(l)).map(n.id), newOthers: [] });
    await markPaperMissing(la, { checkId: n.id("Promissory Note") });
    await markPaperMissing(la, { checkId: n.id("Valid IDs of borrower (2)") });
    const err = await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id)).catch((e) => e);
    expect(err).toBeInstanceOf(MissingPapersError);
    expect((err as MissingPapersError).needsRemarks).toEqual(["Promissory Note", "Valid IDs of borrower (2)"]);
    expect((err as MissingPapersError).missing).toEqual([]);
    expect((err as MissingPapersError).message).toBe("Add remarks for: Promissory Note, Valid IDs of borrower (2).");
    expect(await prisma.dpAssignment.count({ where: { transactionId: n.txn.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "send_refused_missing_papers", entityId: n.txn.id } })).toBe(1);

    // With remarks for both, Send goes through: the papers are exceptions, not blockers.
    for (const l of ["Promissory Note", "Valid IDs of borrower (2)"]) await saveMissingRemarks(la, { checkId: n.id(l), reasonId: await reasonId(), remarks: "Comes after release" });
    await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id));
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("ASSIGNED");
    // No alert and no email for a missing paper (the send itself tells the processor as usual).
    expect(await prisma.emailOutbox.count({ where: { event: "missing_paper" } })).toBe(0);
  });

  it("an unanswered required paper still blocks (neither Present nor Missing)", async () => {
    const n = await openNotary();
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.filter((l) => l !== "Disclosure Statement").map(n.id), newOthers: [] });
    const err = await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id)).catch((e) => e);
    expect((err as MissingPapersError).missing).toEqual(["Disclosure Statement"]);
  });

  it("an optional paper not included is ignored; included, it behaves like a required paper", async () => {
    const n = await openNotary();
    const coMaker = n.id("Valid ID of co-maker");
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.map(n.id), newOthers: [] });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("READY");
    // Included: now expected, so the transaction waits for it (Present, or Missing with remarks).
    await setPaperIncluded(la, { checkId: coMaker, included: true });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("FOR_CHECKLIST");
    let err = await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id)).catch((e) => e);
    expect((err as MissingPapersError).missing).toEqual(["Valid ID of co-maker"]);
    await markPaperMissing(la, { checkId: coMaker });
    err = await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id)).catch((e) => e);
    expect((err as MissingPapersError).needsRemarks).toEqual(["Valid ID of co-maker"]);
    await saveMissingRemarks(la, { checkId: coMaker, reasonId: await reasonId("NOT_ISSUED"), remarks: "Co-maker renewing the ID" });
    await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id));
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("ASSIGNED");
  });

  it("left out again before sending: the Missing mark is taken back and it needs nothing", async () => {
    const n = await openNotary();
    const coMaker = n.id("Valid ID of co-maker");
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.map(n.id), newOthers: [] });
    await markPaperMissing(la, { checkId: coMaker });
    await setPaperIncluded(la, { checkId: coMaker, included: false });
    expect(await prisma.checklistCheck.findUniqueOrThrow({ where: { id: coMaker } })).toMatchObject({ includedInFile: false, missingState: null, checked: false });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("READY");
  });
});

describe("Remarks", () => {
  it("are 5 to 500 characters (4 and 501 refused), a reason is required, and the database refuses a short one too", async () => {
    const n = await notaryWithMissing("Disclosure Statement", null);
    const checkId = n.id("Disclosure Statement");
    await expect(saveMissingRemarks(la, { checkId, reasonId: await reasonId(), remarks: "abcd" })).rejects.toThrow(/at least 5 characters/);
    await expect(saveMissingRemarks(la, { checkId, reasonId: await reasonId(), remarks: "x".repeat(501) })).rejects.toThrow(/500 characters or fewer/);
    await expect(saveMissingRemarks(la, { checkId, reasonId: "", remarks: "Long enough" })).rejects.toThrow("Pick a reason.");
    await expect(saveMissingRemarks(la, { checkId, reasonId: await reasonId("OTHER"), remarks: "    " })).rejects.toThrow(/at least 5/); // "Other" needs remarks like every reason
    await saveMissingRemarks(la, { checkId, reasonId: await reasonId(), remarks: "abcde" });
    await saveMissingRemarks(la, { checkId, reasonId: await reasonId(), remarks: "y".repeat(500) });
    await expect(prisma.checklistCheck.update({ where: { id: checkId }, data: { missingRemarks: "abc" } })).rejects.toThrow();
    // An inactive reason is not offered for a paper that does not have it.
    await prisma.missingPaperReason.update({ where: { code: "LOST" }, data: { active: false } });
    try {
      await expect(saveMissingRemarks(la, { checkId, reasonId: await reasonId("LOST"), remarks: "Lost in the flood" })).rejects.toThrow("Pick a reason.");
    } finally {
      await prisma.missingPaperReason.update({ where: { code: "LOST" }, data: { active: true } });
    }
  });

  it("after sending: an edit adds a history entry (who, when, old and new text); the mark cannot be taken back", async () => {
    const n = await notaryWithMissing("Disclosure Statement", "First remarks here");
    const checkId = n.id("Disclosure Statement");
    await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id));
    await saveMissingRemarks(la, { checkId, reasonId: await reasonId("NOT_ISSUED"), remarks: "Second remarks here" });
    const events = await prisma.paperEvent.findMany({ where: { checkId }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["MARKED_MISSING", "REMARKS_SAVED", "REMARKS_EDITED"]);
    expect(events[2]).toMatchObject({ byLabel: la.name, oldText: "Borrower to submit later: First remarks here", newText: "Second remarks here", reasonName: "Not yet issued by the agency" });
    expect(await prisma.auditLog.count({ where: { action: "paper_missing_remarks_edited", entityId: n.txn.id } })).toBe(1);
    await expect(unmarkPaperMissing(la, { checkId, present: true })).rejects.toThrow();
    await expect(saveChecklist(la, { transactionId: n.txn.id, checkedIds: [...REQUIRED.map(n.id)], newOthers: [] })).rejects.toThrow(/Mark it Received/);
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: checkId } })).missingRemarks).toBe("Second remarks here");
  });

  it("before sending: the mark can be taken back (ticked Present), with a history row", async () => {
    const n = await notaryWithMissing("Disclosure Statement");
    const checkId = n.id("Disclosure Statement");
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.map(n.id), newOthers: [] });
    expect(await prisma.checklistCheck.findUniqueOrThrow({ where: { id: checkId } })).toMatchObject({ checked: true, missingState: null });
    expect((await prisma.paperEvent.findMany({ where: { checkId } })).map((e) => e.kind)).toContain("CLEARED");
  });
});

describe("The processor (DP)", () => {
  it("cannot return the file for a missing-with-remarks paper, but can for a paper the LA marked Present", async () => {
    const n = await notaryWithMissing("Valid IDs of borrower (2)");
    await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id));
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: n.txn.id } });
    // At Accept: naming the missing-with-remarks paper is refused.
    await expect(acceptWithMissing(dp, job.id, { reasonId: await returnReason("MISSING"), checkIds: [n.id("Valid IDs of borrower (2)")], note: "Not in the package", handedOver: [] }))
      .rejects.toThrow(/already marked Missing by the Loan Associate/);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING_ACCEPTANCE");
    await acceptJob(dp, job.id);
    await expect(returnToLa(dp, job.id, { reasonId: await returnReason("MISSING"), checkIds: [n.id("Valid IDs of borrower (2)")], note: "Not in the package", handedOver: await allPapers(n.txn.id) }))
      .rejects.toThrow(/already marked Missing by the Loan Associate/);
    // An optional paper that is not part of the file cannot be a reason either.
    await expect(returnToLa(dp, job.id, { reasonId: await returnReason("MISSING"), checkIds: [n.id("Valid ID of co-maker")], note: "Not in the package", handedOver: await allPapers(n.txn.id) }))
      .rejects.toThrow(/not part of this file/);
    // A paper the LA ticked Present: the existing return flow, unchanged.
    await returnToLa(dp, job.id, { reasonId: await returnReason("MISSING"), checkIds: [n.id("Promissory Note")], note: "The PN is not in the package", handedOver: await allPapers(n.txn.id) });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: n.txn.id } })).status).toBe("RETURNED");
    // The missing paper keeps its mark and remarks through the return.
    expect(await prisma.checklistCheck.findUniqueOrThrow({ where: { id: n.id("Valid IDs of borrower (2)") } })).toMatchObject({ missingState: "MISSING", missingRemarks: "Borrower brings it on Monday" });
  });

  it("refuses marking Missing and receiving without the permissions (server side)", async () => {
    const n = await notaryWithMissing("Disclosure Statement");
    await expect(markPaperMissing(dp, { checkId: n.id("Promissory Note") })).rejects.toThrow(/does not allow marking a paper Missing/);
    await expect(saveMissingRemarks(dp, { checkId: n.id("Disclosure Statement"), reasonId: await reasonId(), remarks: "From the processor" })).rejects.toThrow(/does not allow/);
    await expect(receiveMissingPaper(dp, { checkId: n.id("Disclosure Statement"), receivedOn: businessDate(new Date()) })).rejects.toThrow(/does not allow receiving/);
    // Admin may receive (papers:receive_late) but not mark (a work step).
    await expect(markPaperMissing(admin, { checkId: n.id("Promissory Note") })).rejects.toThrow(/does not allow/);
    await receiveMissingPaper(admin, { checkId: n.id("Disclosure Statement"), receivedOn: businessDate(new Date()) });
  });
});

describe("Vault gate and Received", () => {
  it("lets the file through with exceptions; Received clears the flag only when the last missing paper arrives", async () => {
    const pn = "GD1652026901004"; // Notary and For EDST only
    const n = await openNotary(pn, { financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    expect((await prisma.loanTransaction.findMany({ where: { loanId: n.loan.id, status: { not: "CANCELLED" } }, include: { type: true } })).map((t) => t.type.code).sort()).toEqual(["EDST", "NOTARY"]);
    const edst = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: n.loan.id, type: { code: "EDST" } }, include: { checks: { include: { rule: true } } } });
    // For EDST: the required papers Present; the optional one left out (ignored).
    await saveChecklist(la, { transactionId: edst.id, checkedIds: edst.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    await recordEdst(la, { transactionId: edst.id, reference: "EDST-MP-1" });
    // Notary: two papers Missing with remarks.
    await saveChecklist(la, { transactionId: n.txn.id, checkedIds: REQUIRED.filter((l) => !["Disclosure Statement", "Valid IDs of borrower (2)"].includes(l)).map(n.id), newOthers: [] });
    for (const l of ["Disclosure Statement", "Valid IDs of borrower (2)"]) {
      await markPaperMissing(la, { checkId: n.id(l) });
      await saveMissingRemarks(la, { checkId: n.id(l), reasonId: await reasonId(), remarks: "After release" });
    }
    await assignToDp(la, await sendInput(n.loan.branchId, n.txn.id));
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: n.txn.id } });
    await acceptJob(dp, job.id);
    await workStages(dp, job.id);
    await completeJob(dp, job.id, {});
    await forwardToLoanBranch(dp, job.id, la.id);
    await receivePackage(la, job.id, { result: "complete", note: "" });
    // The vault gate: through, with the missing papers as exceptions.
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn } })).stage).toBe("For Vault Transmittal");
    expect(await loanHasMissingPapers(prisma, n.loan.id)).toBe(true);

    // Received: not in the future, not before it was marked; the original reason and remarks stay.
    const tomorrow = new Date(Date.now() + 86_400_000 * 2);
    await expect(receiveMissingPaper(la, { checkId: n.id("Disclosure Statement"), receivedOn: businessDate(tomorrow) })).rejects.toThrow(/future/);
    await receiveMissingPaper(la, { checkId: n.id("Disclosure Statement"), receivedOn: businessDate(new Date()) });
    expect(await prisma.checklistCheck.findUniqueOrThrow({ where: { id: n.id("Disclosure Statement") } })).toMatchObject({ checked: true, missingState: "RECEIVED_LATE", missingRemarks: "After release", receivedLateBy: la.name });
    expect(await loanHasMissingPapers(prisma, n.loan.id)).toBe(true); // one still missing
    await receiveMissingPaper(la, { checkId: n.id("Valid IDs of borrower (2)"), receivedOn: businessDate(new Date()) });
    expect(await loanHasMissingPapers(prisma, n.loan.id)).toBe(false);
    await expect(receiveMissingPaper(la, { checkId: n.id("Valid IDs of borrower (2)"), receivedOn: businessDate(new Date()) })).rejects.toThrow(/already received/);
    // The history keeps the marking, the remarks and the Received event; the paper has its Document ID.
    expect((await prisma.paperEvent.findMany({ where: { checkId: n.id("Valid IDs of borrower (2)") }, orderBy: { at: "asc" } })).map((e) => e.kind)).toEqual(["MARKED_MISSING", "REMARKS_SAVED", "RECEIVED_LATE"]);
    expect((await prisma.documentItem.findFirstOrThrow({ where: { checkId: n.id("Valid IDs of borrower (2)") } })).documentId).toMatch(/-ID-/);
    // Journey: one audit event per marking and per Received.
    expect(await prisma.auditLog.count({ where: { loanId: n.loan.id, action: "paper_marked_missing" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { loanId: n.loan.id, action: "paper_received_late" } })).toBe(2);
  }, 120_000);
});
