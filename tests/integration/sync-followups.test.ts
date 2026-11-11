/**
 * Follow-ups after the sync check: Return the cash (note, released or not, nothing else touched, audit,
 * who may), the 5-character note on every review decision, the renamed tick myloans:review_borrower, the
 * "Different branch" line on a replacement suggestion, and the shared hourly count and circuit breaker
 * (several instances, the limit at the boundary, fail safe, console runs in "This hour").
 * Test database (gdfi_dms_test), sample MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { getMyLoansAdapter } from "@/lib/myloans";
import { lookupPn, openLoanFile, MYLOANS_BUSY } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { askCashBack, keepCurrent, linkReplacement, refreshLoan, runMyLoansSync, syncStatus } from "@/lib/services/source-sync";
import { reviewFor, relatedPanel } from "@/lib/services/source-review";
import { setUserBranches } from "@/lib/services/access";
import { callStore, callsThisHour, countCall, DbCallStore, hourKey, lookupPn as clientLookup, resetClient, setCallStore, type CallStore } from "@/lib/myloans/client";
import { DbBreakerStore, ResilientAdapter } from "@/lib/myloans/resilience";
import { SYSTEM_ACTOR } from "@/lib/audit";
import type { MyLoansAdapter, MyLoansLookup, MyLoansRecord } from "@/lib/myloans/types";
import { asUser, cleanLoans } from "./helpers";

const PN = "GD1652026901003";
const sys = { actor: SYSTEM_ACTOR, mode: "MANUAL" as const, trigger: "button" as const };
const SUP = "zz.followup.sup@gdfi.ph";
let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, sup: CurrentUser;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUP" } });
  const u = (await prisma.user.findUnique({ where: { email: SUP } })) ?? (await prisma.user.create({ data: { email: SUP, name: "Zz Followup Sup", roleId: role.id, isTestUser: true } }));
  await setUserBranches(u.id, [(await prisma.branch.findUniqueOrThrow({ where: { code: "165" } })).id]);
  sup = await asUser(SUP);
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  vi.restoreAllMocks();
  await cleanLoans();
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  await setSetting("myloans.hourlyCeiling", 600);
  await setSetting("myloans.paused", false);
  await setSetting("myloans.state", { cursor: null, cap: null, runs: [] });
  resetClient();
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  const u = await prisma.user.findUnique({ where: { email: SUP } });
  if (u) {
    await prisma.userAccessGrant.deleteMany({ where: { userId: u.id } });
    await prisma.userBranch.deleteMany({ where: { userId: u.id } });
    await prisma.auditLog.updateMany({ where: { actorId: u.id }, data: { actorId: null } }).catch(() => null);
    await prisma.user.delete({ where: { id: u.id } }).catch(() => null);
  }
  await prisma.$disconnect();
});

const change = async (pn: string, over: Partial<MyLoansRecord>) => {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setSetting("myloans.mockOverrides", all);
};
/** A loan with ticked Notary papers, PPSR sent (and its job), cancelled in MyLoans: the Status review item. */
async function cancelledWithWork() {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  const notary = await txn("NOTARY");
  await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
  const ppsr = await txn("PPSR");
  await saveChecklist(la, { transactionId: ppsr.id, checkedIds: ppsr.checks.map((c) => c.id), newOthers: [] });
  const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: ppsr.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "YES", fundsKinds: ["TRANSPORT"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: ppsr.id } });
  return { loan, notary, ppsr, job };
}
async function cancel(loanId: string) {
  await change(PN, { status: "STATUS_14", statusId: "14", statusName: "Cancelled" });
  await refreshLoan(loanId, sys);
  return prisma.sourceChange.findFirstOrThrow({ where: { loanId, state: "OPEN", category: "STATUS" } });
}

