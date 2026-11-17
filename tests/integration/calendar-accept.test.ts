// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { myJobs, sortByDue } from "@/lib/services/job-queries";
import { loadCalendar } from "@/lib/calendar/load";
import { addWorkingDays, daysFor } from "@/lib/calendar/core";
import { getTatMap } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

/** D-041: the TAT is saved at accept, on the processor's branch calendar, and the job lists sort by it. */
let la: CurrentUser, dp: CurrentUser;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  await cleanLoans();
});

describe("saved at accept (D-041)", () => {
  it("accept saves the due date, the target and the processor's branch; the job list shows it first by due date", async () => {
    await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: true } });
    await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const before = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id } });
    expect(before.dueDate).toBeNull(); // nothing is saved before accept
    await acceptJob(dp, before.id);
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: before.id } });
    const target = (await getTatMap()).get("P4_NOTARY")!.businessDays;
    expect(a).toMatchObject({ targetDays: target, dueBranchId: a.dpBranchId });
    expect(a.dueDate).toBe(addWorkingDays(businessDate(a.decidedAt!), target, daysFor(await loadCalendar(), a.dpBranchId)));
    const row = (await myJobs(dp)).find((r) => r.id === a.id)!;
    expect(row.dueDate).toBe(a.dueDate);
    expect(["processing", "soon", "due"]).toContain(row.tat?.state);
  });
});

describe("Jobs lists sorted by due date (D-041)", () => {
  it("overdue and soonest first, then jobs with no due date, newest first among them", () => {
    const r = (id: string, dueDate: string | null, endorsed: string) => ({ id, dueDate, endorsedAt: new Date(`${endorsed}T09:00:00+08:00`) });
    const sorted = sortByDue([r("later", "2026-11-30", "2026-11-20"), r("none-old", null, "2026-11-01"), r("overdue", "2026-11-20", "2026-11-18"), r("none-new", null, "2026-11-10"), r("soon", "2026-11-24", "2026-11-22")]);
    expect(sorted.map((x) => x.id)).toEqual(["overdue", "soon", "later", "none-new", "none-old"]);
  });
});
