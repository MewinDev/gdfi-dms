// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { addCalendarEntry, previewEntry, previewWorkingDays } from "@/lib/services/calendar";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { liquidationDueFields } from "@/lib/services/funds";
import { loadCalendar } from "@/lib/calendar/load";
import { addWorkingDays, daysFor } from "@/lib/calendar/core";
import { endOfBusinessDay } from "@/lib/time";
import { asUser } from "./helpers";

/**
 * D-041 with the database: holidays and office closures added late extend the saved due dates whose counting
 * window holds the new day (overdue ones too), logged per item with the owner told; a closure more than 7 days
 * back is refused; a hold whose reason "Pauses TAT" moves the job's due date when it ends. Fake PNs; sample dates.
 */
const P = "GD9992099989";
const NAME = "Zz calendar test";
let admin: CurrentUser, dp: CurrentUser, angono: string, pasig: string;
const at = (d: string, hh = "10:00") => new Date(`${d}T${hh}:00+08:00`);

async function job(n: string, branchId: string, accepted: string, due: string) {
  const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const loan = await prisma.loan.create({
    data: {
      pn: `${P}${n}`, borrowerName: `Zz Cal Borrower ${n}`, branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "In process", transactions: { create: { typeId: mortgage.id, status: "IN_PROCESS" } },
    },
    include: { transactions: true },
  });
  const a = await prisma.dpAssignment.create({ data: { loanId: loan.id, transactionId: loan.transactions[0].id, dpBranchId: branchId, dueBranchId: branchId, dpUserId: dp.id, assignedById: admin.id, status: "ACCEPTED", decidedAt: at(accepted), dueDate: due, targetDays: 1 } });
  return { id: a.id, txn: loan.transactions[0].id };
}
const dueOf = async (id: string) => (await prisma.dpAssignment.findUniqueOrThrow({ where: { id } })).dueDate;

