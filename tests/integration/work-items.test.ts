/**
 * Piece 9 (D-046): the inbox engine through the same functions the screens use. The six worked examples (Mon-Sat,
 * Nov 2026: Mon 23 ... Mon 30), pool colours, a return needs its reason, Away blocks naming, a move is never late,
 * the first accept wins, migrated rounds are left out of the TAT report. LOCAL test database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, POOL_CHOICE, saveChecklist } from "@/lib/services/workflow";
import { acceptFromPool, takeBackFromPool } from "@/lib/services/dp-pool";
import { acceptWork } from "@/lib/services/inbox";
import { backfillWorkItems } from "@/lib/work/backfill";
import { poolColours, savePoolColours } from "@/lib/services/pool-colours";
import { acceptJob, returnJob } from "@/lib/services/jobs";
import { pullBack } from "@/lib/services/sent-changes";
import { acceptItemTx, arriveItem, closeItem, itemsWithAway, moveItem, myItems, openItem, poolItems, setAway, supervisorWorkCounts, tatByPerson } from "@/lib/services/work-items";
import { setUserBranches } from "@/lib/services/access";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

const PN = "GD1652026901003";
const at = (d: string, h = 9) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+08:00`);
let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, dp2: CurrentUser, branchId: string;

async function clean() {
  await cleanLoans();
  await prisma.workItem.deleteMany({});
  await prisma.user.updateMany({ where: { email: { in: ["test.la@gdfi.ph", "test.dp@gdfi.ph"] } }, data: { awayFrom: null, awayTo: null, awayNote: "" } });
}

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  branchId = (await prisma.branch.findUniqueOrThrow({ where: { code: "165" } })).id;
  await prisma.workItem.deleteMany({});
  await prisma.userBranch.deleteMany({ where: { user: { email: "zz.work.dp2@gdfi.ph" } } });
  await prisma.user.deleteMany({ where: { email: "zz.work.dp2@gdfi.ph" } });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "DP" } });
  const u = await prisma.user.create({ data: { email: "zz.work.dp2@gdfi.ph", name: "Zz Work Second DP", roleId: role.id, isTestUser: true } });
  await setUserBranches(u.id, [branchId]);
  dp2 = await asUser(u.email);
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await clean();
  await setSetting("pool.amberAfterDays", 1);
  await setSetting("pool.redAfterDays", 2);
});
afterAll(async () => {
  await clean();
  await prisma.userBranch.deleteMany({ where: { user: { email: "zz.work.dp2@gdfi.ph" } } });
  await prisma.user.deleteMany({ where: { email: "zz.work.dp2@gdfi.ph" } });
  await prisma.$disconnect();
});

/** Find loan, tick the papers, send the Notary to a processor (today, real time). */
async function send(to: CurrentUser | typeof POOL_CHOICE = dp, pasuyo = false) {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: to === POOL_CHOICE ? POOL_CHOICE : to.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo, secondaryDpUserId: pasuyo ? dp2.id : null, pasuyoReason: pasuyo ? "Near the office" : null });
  const job = await prisma.dpAssignment.findFirst({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn, job: job! };
}
const lastMove = async (itemId: string) => prisma.workMovement.findFirstOrThrow({ where: { workItemId: itemId }, orderBy: { at: "desc" } });
const item = (subjectId: string, label = "Test item") => ({ kind: "TRANSACTION" as const, subjectId, role: "LA" as const, branchId, label });