describe("1. Return the cash", () => {
  it("needs a note; asks for released cash back and for an unreleased request to be denied; touches nothing else; audited; Admin only", async () => {
    const t0 = new Date();
    const { loan, notary, ppsr, job } = await cancelledWithWork();
    // Released (paid out) on PPSR; requested, not released, on Notary.
    const released = await prisma.cashAdvance.create({
      data: {
        number: "CA-2026-9301", requestedById: dp.id, branchId: loan.branchId, status: "RELEASED", requestedCents: 50_000, approvedCents: 50_000, releasedCents: 50_000, releasedAt: new Date(), liquidationDueAt: new Date(Date.now() + 5 * 86_400_000),
        lines: { create: { transactionId: ppsr.id, kind: "TRANSPORT", requestedCents: 50_000, approvedCents: 50_000, releasedCents: 50_000 } },
      },
    });
    // Requested, not released yet (on the Notary transaction).
    const pending = await prisma.cashAdvance.create({
      data: { number: "CA-2026-9302", requestedById: dp.id, branchId: loan.branchId, status: "REQUESTED", requestedCents: 20_000, lines: { create: { transactionId: notary.id, kind: "TRANSPORT", requestedCents: 20_000 } } },
    });
    const item = await cancel(loan.id);
    const before = {
      advances: await prisma.cashAdvance.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, releasedCents: true } }),
      checks: await prisma.checklistCheck.findMany({ where: { transaction: { loanId: loan.id } }, orderBy: { id: "asc" }, select: { id: true, checked: true } }),
      docs: await prisma.documentItem.count({ where: { loanId: loan.id } }),
    };
    // Who may: only those who review MyLoans changes.
    for (const u of [la, dp, sup]) await expect(askCashBack(u, item.id, "Return it please")).rejects.toThrow(/Only Admin reviews/);
    // A note of 5 to 500 characters.
    await expect(askCashBack(admin, item.id)).rejects.toThrow(/at least 5 characters/);
    await expect(askCashBack(admin, item.id, "1234")).rejects.toThrow(/at least 5 characters/);
    await askCashBack(admin, item.id, "Loan cancelled in MyLoans");
    // Released: the processor returns the balance (Finance confirms). Not released: Finance denies it.
    const notes = await prisma.notification.findMany({ where: { loanId: loan.id, title: { contains: "return the cash" }, createdAt: { gte: t0 } } });
    const toDp = notes.filter((n) => n.userId === dp.id);
    expect(toDp.find((n) => n.title.startsWith(released.number))!.body).toMatch(/Return the balance for Entry of PPSR|Return the balance/);
    expect(toDp.find((n) => n.title.startsWith(pending.number))!.body).toMatch(/not released yet: Finance, deny it/);
    // Audit: who, when, the note.
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "source_cash_back_asked", loanId: loan.id, at: { gte: t0 } } });
    expect(a).toMatchObject({ actorId: admin.id, details: { note: "Loan cancelled in MyLoans" } });
    expect(a.summary).toMatch(/Note: Loan cancelled in MyLoans$/);
    expect(a.at.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    // Nothing moved or deleted: advances, ticked papers, papers, the sent job, the review item.
    expect(await prisma.cashAdvance.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, releasedCents: true } })).toEqual(before.advances);
    expect(await prisma.checklistCheck.findMany({ where: { transaction: { loanId: loan.id } }, orderBy: { id: "asc" }, select: { id: true, checked: true } })).toEqual(before.checks);
    expect(await prisma.documentItem.count({ where: { loanId: loan.id } })).toBe(before.docs);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING_ACCEPTANCE");
    expect((await prisma.sourceChange.findUniqueOrThrow({ where: { id: item.id } })).state).toBe("OPEN");
  });

  it("no cash out: refused in plain words", async () => {
    const { loan } = await cancelledWithWork();
    const item = await cancel(loan.id);
    await expect(askCashBack(admin, item.id, "Nothing to return?")).rejects.toThrow("No cash is out on this loan.");
  });
});