async function clean() {
  const jobs = (await prisma.dpAssignment.findMany({ where: { loan: { pn: { startsWith: P } } }, select: { id: true } })).map((j) => j.id);
  await prisma.dueDateChange.deleteMany({ where: { subjectId: { in: jobs } } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
  await prisma.holidayCalendar.deleteMany({ where: { OR: [{ name: { startsWith: NAME } }, { reason: { startsWith: NAME } }] } });
}

beforeAll(async () => {
  admin = await asUser("test.admin@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  await clean();
});
afterAll(clean);

describe("example 7: a holiday added late (Wed 25 Nov, added on Tue 24)", () => {
  it("X (due 23, overdue) and Y (due 24) unchanged; Z (due 25) to 26 and W (due 27) to 28; preview first", async () => {
    const x = await job("01", angono, "2026-11-20", "2026-11-23");
    const y = await job("02", angono, "2026-11-23", "2026-11-24");
    const z = await job("03", angono, "2026-11-24", "2026-11-25");
    const w = await job("04", angono, "2026-11-24", "2026-11-27");
    const entry = { kind: "HOLIDAY" as const, date: "2026-11-25", name: `${NAME} holiday`, type: "REGULAR" as const, allBranches: true, branchIds: [] };
    const tue = at("2026-11-24", "08:00");
    const pre = await previewEntry(admin, entry, tue);
    const mine = pre.moves.filter((m) => [x.id, y.id, z.id, w.id].includes(m.subjectId));
    expect(mine.map((m) => m.subjectId).sort()).toEqual([z.id, w.id].sort());
    expect(pre.text).toMatch(/^This will extend \d+ items? \(\d+ currently overdue\)\.$/);
    expect(await dueOf(z.id)).toBe("2026-11-25"); // the preview saved nothing
    await addCalendarEntry(admin, entry, tue);
    expect([await dueOf(x.id), await dueOf(y.id), await dueOf(z.id), await dueOf(w.id)]).toEqual(["2026-11-23", "2026-11-24", "2026-11-26", "2026-11-28"]);
    // One logged change per moved item, and its owner told.
    const ch = await prisma.dueDateChange.findMany({ where: { subjectId: { in: [x.id, y.id, z.id, w.id] } } });
    expect(ch.map((c) => [c.fromDate, c.toDate, c.cause])).toEqual(expect.arrayContaining([["2026-11-25", "2026-11-26", "HOLIDAY"], ["2026-11-27", "2026-11-28", "HOLIDAY"]]));
    expect(ch).toHaveLength(2);
    expect(await prisma.notification.count({ where: { userId: dp.id, link: `/jobs/${z.id}`, title: { contains: "due date moved" } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "due_date_extended", entityId: w.id } })).toBe(1);
  });
});

describe("Angono closed Thu 26 Nov, recorded on Fri 27", () => {
  it("an overdue Angono item due Thu 26 becomes due Fri 27 (on time if forwarded Fri 27); a Pasig item is unchanged", async () => {
    const a = await job("11", angono, "2026-11-25", "2026-11-26");
    const p = await job("12", pasig, "2026-11-25", "2026-11-26");
    const fri = at("2026-11-27", "09:00");
    const closure = { kind: "CLOSURE" as const, date: "2026-11-26", name: "", type: "LOCAL" as const, allBranches: false, branchIds: [angono], reason: `${NAME}: typhoon, offices closed` };
    const pre = await previewEntry(admin, closure, fri);
    const m = pre.moves.find((x) => x.subjectId === a.id)!;
    expect(m).toMatchObject({ from: "2026-11-26", to: "2026-11-27", wasOverdue: true });
    expect(pre.moves.some((x) => x.subjectId === p.id)).toBe(false);
    expect(pre.overdue).toBeGreaterThanOrEqual(1);
    await addCalendarEntry(admin, closure, fri);
    expect(await dueOf(a.id)).toBe("2026-11-27");
    expect(await dueOf(p.id)).toBe("2026-11-26");
    const c = await prisma.dueDateChange.findFirstOrThrow({ where: { subjectId: a.id } });
    expect(c).toMatchObject({ cause: "CLOSURE", wasOverdue: true });
    expect(c.note).toContain("typhoon");
  });

  it("a closure 8 days back is refused; 7 days back needs a reason", async () => {
    const fri = at("2026-11-27", "09:00");
    await expect(addCalendarEntry(admin, { kind: "CLOSURE", date: "2026-11-19", allBranches: false, branchIds: [angono], reason: `${NAME}: too old` }, fri)).rejects.toThrow(/up to 7 days back/);
    await expect(addCalendarEntry(admin, { kind: "HOLIDAY", date: "2026-11-20", name: `${NAME} late`, allBranches: true }, fri)).rejects.toThrow(/in the past: say why/);
  });

  it("only someone with Change holidays; a closure needs branches and a reason", async () => {
    const la = await asUser("test.la@gdfi.ph");
    await expect(addCalendarEntry(la, { kind: "CLOSURE", date: "2026-12-30", allBranches: false, branchIds: [angono], reason: `${NAME}: x` })).rejects.toThrow(/Change holidays/);
    await expect(addCalendarEntry(admin, { kind: "CLOSURE", date: "2026-12-30", allBranches: false, branchIds: [], reason: `${NAME}: storm` })).rejects.toThrow(/Tick at least one branch/);
    await expect(addCalendarEntry(admin, { kind: "CLOSURE", date: "2026-12-30", allBranches: false, branchIds: [angono], reason: "" })).rejects.toThrow(/Say why the office is closed/);
  });
});

describe("working days and liquidation follow the same rule", () => {
  it("taking Saturday away would extend the items whose window holds a Saturday (preview only)", async () => {
    const s = await job("21", angono, "2026-12-03", "2026-12-07"); // Thu 3 to Mon 7: Fri, Sat, Mon
    const pre = await previewWorkingDays(admin, [false, true, true, true, true, true, false], at("2026-12-04"));
    expect(pre.moves.find((m) => m.subjectId === s.id)).toMatchObject({ from: "2026-12-07", to: "2026-12-08" });
  });

  it("the liquidation due date counts on the requesting processor's branch calendar and saves its start", async () => {
    const fields = await prisma.$transaction((tx) => liquidationDueFields(tx, angono, at("2026-11-27")));
    const days = daysFor(await loadCalendar(), angono);
    expect(fields.liquidationDueFrom).toBe("2026-11-27");
    expect(fields.liquidationDueAt.getTime()).toBe(endOfBusinessDay(addWorkingDays("2026-11-27", 10, days)).getTime());
  });
});

describe("a hold that pauses TAT moves the saved due date when it ends (example 5)", () => {
  it("hold Wed 25 to Fri 27 with a pausing reason: due Sat 28 becomes Tue 1 Dec, logged with the plain rule", async () => {
    const j = await job("31", pasig, "2026-11-23", "2026-11-28");
    const reason = await prisma.holdReason.findUniqueOrThrow({ where: { code: "CLIENT-PAPERS" } });
    expect(reason.pausesTat).toBe(true); // the default for a reason outside the person's control
    const h = await raiseHold(dp, { transactionId: j.txn, reasonId: reason.id, note: "Waiting for the borrower's papers" }, at("2026-11-25"));
    await resumeHold(dp, h, "Papers arrived", at("2026-11-27", "15:00"));
    expect(await dueOf(j.id)).toBe("2026-12-01");
    const c = await prisma.dueDateChange.findFirstOrThrow({ where: { subjectId: j.id, cause: "HOLD_PAUSE" } });
    expect(c.note).toContain("The day you put it on hold counts; the day you resume doesn't.");
  });

  it("a reason that does not pause TAT leaves the due date alone", async () => {
    const j = await job("32", pasig, "2026-11-23", "2026-11-28");
    const reason = await prisma.holdReason.findUniqueOrThrow({ where: { code: "NO-DP" } });
    expect(reason.pausesTat).toBe(false);
    const h = await raiseHold(dp, { transactionId: j.txn, reasonId: reason.id, note: "No processor free today" }, at("2026-11-25"));
    await resumeHold(dp, h, "A processor is free", at("2026-11-27", "15:00"));
    expect(await dueOf(j.id)).toBe("2026-11-28");
  });
});