describe("the six worked examples, through the service (D-046)", () => {
  it("1. accepted the same day: waiting 0; target 1 -> due Tue 24; forwarded Tue 24: used 1, on time", async () => {
    await prisma.$transaction(async (tx) => {
      const it1 = await arriveItem(tx, { ...item("ex1"), holderUserId: la.id, accepted: true, targetDays: 1, at: at("2026-11-23") });
      expect(it1).toMatchObject({ state: "HELD", dueDate: "2026-11-24" });
      await closeItem(tx, "TRANSACTION", "ex1", "FORWARDED", { at: at("2026-11-24", 15) });
      expect(await tx.workMovement.findFirstOrThrow({ where: { workItemId: it1.id, action: "FORWARD" } })).toMatchObject({ waitingDays: 0, tatDaysUsed: 1, isLate: false });
    });
  });

  it("2. waits in the pool Thu 26 -> Sat 28: waiting 2 (not counted); the target starts at accept -> due Mon 30", async () => {
    const it2 = await prisma.$transaction((tx) => arriveItem(tx, { ...item("ex2"), targetDays: 1, at: at("2026-11-26") }));
    expect(it2).toMatchObject({ state: "POOL", dueDate: null });
    const got = await prisma.$transaction((tx) => acceptItemTx(tx, it2.id, la, at("2026-11-28")));
    expect(got).toMatchObject({ state: "HELD", holderUserId: la.id, dueDate: "2026-11-30" });
    expect(await prisma.workMovement.findFirstOrThrow({ where: { workItemId: it2.id, action: "ACCEPT" } })).toMatchObject({ waitingDays: 2 });
  });

  it("3. a pausing hold moves the LA item's due date and the paused days are not used", async () => {
    // The hold engine itself is covered in calendar-due; here the round's numbers: due Sat 28 + 2 paused = Tue 1, used 6 - 2 = 4.
    const { roundResult } = await import("@/lib/work/rules");
    const { daysFor, DEFAULT_WORKING_WEEKDAYS } = await import("@/lib/calendar/core");
    const d = daysFor({ workingWeekdays: DEFAULT_WORKING_WEEKDAYS, entries: [] }, null);
    expect(roundResult({ acceptedDay: "2026-11-23", endDay: "2026-11-30", dueDate: "2026-12-01", pausedDays: 2, outcome: "FORWARDED", days: d })).toEqual({ used: 4, late: false, lateBy: 0 });
  });

  it("4. returned by the processor: a reason is required, the LA gets it in their inbox, and a fresh full target at accept", async () => {
    const { txn, job } = await send();
    const laRound1 = await prisma.workItem.findFirstOrThrow({ where: { kind: "TRANSACTION", subjectId: txn.id, round: 1 } });
    expect(laRound1).toMatchObject({ state: "DONE", outcome: "FORWARDED", holderUserId: la.id });
    expect(await openItem(prisma, "DP_JOB", txn.id)).toMatchObject({ state: "INBOX", holderUserId: dp.id });
    await acceptJob(dp, job.id);
    expect(await openItem(prisma, "DP_JOB", txn.id)).toMatchObject({ state: "HELD" });
    await expect(returnJob(dp, job.id, { reasons: [], remarks: "Missing deed" })).rejects.toThrow(/Pick at least one reason/);
    await returnJob(dp, job.id, { reasons: ["Other"], remarks: "Missing deed" });
    const dpRound = await prisma.workItem.findFirstOrThrow({ where: { kind: "DP_JOB", subjectId: txn.id } });
    expect(dpRound).toMatchObject({ state: "DONE", outcome: "RETURNED", returnReason: "Other" });
    const back = (await openItem(prisma, "TRANSACTION", txn.id))!;
    expect(back).toMatchObject({ round: 2, state: "INBOX", holderUserId: la.id, acceptedAt: null, dueDate: null });
    const accepted = await prisma.$transaction((tx) => acceptItemTx(tx, back.id, la));
    const { roundDue } = await import("@/lib/work/rules");
    const { loadCalendar } = await import("@/lib/calendar/load");
    const { daysFor } = await import("@/lib/calendar/core");
    expect(accepted.dueDate).toBe(roundDue(businessDate(new Date()), back.targetDays!, daysFor(await loadCalendar(), branchId)));
    // The TAT report counts the return against the processor.
    expect((await tatByPerson(admin)).find((r) => r.userId === dp.id && r.measure === "TAT")).toMatchObject({ returns: 1 });
  });

  it("5. two people accept the same pool item at the same moment: the first wins, the other is told who has it", async () => {
    const pool = await prisma.$transaction((tx) => arriveItem(tx, { ...item("ex5"), targetDays: 1 }));
    const tries = await Promise.allSettled([dp, dp2].map((u) => prisma.$transaction((tx) => acceptItemTx(tx, pool.id, u))));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    const lost = tries.find((t) => t.status === "rejected") as PromiseRejectedResult;
    const now = await prisma.workItem.findUniqueOrThrow({ where: { id: pool.id }, include: { holder: true } });
    expect(String(lost.reason.message)).toMatch(new RegExp(`^Already accepted by ${now.holder!.name} at .+\\. It is in their inbox now\\.$`));
    expect(await prisma.workMovement.count({ where: { workItemId: pool.id, action: "ACCEPT" } })).toBe(1);
  });

  it("6. a move closes the old round as Moved (away), never late; the new person starts fresh; the overall due date stays", async () => {
    const { txn, job } = await send();
    await acceptJob(dp, job.id);
    const before = (await openItem(prisma, "DP_JOB", txn.id))!;
    const job0 = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    // Moved weeks after its due date: still not late.
    const later = at("2026-12-28");
    await expect(moveItem(admin, before.id, { userId: dp2.id }, "x", later)).rejects.toThrow(/at least 5 characters/);
    await expect(moveItem(admin, before.id, { pool: true }, "On leave this week", later)).rejects.toThrow(/not put back in the pool/);
    await expect(moveItem(la, before.id, { userId: dp2.id }, "On leave this week", later)).rejects.toThrow(/Move work items/);
    const nextId = await moveItem(admin, before.id, { userId: dp2.id }, "On leave this week", later);
    const old = await prisma.workItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(old).toMatchObject({ state: "DONE", outcome: "MOVED_AWAY" });
    expect(await lastMove(old.id)).toMatchObject({ action: "MOVE", isLate: false });
    const next = await prisma.workItem.findUniqueOrThrow({ where: { id: nextId } });
    expect(next).toMatchObject({ state: "HELD", holderUserId: dp2.id, round: before.round + 1, overallDueDate: before.overallDueDate });
    const job1 = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(job1.dpUserId).toBe(dp2.id);
    expect(job1.dueDate! > job0.dueDate!).toBe(true); // a fresh target from the move
    expect(await prisma.notification.count({ where: { userId: { in: [dp.id, dp2.id] }, title: { contains: "now with Zz Work Second DP" } } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "work_item_moved", entityId: nextId } })).toBe(1);
    // The report: moved rounds are counted as moved, not late.
    const r = (await tatByPerson(admin)).find((x) => x.userId === dp.id && x.measure === "TAT")!;
    expect(r).toMatchObject({ moved: 1, late: 0 });
  });
});

