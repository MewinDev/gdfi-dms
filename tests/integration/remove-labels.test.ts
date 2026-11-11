/**
 * Print labels were removed (11 November 2026, confirmed by the users): labels are not used in the LA
 * and DP flow. Through the same functions the screens use, on the test database (gdfi_dms_test).
 *   - Sending to DP and accepting need no label step (the paper rules only).
 *   - Nothing counts, warns or opens a step for labels (open items, Journey step 3.2).
 *   - No label permission tick, in the catalogue, the defaults or any stored role; no role loses a step.
 *   - No label column is left in the schema; the label TAT target is gone.
 * The paper's own Document ID stays (search, stage, DP verification, reuse between loans).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ALL_PERMISSIONS, PERMISSION_DEFS, PERMISSIONS as P, ROLE_DEFAULTS, plainWords } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { getLoanForUser, whatToDoNow } from "@/lib/services/queries";
import { PHASES } from "@/lib/workflow/journey";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser;
const PN = "GD1652026901003";
const LABEL = /label/i;

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

describe("Send to DP without any label step", () => {
  it("tick the papers, send, the processor accepts: no label step, tick or record anywhere", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const t = await prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code: "NOTARY" } }, include: { checks: true } });
    await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("READY");

    // Papers in hand have their Document ID; nothing asks for labels.
    const loan = (await getLoanForUser(la, PN))!;
    const docs = loan.documents.filter((d) => d.transactionId === t.id && d.documentId);
    expect(docs.length).toBeGreaterThan(0);
    expect(whatToDoNow(loan).map((i) => i.text).filter((x) => LABEL.test(x))).toEqual([]);

    // Send straight away (no label print before), then Accept with no "Labels are on all papers" tick.
    const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id }, orderBy: { createdAt: "desc" } });
    expect(job.status).toBe("PENDING_ACCEPTANCE");
    await acceptJob(dp, job.id);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROCESS");
    // The hand-over to the processor is unchanged: every paper is with the DP, received by them.
    const after = await prisma.documentItem.findMany({ where: { transactionId: t.id, documentId: { not: null } } });
    expect(after.every((d) => d.stage === "WITH_DP")).toBe(true);
    expect(await prisma.documentMovement.count({ where: { documentItem: { transactionId: t.id }, action: "ACKNOWLEDGED_BY_DP" } })).toBe(after.length);

    // No label record: custody trail, audit log.
    expect(await prisma.documentMovement.count({ where: { documentItem: { loanId: loan.id }, action: "LABEL_PRINTED" } })).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { loanId: loan.id }, select: { action: true, summary: true } });
    expect(audit.filter((a) => LABEL.test(a.action) || LABEL.test(a.summary))).toEqual([]);
  });
});

describe("No label permission, no lock-out", () => {
  it("no label tick in the catalogue, the defaults or any stored role", async () => {
    expect(ALL_PERMISSIONS.filter((k) => k.startsWith("labels:"))).toEqual([]);
    expect(PERMISSION_DEFS.filter((d) => LABEL.test(`${d.label} ${d.help} ${d.can} ${d.where}`))).toEqual([]);
    for (const [key, r] of Object.entries(ROLE_DEFAULTS)) {
      expect([key, r.permissions.filter((k) => k.startsWith("labels:"))]).toEqual([key, []]);
      expect([key, LABEL.test(r.description)]).toEqual([key, false]);
      expect([key, plainWords(r.permissions, r.branchAccess).filter((l) => LABEL.test(l))]).toEqual([key, []]);
    }
    expect(await prisma.role.count({ where: { permissions: { has: "labels:print" } } })).toBe(0);
  });

  it("the Loan Associate keeps every other step it had (only the label tick went)", () => {
    expect(ROLE_DEFAULTS.LA.permissions).toEqual(expect.arrayContaining([
      P.LOANS_VIEW, P.LOANS_SEARCH, P.LOANS_OPEN, P.CHECKLIST_TICK, P.PAPERS_MARK_MISSING, P.PAPERS_RECEIVE_LATE, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND,
      P.RETURNS_ACCEPT, P.FUNDS_FLAG, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE, P.HOLDS_RAISE, P.HOLDS_RESOLVE,
    ]));
    // The processor accepts with Work jobs (the label tick was never a permission).
    expect(ROLE_DEFAULTS.DP.permissions).toContain(P.JOBS_WORK);
  });
});

describe("No label data or target left", () => {
  it("no label column in the schema; the label TAT target and Journey wording are gone", async () => {
    const fields = Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.map((f) => `${m.name}.${f.name}`));
    expect(fields.filter((f) => /label(s)?(Printed|Confirmed)/i.test(f))).toEqual([]);
    expect(await prisma.tatRule.count({ where: { key: "P3_LABELS" } })).toBe(0);
    const steps = PHASES.flatMap((p) => p.steps);
    expect(steps.filter((s) => LABEL.test(s.title) || s.tatKey === "P3_LABELS")).toEqual([]);
    expect(steps.find((s) => s.id === "3.2")).toMatchObject({ title: "Generate Document IDs", owner: ["SYS"] });
  });
});
