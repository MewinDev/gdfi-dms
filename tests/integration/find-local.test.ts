/**
 * Find a loan, local first: typing searches only the loan files saved in the DMS (zero MyLoans calls);
 * the Find loan button checks the DMS first by exact PN (a saved loan: zero calls, or one background
 * call when the copy is older than the setting); an unsaved full PN costs exactly one call; part of a PN,
 * a CIN, a CIF or a name never calls MyLoans; branch filtering; one loan file per PN under a race.
 * Test database (gdfi_dms_test), sample MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setSetting } from "@/lib/settings";
import { getMyLoansAdapter } from "@/lib/myloans";
import { resetClient } from "@/lib/myloans/client";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { completePn, refreshFoundLoan, savedLoanCard, searchSaved, suggestLoans } from "@/lib/services/find-local";
import { setUserBranches } from "@/lib/services/access";
import { asUser, cleanLoans } from "./helpers";

const ANTIPOLO = "GD1012026901001"; // Maria Santos, Antipolo (101): no questions
const ANGONO = "GD1652026901003"; // Ana Villanueva, Angono (165): the two questions
const UNSAVED = "GD1652026901004"; // Angono, in MyLoans, never opened in these tests
const RACE_EMAIL = "zz.find.race@gdfi.ph";

let la: CurrentUser, la2: CurrentUser, angonoOnly: CurrentUser;
let calls: MockInstance[] = [];
const callCount = () => calls.reduce((n, s) => n + s.mock.calls.length, 0);
const typeOut = async (u: CurrentUser, text: string) => {
  for (let i = 1; i <= text.length; i++) await suggestLoans(u, text.slice(0, i));
};

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  // A second Loan Associate with the same branches, for the race.
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
  const user = (await prisma.user.findUnique({ where: { email: RACE_EMAIL } }))
    ?? (await prisma.user.create({ data: { email: RACE_EMAIL, name: "Zz Race LA", roleId: role.id, isTestUser: true } }));
  const ids = (await prisma.branch.findMany({ where: { code: { in: ["101", "165"] } }, select: { id: true } })).map((b) => b.id);
  await setUserBranches(user.id, ids);
  la2 = await asUser(RACE_EMAIL);
  const angono = await prisma.branch.findUniqueOrThrow({ where: { code: "165" } });
  angonoOnly = { ...la, scopeBranchIds: [angono.id], branchNames: ["Angono"], branchCodes: ["165"] };
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  vi.restoreAllMocks();
  await cleanLoans();
  await setSetting("myloans.refreshOnFindHours", 0);
  await setSetting("myloans.refreshOnOpenMinutes", 15);
  await setSetting("myloans.hourlyCeiling", 600);
  await setSetting("myloans.mockOverrides", {});
  await openLoanFile(la, { pn: ANTIPOLO });
  await openLoanFile(la, { pn: ANGONO, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  resetClient();
  // Spy after the setup: every way the app can ask MyLoans.
  const a = getMyLoansAdapter();
  calls = [vi.spyOn(a, "getByPn"), vi.spyOn(a, "search"), vi.spyOn(a, "getChangedSince")];
});
afterAll(async () => {
  vi.restoreAllMocks();
  await cleanLoans();
  await setSetting("myloans.refreshOnFindHours", 4);
  await setSetting("myloans.mockOverrides", {});
  const u = await prisma.user.findUnique({ where: { email: RACE_EMAIL } });
  if (u) {
    await prisma.userAccessGrant.deleteMany({ where: { userId: u.id } });
    await prisma.userBranch.deleteMany({ where: { userId: u.id } });
    await prisma.auditLog.updateMany({ where: { actorId: u.id }, data: { actorId: null } }).catch(() => null);
    await prisma.user.delete({ where: { id: u.id } }).catch(() => null);
  }
  await prisma.$disconnect();
});

describe("Typing (the dropdown): the DMS only", () => {
  it("many keystroke searches make zero MyLoans calls", async () => {
    await typeOut(la, ANTIPOLO); // part of a PN, then the whole saved PN
    await typeOut(la, UNSAVED); // a whole PN not saved yet
    await typeOut(la, "Maria Santos");
    await typeOut(la, "GD3902026901007"); // in MyLoans, another branch, not saved
    await typeOut(la, "zzzz random text");
    expect(callCount()).toBe(0);
  });

  it("rows: saved loans with the name and stage; at least 3 characters; at most 8", async () => {
    expect(await suggestLoans(la, "GD")).toEqual({ kind: "none" });
    const r = await suggestLoans(la, "GD1");
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") return;
    expect(r.hits.map((h) => h.pn)).toEqual([ANTIPOLO, ANGONO]);
    expect(r.hits[0]).toEqual({ pn: ANTIPOLO, borrowerName: "Maria Santos", stage: expect.any(String) });
    expect(await suggestLoans(la, "maria")).toMatchObject({ kind: "hits", hits: [{ pn: ANTIPOLO }] });
    expect(await suggestLoans(la, "santos")).toMatchObject({ kind: "hits", hits: [{ pn: ANTIPOLO }] }); // part of the name
    expect(await suggestLoans(la, "2026901003")).toMatchObject({ kind: "hits", hits: [{ pn: ANGONO }] }); // part of a PN
  });

  it("a complete PN not saved: one quiet hint; random text or part of an unsaved PN: nothing", async () => {
    expect(await suggestLoans(la, UNSAVED)).toEqual({ kind: "unsaved", pn: UNSAVED });
    expect(await suggestLoans(la, "GD16520269019")).toEqual({ kind: "none" }); // part of a PN that matches no saved loan
    expect(await suggestLoans(la, "zzzz random")).toEqual({ kind: "none" });
    expect(callCount()).toBe(0);
  });

  it("branch filtering: an Angono-only user never sees Antipolo rows, only Outside your branches for its whole PN", async () => {
    const r = await suggestLoans(angonoOnly, "GD1");
    expect(r.kind === "hits" && r.hits.map((h) => h.pn)).toEqual([ANGONO]);
    expect(await suggestLoans(angonoOnly, "Maria")).toEqual({ kind: "none" });
    expect(await suggestLoans(angonoOnly, ANTIPOLO)).toEqual({ kind: "outside", pn: ANTIPOLO });
    expect(await searchSaved(angonoOnly, "GD1", 20)).toHaveLength(1);
    // The button too: refused as outside, no details, no MyLoans call.
    expect(await lookupPn(angonoOnly, ANTIPOLO)).toMatchObject({ kind: "refused", field: "branch", message: "Outside your branch access." });
    expect(await savedLoanCard(angonoOnly, ANTIPOLO)).toBeNull();
    expect(await refreshFoundLoan(angonoOnly, ANTIPOLO)).toEqual({ called: false, changed: false });
    expect(callCount()).toBe(0);
  });
});

describe("Pressing Find loan", () => {
  it("a saved PN with the stale setting 0: zero MyLoans calls; the card has the stage, owner and next step", async () => {
    // Even a copy days old is not refreshed when the setting is 0.
    await prisma.loan.update({ where: { pn: ANTIPOLO }, data: { lastCheckedAt: new Date(Date.now() - 72 * 3_600_000) } });
    expect(await lookupPn(la, ANTIPOLO)).toEqual({ kind: "existing", pn: ANTIPOLO });
    const card = await savedLoanCard(la, ANTIPOLO);
    expect(card).toMatchObject({ pn: ANTIPOLO, borrowerName: "Maria Santos", branchName: "Antipolo", holder: { role: "Owner", name: la.name }, stale: false, changed: false, cancelled: null });
    expect(card!.next).toBeTruthy();
    expect(await refreshFoundLoan(la, ANTIPOLO)).toEqual({ called: false, changed: false });
    expect(callCount()).toBe(0);
  });

  it("a saved PN older than the setting: one background call, once; a change found shows MyLoans changed", async () => {
    await setSetting("myloans.refreshOnFindHours", 4);
    await prisma.loan.update({ where: { pn: ANTIPOLO }, data: { lastCheckedAt: new Date(Date.now() - 5 * 3_600_000) } });
    expect(await lookupPn(la, ANTIPOLO)).toEqual({ kind: "existing", pn: ANTIPOLO });
    expect((await savedLoanCard(la, ANTIPOLO))!.stale).toBe(true);
    expect(callCount()).toBe(0); // showing the card costs nothing
    await setSetting("myloans.mockOverrides", { [ANTIPOLO]: { totalReleasedAmount: 999_000, changedAt: new Date().toISOString() } });
    expect(await refreshFoundLoan(la, ANTIPOLO)).toEqual({ called: true, changed: true });
    expect(callCount()).toBe(1);
    // Audited like the other refreshes; the review item is the existing one.
    expect(await prisma.sourceChange.count({ where: { loan: { pn: ANTIPOLO }, state: "OPEN" } })).toBe(1);
    // Fresh now: a second card (or a second press) makes no call.
    expect((await savedLoanCard(la, ANTIPOLO))!).toMatchObject({ stale: false, changed: true });
    expect(await refreshFoundLoan(la, ANTIPOLO)).toEqual({ called: false, changed: true });
    expect(callCount()).toBe(1);
  });

  it("the stale refresh respects the hourly limit", async () => {
    await setSetting("myloans.refreshOnFindHours", 4);
    await setSetting("myloans.hourlyCeiling", 0);
    await prisma.loan.update({ where: { pn: ANTIPOLO }, data: { lastCheckedAt: new Date(Date.now() - 5 * 3_600_000) } });
    expect(await refreshFoundLoan(la, ANTIPOLO)).toEqual({ called: false, changed: false });
    expect(callCount()).toBe(0);
  });

  it("an unsaved valid PN: exactly one MyLoans call, then the preview", async () => {
    expect(await completePn(UNSAVED)).toBe(UNSAVED);
    expect(await lookupPn(la, UNSAVED)).toMatchObject({ kind: "preview", pn: UNSAVED });
    expect(calls[0].mock.calls).toEqual([[UNSAVED]]);
    expect(callCount()).toBe(1);
  });

  it("the PN without GD: the DMS first (zero calls when saved), MyLoans once when not saved; dashes and spaces are fine", async () => {
    const bare = (pn: string) => pn.slice(2);
    expect(await completePn(bare(ANTIPOLO))).toBe(ANTIPOLO);
    expect(await completePn("101-2026-9-01001")).toBe(ANTIPOLO);
    expect(await completePn("101202690100")).toBeNull(); // one digit short: part of a PN
    // Saved: the card, no call.
    expect(await lookupPn(la, (await completePn(bare(ANTIPOLO)))!)).toEqual({ kind: "existing", pn: ANTIPOLO });
    expect(await suggestLoans(la, bare(ANTIPOLO))).toMatchObject({ kind: "hits", hits: [{ pn: ANTIPOLO }] });
    expect(await suggestLoans(la, "101-2026-9")).toMatchObject({ kind: "hits", hits: [{ pn: ANTIPOLO }] }); // part, with dashes
    expect(callCount()).toBe(0);
    // Not saved: the hint while typing, then exactly one MyLoans call with the full PN.
    expect(await suggestLoans(la, bare(UNSAVED))).toEqual({ kind: "unsaved", pn: UNSAVED });
    expect(await lookupPn(la, (await completePn(bare(UNSAVED)))!)).toMatchObject({ kind: "preview", pn: UNSAVED });
    expect(calls[0].mock.calls).toEqual([[UNSAVED]]);
    expect(callCount()).toBe(1);
  });

  it("part of a PN, a CIN, a CIF or a name: the DMS only, never MyLoans", async () => {
    const saved = await prisma.loan.findUniqueOrThrow({ where: { pn: ANTIPOLO }, select: { cin: true, cif: true } });
    const texts = ["GD101202690", "2026901", "Maria", "Ana Villanueva", saved.cin!, saved.cif!, "nobody at all"];
    for (const t of texts) {
      // The button: not a complete PN, so the page searches the DMS and never calls lookupPn.
      expect(await completePn(t)).toBeNull();
      await searchSaved(la, t, 20);
    }
    expect((await searchSaved(la, saved.cin!, 20)).map((l) => l.pn)).toEqual([ANTIPOLO]);
    expect((await searchSaved(la, saved.cif!, 20)).map((l) => l.pn)).toEqual([ANTIPOLO]);
    expect(await searchSaved(la, "nobody at all", 20)).toEqual([]);
    expect(callCount()).toBe(0);
  });

  it("a cancelled loan replaced by another: the card says so and names the replacement", async () => {
    await prisma.loan.update({ where: { pn: ANTIPOLO }, data: { cancelledAt: new Date(), cancelReason: `Replaced by ${ANGONO}`, replacedByPn: ANGONO, syncTier: null } });
    await setSetting("myloans.refreshOnFindHours", 4);
    await prisma.loan.update({ where: { pn: ANTIPOLO }, data: { lastCheckedAt: new Date(Date.now() - 5 * 3_600_000) } });
    const card = await savedLoanCard(la, ANTIPOLO);
    expect(card).toMatchObject({ cancelled: { reason: `Replaced by ${ANGONO}` }, replacedByPn: ANGONO, stale: false });
    expect(card!.next).toBe("Nothing to do: the loan was cancelled.");
    expect(await refreshFoundLoan(la, ANTIPOLO)).toMatchObject({ called: false }); // cancelled loans are never refreshed
    expect(callCount()).toBe(0);
  });
});

describe("Find loan on a PN MyLoans has not released: a status card, never a loan file", () => {
  const CASES = [
    { pn: "GD1652026901008", statusKind: "before_release", statusName: "Check Prepared", borrowerName: "Roberto Cruz", branchName: "Angono" },
    { pn: "GD1652026901012", statusKind: "before_release", statusName: "For Approval (Loan Released)", borrowerName: "Gloria Navarro", branchName: "Angono" },
    { pn: "GD1652026901014", statusKind: "before_release", statusName: "Check Assignment (Transaction)", borrowerName: "Rosa Dizon", branchName: "Angono" },
    { pn: "GD1012026901013", statusKind: "cancelled", statusName: "Cancelled", borrowerName: "Andres Lim", branchName: "Antipolo" },
  ] as const;
  const noCopy = async (pn: string) => {
    expect(await prisma.loan.count({ where: { pn } })).toBe(0);
    expect(await prisma.loanSourceSnapshot.count({ where: { loan: { pn } } })).toBe(0);
  };

  for (const c of CASES) {
    it(`${c.pn} (${c.statusName}): the card with the real name; one call; nothing saved; Open refuses`, async () => {
      expect(await lookupPn(la, c.pn)).toMatchObject({ kind: "status", pn: c.pn, statusKind: c.statusKind, statusName: c.statusName, borrowerName: c.borrowerName, branchName: c.branchName });
      expect(callCount()).toBe(1);
      // The card shown again (a reload within the short cache time): no second call.
      await lookupPn(la, c.pn);
      expect(callCount()).toBe(1);
      await noCopy(c.pn);
      await expect(openLoanFile(la, { pn: c.pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" })).rejects.toThrow(/Not yet released/);
      await noCopy(c.pn);
    });
  }

  it("status 15 (a disbursement-check record) and a PN with no row: 'No loan with this PN was found in MyLoans.'", async () => {
    for (const pn of ["GD1652026901015", "GD1012026999999"]) {
      expect(await lookupPn(la, pn)).toEqual({ kind: "not_found", pn, message: "No loan with this PN was found in MyLoans." });
      await expect(openLoanFile(la, { pn })).rejects.toThrow();
      await noCopy(pn);
    }
  });

  it("outside the person's branches: the outside message with the PN and branch only, never the name (decided 12 November 2026)", async () => {
    const r = await lookupPn(angonoOnly, "GD1012026901013");
    expect(r).toMatchObject({ kind: "refused", field: "branch", message: "Outside your branch access.", record: { pn: "GD1012026901013", borrowerName: "", branchName: "Antipolo", status: null, loanType: null, productName: null, totalReleasedAmount: null, releaseDate: null, cin: null, cif: null } });
    await noCopy("GD1012026901013");
  });

  it("typing a non-released PN makes no call (it is not saved: only the quiet hint)", async () => {
    await typeOut(la, "GD1652026901008");
    expect(await suggestLoans(la, "GD1652026901008")).toEqual({ kind: "unsaved", pn: "GD1652026901008" });
    expect(callCount()).toBe(0);
  });
});

describe("One loan file per PN", () => {
  it("two Loan Associates press Open loan file on the same new PN at the same moment: one file; the second lands on it", async () => {
    vi.restoreAllMocks();
    // Both presses pass the "already open?" check before either saves: each waits at its MyLoans call
    // until the other has arrived, so both really try to save the same PN (the unique rule decides).
    const a = getMyLoansAdapter();
    const real = a.getByPn.bind(a);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(a, "getByPn").mockImplementation(async (pn: string) => { if (++arrived === 2) release(); await gate; return real(pn); });
    const picks = { financingType: "NON_UNDERTAKING" as const, orcrStatus: "TRANSFERRED" as const };
    const r = await Promise.all([openLoanFile(la, { pn: UNSAVED, ...picks }), openLoanFile(la2, { pn: UNSAVED, ...picks })]);
    expect(await prisma.loan.count({ where: { pn: UNSAVED } })).toBe(1);
    const loanId = (await prisma.loan.findUniqueOrThrow({ where: { pn: UNSAVED } })).id;
    expect(await prisma.auditLog.count({ where: { loanId, action: "loan_file_opened" } })).toBe(1);
    const won = r.filter((x) => !x.alreadyOpen);
    const lost = r.filter((x) => x.alreadyOpen);
    expect(won).toHaveLength(1);
    expect(lost).toEqual([{ pn: UNSAVED, alreadyOpen: true, byOther: true }]);
    // Pressing it again yourself is not "someone else".
    const mine = (await prisma.loan.findUniqueOrThrow({ where: { pn: UNSAVED } })).openedById === la.id ? la : la2;
    expect(await openLoanFile(mine, { pn: UNSAVED, ...picks })).toEqual({ pn: UNSAVED, alreadyOpen: true, byOther: false });
  });
});