describe("pool, inbox, Away, reports (D-046)", () => {
  it("Find loan: the LA's items arrive accepted (waiting 0) and show in My items; pull back gives the work back at once", async () => {
    const { txn } = await send();
    const mine = await myItems(dp);
    expect(mine.some((r) => r.kind === "DP_JOB" && r.pn === PN && r.state === "INBOX")).toBe(true);
    const laItems = await prisma.workItem.findMany({ where: { kind: "TRANSACTION", pn: PN, round: 1 } });
    expect(laItems.length).toBeGreaterThan(0);
    expect(laItems.every((i) => i.holderUserId === la.id && i.acceptedAt?.getTime() === i.arrivedAt.getTime())).toBe(true);
    await pullBack(la, txn.id, { reason: "Wrong borrower name on the deed" });
    expect((await prisma.workItem.findFirstOrThrow({ where: { kind: "DP_JOB", subjectId: txn.id } })).outcome).toBe("PULLED_BACK");
    expect(await openItem(prisma, "TRANSACTION", txn.id)).toMatchObject({ state: "HELD", holderUserId: la.id, round: 2 });
  });

  it("pool colours follow the settings; the supervisors' Home counts the red ones", async () => {
    const now = new Date();
    const back = (n: number) => new Date(now.getTime() - n * 86_400_000);
    await prisma.$transaction(async (tx) => {
      for (const [k, d] of [["p0", 0], ["p1", 1], ["p5", 5]] as const) await arriveItem(tx, { ...item(k, `Pool ${k}`), at: back(d) });
    });
    const tones = Object.fromEntries((await poolItems(la, now)).map((r) => [r.label, r.poolTone]));
    expect(tones["Pool p0"]).toBe("green");
    expect(tones["Pool p5"]).toBe("red");
    expect((await supervisorWorkCounts(admin, now)).poolTooLong).toBeGreaterThanOrEqual(1);
    await setSetting("pool.redAfterDays", 30);
    await setSetting("pool.amberAfterDays", 30);
    expect((await poolItems(la, now)).every((r) => r.poolTone === "green")).toBe(true);
    expect((await supervisorWorkCounts(admin, now)).poolTooLong).toBe(0);
  });

  it("a return without a reason is refused", async () => {
    await prisma.$transaction((tx) => arriveItem(tx, { ...item("r1"), holderUserId: la.id, accepted: true, targetDays: 1 }));
    await expect(prisma.$transaction((tx) => closeItem(tx, "TRANSACTION", "r1", "RETURNED", { reason: "  " }))).rejects.toThrow("Pick a return reason.");
    expect(await openItem(prisma, "TRANSACTION", "r1")).not.toBeNull();
  });

  it("Away: the person cannot be named for new work; supervisors see the items with them", async () => {
    const { job } = await send();
    const today = businessDate(new Date());
    await expect(setAway(la, dp.id, { from: today, to: today })).rejects.toThrow(/Set who is away/);
    await setAway(dp, dp.id, { from: today, to: today, note: "Sick" });
    expect((await supervisorWorkCounts(admin)).withAway).toBe(1);
    expect((await itemsWithAway(admin)).map((r) => r.holder)).toEqual([dp.name]);
    // A new send to them is refused; and they are not offered in Give to...
    await pullBack(la, job.transactionId, { reason: "Send it to someone else" });
    const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
    await expect(assignToDp(la, { transactionId: job.transactionId, dpBranchId: branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null }))
      .rejects.toThrow(/is away until/);
    await setAway(admin, dp.id, null);
    expect((await supervisorWorkCounts(admin)).withAway).toBe(0);
  });

  it("migrated rounds are left out of the TAT report", async () => {
    const mk = (subjectId: string, migrated: boolean) => prisma.workItem.create({ data: { kind: "TRANSACTION", subjectId, role: "LA", branchId, state: "DONE", outcome: "FORWARDED", holderUserId: la.id, arrivedAt: at("2026-11-23"), acceptedAt: migrated ? null : at("2026-11-23"), doneAt: at("2026-11-24"), migrated, movements: { create: { action: "FORWARD", tatDaysUsed: migrated ? null : 1, isLate: migrated ? null : false } } } });
    await mk("m1", true);
    await mk("m2", true);
    await mk("m3", false);
    expect((await tatByPerson(admin)).find((r) => r.userId === la.id && r.measure === "TAT")).toMatchObject({ rounds: 1, avgUsed: 1 });
  });
});

