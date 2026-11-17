// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The file route reads the session; here it is the person under test. The store returns fixed bytes.
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/current-user", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/current-user")>()), getCurrentUser: async () => session.user }));
vi.mock("@/lib/storage/receipts", async (orig) => ({ ...(await orig<typeof import("@/lib/storage/receipts")>()), receiptStore: { get: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), put: async () => "x" } }));

import { prisma } from "@/lib/db";
import { advanceScope, can, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS as P, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { setUserBranches } from "@/lib/services/access";
import { getLoanForUser, listLoans, notificationWhere, unreadNotificationCount } from "@/lib/services/queries";
import { jobRows } from "@/lib/services/job-queries";
import { closeAdvance, decideAdvance, decideCarryOver, decideTopUp, grantException, liquidationReportAccess, releaseAdvance, releaseTopUp } from "@/lib/services/funds";
import { acceptJob, canSeeJob, declineJob, markOutsideControl, raiseProblem, receivePackage, resolveProblem, startStage } from "@/lib/services/jobs";
import { addHoldDetails, raiseHold, resumeHold, transferHold } from "@/lib/services/holds";
import { laChangeLtoOffice } from "@/lib/services/lto";
import { resolveFile } from "@/lib/services/files";
import { GET as fileRoute } from "@/app/api/files/[kind]/[id]/route";
import { DECLINE_REASONS } from "@/lib/ui/rounds";
import { asUser } from "./helpers";

/**
 * D-019 (plan §4 tests): for every built-in role, Finance first, a person whose access is Angono only tries
 * Pasig's records: lists (absent), counts (not counted), details (not found), each action (refused without
 * saying the record exists, and nothing changes) and each file kind (404, and a log row only for an allowed
 * view). A person with no branch sees nothing. Test database only; fake borrowers and PNs.
 */
const P_ = "GD9992099959";
const PN_A = `${P_}01`, PN_B = `${P_}02`;
const E = (k: string) => `zz.xbranch.${k}@gdfi.ph`;
/** Refusals that do not reveal the record (scope first, or the role's tick before any lookup). */
const HIDDEN = /not found|does not allow|your role|only an admin|pick a processor|only the loan associate|ask a superadmin/i;
const REVEALS = /already|assigned to someone else|finished|decided|only .* can resume/i;

let angono: string, pasig: string;
const ids: Record<string, string> = {};
const ROLES = ["FIN", ...Object.keys(ROLE_DEFAULTS).filter((k) => k !== "FIN")];

async function person(key: string, role: string, branchIds: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const u = await prisma.user.create({ data: { email: E(key), name: `Zz Xbranch ${key}`, roleId: r.id, isTestUser: true, allBranches: false, handlesCa: true, handlesFt: true } });
  await setUserBranches(u.id, branchIds);
  return asUser(u.email);
}
async function clean() {
  const lines = { line: { advance: { number: { startsWith: "CA-2099-59" } } } };
  await prisma.receipt.deleteMany({ where: lines });
  await prisma.carryOver.deleteMany({ where: lines });
  await prisma.cashAdvanceTopUp.deleteMany({ where: lines });
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-59" } } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P_ } } });
  await prisma.notification.deleteMany({ where: { user: { email: { startsWith: "zz.xbranch." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.xbranch." } } });
}

/** Calls the real file route as this person; returns the status and how many log rows it added. */
async function openFile(u: CurrentUser | null, kind: string, id: string, field?: string) {
  session.user = u;
  const before = await prisma.fileAccessLog.count({ where: { entityId: { contains: id } } });
  const res = await fileRoute(new Request(`http://local/api/files/${kind}/${id}${field ? `?field=${field}` : ""}`), { params: Promise.resolve({ kind, id }) });
  const after = await prisma.fileAccessLog.count({ where: { entityId: { contains: id } } });
  return { status: res.status, logged: after - before };
}

beforeAll(async () => {
  await clean();
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const dpPasig = await person("dp.pasig", "DP", [pasig]);
  ids.dpPasig = dpPasig.id;
  const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const mk = (pn: string, branchId: string) => prisma.loan.create({
    data: {
      pn, borrowerName: `Zz Xbranch Borrower ${pn.slice(-2)}`, branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist", transactions: { create: { typeId: mortgage.id, status: "IN_PROCESS" } },
    },
    include: { transactions: true },
  });
  const [la, lb] = [await mk(PN_A, angono), await mk(PN_B, pasig)];
  ids.loanA = la.id; ids.loanB = lb.id; ids.txnB = lb.transactions[0].id;

  // Pasig's job: the processor works from the Angono processor branch (the old rule looked at that).
  const job = await prisma.dpAssignment.create({ data: { loanId: lb.id, transactionId: ids.txnB, dpBranchId: angono, dpUserId: dpPasig.id, assignedById: admin.id, status: "ACCEPTED", receivingBranchId: pasig } });
  ids.jobB = job.id;
  const file = (n: string) => ({ file: { key: `${"0".repeat(8)}-0000-0000-0000-0000000000${n}.jpg`, name: `${n}.jpg`, mime: "image/jpeg" } });
  ids.stageB = (await prisma.jobStage.create({ data: { assignmentId: job.id, code: "NOTARY", name: "Notarization", kind: "OWN", sortOrder: 1, evidence: file("01") } })).id;
  ids.ltoB = (await prisma.jobStage.create({ data: { assignmentId: job.id, code: "LTO_DROP", name: "LTO drop off", kind: "LTO_DROP", sortOrder: 2, evidence: file("02") } })).id;

  // Pasig's money: a released advance with a receipt, a top-up to approve and a carry-over to decide.
  const adv = await prisma.cashAdvance.create({
    data: { number: "CA-2099-5901", requestedById: dpPasig.id, branchId: pasig, requestedCents: 100_000, status: "RELEASED", approvedCents: 100_000, approvedAt: new Date(), approvedById: admin.id, releasedCents: 100_000, releasedAt: new Date(), lines: { create: [{ transactionId: ids.txnB, kind: "TRANSPORT", requestedCents: 100_000, approvedCents: 100_000, releasedCents: 100_000 }] } },
    include: { lines: true },
  });
  ids.advB = adv.id;
  const lineId = adv.lines[0].id;
  ids.receiptB = (await prisma.receipt.create({ data: { lineId, date: "2026-11-17", cents: 50_000, number: "OR-1", uploadedById: dpPasig.id, fileKey: file("03").file.key, fileName: "receipt.jpg", mime: "image/jpeg" } })).id;
  ids.topUpB = (await prisma.cashAdvanceTopUp.create({ data: { lineId, extraCents: 5_000, reason: "Test", requestedById: dpPasig.id } })).id;
  ids.carryB = (await prisma.carryOver.create({ data: { lineId, cents: 5_000, status: "PENDING" } })).id;

  // Pasig's open hold and problem.
  const hr = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
  const pr = await prisma.problemReason.findFirstOrThrow({ where: { active: true } });
  ids.holdReason = hr.id; ids.problemReason = pr.id;
  ids.holdB = (await prisma.hold.create({ data: { loanId: lb.id, transactionId: ids.txnB, reasonId: hr.id, reasonName: hr.name, note: "", raisedById: dpPasig.id, raisedByLabel: dpPasig.name, ownerId: dpPasig.id, ownerLabel: dpPasig.name } })).id;
  ids.problemB = (await prisma.problem.create({ data: { loanId: lb.id, transactionId: ids.txnB, reasonId: pr.id, raisedByLabel: "Zz" } })).id;
  ids.office = (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true } })).id;
});
afterAll(clean);

/** What a refused action must look like: refused, and without saying the record exists. */
async function refused(what: string, p: Promise<unknown>) {
  const e = await p.then(() => null, (x: unknown) => x as Error);
  expect(e, `${what} should be refused`).not.toBeNull();
  expect(e!.message, what).toMatch(HIDDEN);
  expect(e!.message, what).not.toMatch(REVEALS);
}

describe("every built-in role, Angono only, against Pasig (D-019); Finance first", () => {
  for (const key of ROLES) {
    it(`${key}: lists, counts, details, actions and files of Pasig are blocked`, async () => {
      const u = await person(`r.${key.toLowerCase()}`, key, [angono]);
      await prisma.notification.createMany({ data: [
        { userId: u.id, loanId: ids.loanB, title: `${PN_B}: an update`, body: "x", link: `/loans/${PN_B}` },
        { userId: u.id, loanId: ids.loanA, title: `${PN_A}: an update`, body: "x", link: `/loans/${PN_A}` },
      ] });

      // Lists: absent.
      if (can(u, P.LOANS_VIEW)) {
        const pns = (await listLoans(u, {} as never)).map((r) => r.pn);
        expect(pns).not.toContain(PN_B);
        expect(pns).toContain(PN_A);
      }
      expect((await prisma.cashAdvance.findMany({ where: { ...advanceScope(u), number: { startsWith: "CA-2099-59" } } }))).toEqual([]);
      expect((await jobRows({ loan: loanScope(u) })).map((r) => r.id)).not.toContain(ids.jobB);
      const notes = await prisma.notification.findMany({ where: notificationWhere(u) });
      expect(notes.map((n) => n.loanId)).toEqual([ids.loanA]);

      // Counts: not counted.
      expect(await prisma.loan.count({ where: { id: ids.loanB, ...loanScope(u) } })).toBe(0);
      expect(await prisma.cashAdvance.count({ where: { id: ids.advB, ...advanceScope(u) } })).toBe(0);
      expect(await unreadNotificationCount(u)).toBe(1);

      // Details: not found.
      expect(await getLoanForUser(u, PN_B)).toBeNull();
      const job = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.jobB }, include: { loan: true } });
      expect(canSeeJob(u, job)).toBe(false);
      expect(liquidationReportAccess(u, { branchId: pasig, status: "LIQUIDATED", lineBranchIds: [pasig] })).toBe("not-found");

      // Actions: refused without revealing the record.
      await refused("approve", decideAdvance(u, ids.advB, { approve: true }));
      await refused("release", releaseAdvance(u, ids.advB, {}));
      await refused("close", closeAdvance(u, ids.advB));
      await refused("approve top-up", decideTopUp(u, ids.topUpB, true, null, ""));
      await refused("release top-up", releaseTopUp(u, ids.topUpB));
      await refused("carry-over", decideCarryOver(u, ids.carryB, true));
      await refused("exception", grantException(u, ids.dpPasig, ""));
      await refused("accept job", acceptJob(u, ids.jobB));
      await refused("decline job", declineJob(u, ids.jobB, { reasons: [DECLINE_REASONS[0]], remarks: "Testing scope" }));
      await refused("start stage", startStage(u, ids.jobB, ids.stageB));
      await refused("receive package", receivePackage(u, ids.jobB, true));
      await refused("raise hold", raiseHold(u, { transactionId: ids.txnB, reasonId: ids.holdReason, note: "Waiting for the borrower" }));
      await refused("resume hold", resumeHold(u, ids.holdB, "Testing scope"));
      await refused("hold details", addHoldDetails(u, ids.holdB, "Testing scope"));
      await refused("transfer hold", transferHold(u, ids.holdB, u.id, "Testing scope"));
      await refused("raise problem", raiseProblem(u, { transactionId: ids.txnB, reasonId: ids.problemReason, note: "Testing scope" }));
      await refused("resolve problem", resolveProblem(u, ids.problemB, "Testing scope"));
      await refused("outside control", markOutsideControl(u, ids.problemB, true));
      await refused("change LTO office", laChangeLtoOffice(u, ids.txnB, { ltoOfficeId: ids.office }));

      // Files: 404 and no log row.
      expect(await resolveFile(u, "receipt", ids.receiptB)).toBeNull();
      expect(await openFile(u, "receipt", ids.receiptB)).toEqual({ status: 404, logged: 0 });
      expect(await openFile(u, "stage", ids.stageB, "file")).toEqual({ status: 404, logged: 0 });
      expect(await openFile(u, "lto-proof", ids.ltoB, "file")).toEqual({ status: 404, logged: 0 });
    });
  }

  it("nothing changed on Pasig's records", async () => {
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: ids.advB } })).toMatchObject({ status: "RELEASED" });
    expect(await prisma.cashAdvanceTopUp.findUniqueOrThrow({ where: { id: ids.topUpB } })).toMatchObject({ status: "REQUESTED" });
    expect(await prisma.carryOver.findUniqueOrThrow({ where: { id: ids.carryB } })).toMatchObject({ status: "PENDING" });
    expect(await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.jobB } })).toMatchObject({ status: "ACCEPTED" });
    expect(await prisma.hold.findUniqueOrThrow({ where: { id: ids.holdB } })).toMatchObject({ resumedAt: null, note: "", ownerId: ids.dpPasig });
    expect(await prisma.problem.findUniqueOrThrow({ where: { id: ids.problemB } })).toMatchObject({ resolvedAt: null, outsideControl: false });
    expect(await prisma.hold.count({ where: { transactionId: ids.txnB } })).toBe(1);
    expect(await prisma.problem.count({ where: { transactionId: ids.txnB } })).toBe(1);
    expect(await prisma.jobStage.findUniqueOrThrow({ where: { id: ids.stageB } })).toMatchObject({ startedAt: null });
  });

  it("an allowed view is served and logged once (All branches); no session is 401", async () => {
    const admin = await asUser("test.admin@gdfi.ph");
    expect(await openFile(admin, "receipt", ids.receiptB)).toEqual({ status: 200, logged: 1 });
    expect(await openFile(admin, "lto-proof", ids.ltoB, "file")).toEqual({ status: 200, logged: 1 });
    // A stage that is not at the LTO is not "LTO proof".
    expect(await openFile(admin, "lto-proof", ids.stageB, "file")).toEqual({ status: 404, logged: 0 });
    expect((await openFile(null, "receipt", ids.receiptB)).status).toBe(401);
  });
});

describe("a person with no branch sees nothing", () => {
  for (const key of ["FIN", "LA", "DP"]) {
    it(`${key} with no branch`, async () => {
      const u = await person(`none.${key.toLowerCase()}`, key, []);
      if (can(u, P.LOANS_VIEW)) expect((await listLoans(u, {} as never)).map((r) => r.pn).filter((pn) => pn.startsWith(P_))).toEqual([]);
      expect(await prisma.loan.count({ where: { pn: { startsWith: P_ }, ...loanScope(u) } })).toBe(0);
      expect(await prisma.cashAdvance.count({ where: { number: { startsWith: "CA-2099-59" }, ...advanceScope(u) } })).toBe(0);
      expect(await getLoanForUser(u, PN_A)).toBeNull();
      expect(await resolveFile(u, "receipt", ids.receiptB)).toBeNull();
    });
  }
});