describe("2. Every review decision needs a note of 5 to 500 characters", () => {
  it("4 characters refused, 5 accepted (Keep current); 501 refused", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    await change(PN, { totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    const item = await prisma.sourceChange.findFirstOrThrow({ where: { loanId: loan.id, state: "OPEN" } });
    await expect(keepCurrent(admin, item.id, "abcd")).rejects.toThrow("Write a short note (at least 5 characters).");
    await expect(keepCurrent(admin, item.id, "x".repeat(501))).rejects.toThrow("Keep the note under 500 characters.");
    await keepCurrent(admin, item.id, "abcde");
    expect((await prisma.sourceChange.findUniqueOrThrow({ where: { id: item.id } })).state).toBe("KEPT");
  });
});

describe("3. The renamed tick", () => {
  it("every saved role holds myloans:review_borrower, none the old key", async () => {
    const roles = await prisma.role.findMany({ select: { key: true, permissions: true } });
    const old = ["source", "review_borrower"].join(":");
    expect(roles.filter((r) => r.permissions.includes(old)).map((r) => r.key)).toEqual([]);
    for (const k of ["SUP", "ADMIN", "FIN"]) expect(roles.find((r) => r.key === k)!.permissions, k).toContain("myloans:review_borrower");
  });
});

describe("4. Replacement suggestion at another branch: a line, never a block", () => {
  const extra = (pn: string, branchCode: string, branchName: string): MyLoansRecord => ({
    pn, cin: `CIN-${pn}`, cif: "CIF-551003", sourceLoanId: `ML-${pn}`, borrowerName: "Ana Villanueva", branchName, branchCode, status: "RELEASED", statusId: "12", statusName: "Loan Released",
    loanType: "Renewal", productName: "Auto Financing", totalReleasedAmount: 1_000_000, releaseDate: new Date().toISOString().slice(0, 10),
  });

  it("same branch: no line", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const old = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    await setSetting("myloans.mockExtra", [extra("GD1652026909401", "165", "Angono")]);
    await cancel(old.id);
    await openLoanFile(la, { pn: "GD1652026909401", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const r = (await reviewFor(admin, old.id))!;
    expect(r.candidates).toEqual([expect.objectContaining({ pn: "GD1652026909401", differentBranch: null })]);
  });

  it("different branch: 'Different branch: Angono → Antipolo' in the review and the Related loans link form; linking still allowed with a note", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const old = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    await setSetting("myloans.mockExtra", [extra("GD1012026909402", "101", "Antipolo")]);
    const item = await cancel(old.id);
    await openLoanFile(la, { pn: "GD1012026909402", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const r = (await reviewFor(admin, old.id))!;
    expect(r.candidates).toEqual([expect.objectContaining({ pn: "GD1012026909402", differentBranch: "Different branch: Angono → Antipolo" })]);
    const nw = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909402" } });
    expect((await relatedPanel(admin, nw)).rows.find((x) => x.pn === PN)!.differentBranch).toBe("Different branch: Angono → Antipolo");
    await expect(linkReplacement(admin, item.id, { newPn: "GD1012026909402", note: "abc", confirmNoPayment: true })).rejects.toThrow(/at least 5/);
    await linkReplacement(admin, item.id, { newPn: "GD1012026909402", note: "Moved branch with the new PN", confirmNoPayment: true });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909402" } })).replacesPn).toBe(PN);
  });
});

describe("5. The hourly count and the circuit breaker are shared by every instance", () => {
  const fake = (calls: string[], answer: () => MyLoansLookup): MyLoansAdapter => ({
    name: "live", capabilities: { search: false, changedSince: false },
    getByPn: async (pn) => { calls.push(pn); return answer(); },
    search: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }), getChangedSince: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }),
  });

  it("two instances (two stores) add to one count; at the limit, concurrent calls cannot slip past", async () => {
    const a = new DbCallStore(), b = new DbCallStore();
    const hour = hourKey(Date.now());
    await a.add(hour);
    await b.add(hour);
    expect(await a.count(hour)).toBe(2);
    expect(await callsThisHour()).toBe(2);
    // Ceiling 10: 30 calls at the same moment from both instances; exactly 8 more get through.
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reserve(hour, 10)));
    expect(results.filter(Boolean)).toHaveLength(8);
    expect(await callsThisHour()).toBe(10);
  });

  it("the breaker opens on one instance and the other sees it; it closes for both after the wait", async () => {
    let now = Date.now();
    const calls: string[] = [];
    const down = fake(calls, () => ({ ok: false, reason: "UNAVAILABLE", message: "x" }));
    const opts = { retries: 0, breakAfter: 2, openMs: 60_000, now: () => now };
    const one = new ResilientAdapter(down, { ...opts, breaker: new DbBreakerStore() });
    const two = new ResilientAdapter(fake(calls, () => ({ ok: true, record: { pn: "X" } as MyLoansRecord, raw: {}, adapter: "live", retrievedAt: new Date() })), { ...opts, breaker: new DbBreakerStore() });
    await one.getByPn("A");
    expect((await two.breakerState()).open).toBe(false);
    await one.getByPn("A"); // second failure: open, for everyone
    expect((await two.breakerState()).open).toBe(true);
    calls.length = 0;
    expect(await two.getByPn("B")).toMatchObject({ ok: false, message: expect.stringMatching(/several times/) });
    expect(calls).toEqual([]); // not called while open
    now += 61_000;
    expect((await one.breakerState()).open).toBe(false);
    expect((await two.getByPn("B")).ok).toBe(true);
  });

  it("fail safe: when the count cannot be written, no call is made and Find loan says MyLoans is busy", async () => {
    const failing: CallStore = { count: async () => { throw new Error("db down"); }, add: async () => { throw new Error("db down"); }, reserve: async () => { throw new Error("db down"); } };
    const was = setCallStore(failing);
    try {
      const spy = vi.spyOn(getMyLoansAdapter(), "getByPn");
      expect(await lookupPn(la, "GD1652026901004")).toEqual({ kind: "unavailable", pn: "GD1652026901004", message: MYLOANS_BUSY, busy: true });
      const calls: string[] = [];
      expect(await clientLookup(fake(calls, () => ({ ok: false, reason: "NOT_FOUND", message: "" })), "GD1652026901004", { fresh: true })).toMatchObject({ ok: false, limited: true, message: MYLOANS_BUSY });
      expect(calls).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      setCallStore(was);
    }
  });

  it("console-script calls appear in This hour on the Settings card", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    await prisma.loan.update({ where: { pn: PN }, data: { nextCheckAt: new Date(Date.now() - 60_000) } });
    const before = await callsThisHour();
    resetClient();
    const r = await runMyLoansSync({ trigger: "script", force: true });
    expect(r).toMatchObject({ ran: true, calls: 1 });
    expect(await callsThisHour()).toBe(before + 1);
    expect((await syncStatus()).hourCalls).toBe(before + 1);
    expect(callStore()).toBeInstanceOf(DbCallStore);
    // countCall is the same shared count.
    await countCall();
    expect((await syncStatus()).hourCalls).toBe(before + 2);
  });
});