describe("Branch DP pool (D-046 item 6)", () => {
  it("sent to the pool: no named job yet; every processor of the branch sees it; Pasuyo needs a named processor", async () => {
    await expect(send(POOL_CHOICE, true)).rejects.toThrow(/goes with a named processor/);
    const { txn } = await send(POOL_CHOICE);
    expect(await prisma.dpAssignment.count({ where: { transactionId: txn.id } })).toBe(0);
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("ASSIGNED");
    for (const u of [dp, dp2]) expect((await poolItems(u)).some((r) => r.kind === "DP_JOB" && r.pn === PN)).toBe(true);
    expect((await poolItems(la)).some((r) => r.kind === "DP_JOB")).toBe(false); // not LA work
    expect(await prisma.notification.count({ where: { userId: { in: [dp.id, dp2.id] }, title: { contains: "DP pool" } } })).toBe(2);
  });

  it("two processors accept at the same moment: one gets the normal named job, accepted; the other is told who has it", async () => {
    const { txn } = await send(POOL_CHOICE);
    const it = (await openItem(prisma, "DP_JOB", txn.id))!;
    const tries = await Promise.allSettled([acceptFromPool(dp, it.id), acceptFromPool(dp2, it.id)]);
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    const lost = tries.find((t) => t.status === "rejected") as PromiseRejectedResult;
    const jobs = await prisma.dpAssignment.findMany({ where: { transactionId: txn.id }, include: { dpUser: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "ACCEPTED", assignedById: la.id });
    expect(jobs[0].dueDate).not.toBeNull();
    expect(String(lost.reason.message)).toContain(`Already accepted by ${jobs[0].dpUser.name}`);
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("IN_PROCESS");
    const docs = await prisma.documentItem.findMany({ where: { transactionId: txn.id, documentId: { not: null } } });
    expect(docs.length > 0 && docs.every((d) => d.stage === "WITH_DP")).toBe(true);
    expect(await openItem(prisma, "DP_JOB", txn.id)).toMatchObject({ state: "HELD", holderUserId: jobs[0].dpUserId });
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "accepted" } } })).toBe(1);
  });

  it("the LA takes it back before anyone accepts; after an accept it is refused", async () => {
    const { txn } = await send(POOL_CHOICE);
    await expect(takeBackFromPool(la, txn.id, "x")).rejects.toThrow(/at least 3/);
    await takeBackFromPool(la, txn.id, "Wrong office");
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("READY");
    expect(await openItem(prisma, "TRANSACTION", txn.id)).toMatchObject({ state: "HELD", holderUserId: la.id });
    const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: txn.id, dpBranchId: branchId, dpUserId: POOL_CHOICE, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    await acceptWork(dp, (await openItem(prisma, "DP_JOB", txn.id))!.id);
    await expect(takeBackFromPool(la, txn.id, "Too late")).rejects.toThrow(/already accepted it from the pool/);
  });

  it("Accept on the Inbox runs the job's own Accept for a named processor", async () => {
    const { txn, job } = await send();
    const it = (await openItem(prisma, "DP_JOB", txn.id))!;
    await expect(acceptWork(dp, it.id)).resolves.toBe(`/jobs/${job.id}`);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
  });
});

describe("backfill of existing open work (D-046 item 7)", () => {
  it("makes items from the recorded times, marks the ones with a missing time Migrated, and is safe to run again", async () => {
    const { txn, job } = await send();
    await acceptJob(dp, job.id);
    await prisma.workItem.deleteMany({});
    await prisma.dpAssignment.update({ where: { id: job.id }, data: { decidedAt: null } }); // a missing time
    const first = await backfillWorkItems(prisma);
    expect(first.made).toBeGreaterThan(0);
    const dpItem = (await openItem(prisma, "DP_JOB", txn.id))!;
    expect(dpItem).toMatchObject({ state: "HELD", holderUserId: dp.id, migrated: true });
    const laItem = await prisma.workItem.findFirstOrThrow({ where: { kind: "TRANSACTION", pn: PN } });
    expect(laItem).toMatchObject({ holderUserId: la.id, migrated: false, state: "HELD" });
    const again = await backfillWorkItems(prisma);
    expect(again.made).toBe(0);
    expect(again.skipped).toBe(first.made);
  });
});

describe("Settings, Inbox waiting colours (D-048)", () => {
  it("validated (whole days 1 to 30, red after amber), audited, refused without the tick", async () => {
    await expect(savePoolColours(la, { amber: "1", red: "2" })).rejects.toThrow(/does not allow changing turnaround times/);
    await expect(savePoolColours(admin, { amber: "0", red: "2" })).rejects.toThrow(/from 1 to 30/);
    await expect(savePoolColours(admin, { amber: "2", red: "2" })).rejects.toThrow(/Red comes after amber/);
    await expect(savePoolColours(admin, { amber: "1.5", red: "3" })).rejects.toThrow(/whole number/);
    await expect(savePoolColours(admin, { amber: "2", red: "4" })).resolves.toMatch(/amber after 2 working days, red after 4/);
    expect(await poolColours()).toEqual({ amber: 2, red: 4 });
    expect(await prisma.auditLog.count({ where: { action: "pool_colours_changed" } })).toBeGreaterThan(0);
    await expect(savePoolColours(admin, { amber: "2", red: "4" })).resolves.toBe("No change.");
  });
});

