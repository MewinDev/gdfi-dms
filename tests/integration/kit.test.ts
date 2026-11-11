/**
 * The Manual Test Kit, for real, on the TEST database (gdfi_dms_test) with a scratch folder: the CLEAN
 * kit (the default: accounts, branches, settings, 44 PNs in the sample MyLoans, no work data), then the
 * kit WITH SCENARIOS (--with-scenarios: every sample in the scenarios sheet exists), change data, backup,
 * reset, restore a backup, the out-of-date refusal, dates moved on restore, the last 5 automatic backups.
 * The test database is saved first and put back at the end, so the other tests keep their data.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { businessDate, businessDaysBetween } from "@/lib/time";
import { openLoanFile } from "@/lib/services/loan-file";
import { setKitConfigForTests, kitConfig, KIT_DATABASES, OUT_OF_DATE } from "@/lib/kit/guard";
import { autoBackup, baselineStatus, buildBaseline, FIRST_CLEAN_BACKUP, listSaves, loadedKit, readManifest, restoreSave, saveDump } from "@/lib/kit/core";
import { buildSamples } from "@/lib/kit/build";
import { buildClean, CLEAN_EMPTY_TABLES } from "@/lib/kit/build-clean";
import { APPROVER_ROLES, CLEAN_ACCOUNTS, CLEAN_POOL, poolHeading } from "@/lib/kit/clean";
import { getMyLoansAdapter } from "@/lib/myloans";
import { KIT_ACCOUNTS, KIT_BRANCH_CHANGES, KIT_L1, KIT_LOANS, KIT_OTHER_SAMPLES, KIT_REPLACEMENT_PN } from "@/lib/kit/catalog";
import { shiftBusinessDays } from "@/lib/kit/rebase";
import { examplePn, parsePn } from "@/lib/pn/format";
import { asUser } from "./helpers";

const DIR = path.join("storage", `kit-test-${process.pid}`);
const quiet = () => {};
const counts = async () => ({
  loans: await prisma.loan.count(), transactions: await prisma.loanTransaction.count(), jobs: await prisma.dpAssignment.count(),
  holds: await prisma.hold.count(), advances: await prisma.cashAdvance.count(), users: await prisma.user.count(), audit: await prisma.auditLog.count(),
});
/** Before any kit step: drop this test's own connections (the kit closes the others). */
const fresh = () => prisma.$disconnect();

beforeAll(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  setKitConfigForTests({ databases: ["gdfi_dms_test"], dir: DIR });
  await fresh();
  saveDump("it-before", "backup", quiet); // the other tests' data, put back in afterAll
}, 120_000);

afterAll(async () => {
  await fresh();
  try {
    restoreSave("it-before", quiet, { autoBackup: false });
  } finally {
    setKitConfigForTests({ databases: KIT_DATABASES, dir: "storage/kit" });
    rmSync(DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}, 300_000);

describe("Manual Test Kit on the test database", () => {
  it("clean kit (the default): accounts, branches and settings, 44 fresh PNs, no work data", async () => {
    await fresh();
    const m = await buildBaseline(quiet, { variant: "clean", samples: () => buildClean(quiet) });
    expect(m).toMatchObject({ name: "baseline-clean", kind: "baseline", variant: "clean", loanFiles: 0 });
    expect(baselineStatus("clean")).toMatchObject({ upToDate: true });
    expect(loadedKit()?.variant).toBe("clean");
    // The first wipe for a clean kit took the before-clean-kit backup.
    expect(readManifest(FIRST_CLEAN_BACKUP)).toMatchObject({ kind: "backup" });

    // Work data: none. The audit log has the one "kit started" line.
    for (const t of CLEAN_EMPTY_TABLES) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
      expect(n, t).toBe(0);
    }
    expect((await prisma.auditLog.findMany()).map((a) => a.action)).toEqual(["kit_started"]);

    // Every account: role, branch access, active; the inactive LA inactive.
    const users = await prisma.user.findMany({ include: { role: true, homeBranch: true } });
    expect(users).toHaveLength(CLEAN_ACCOUNTS.length);
    const codesOf = async (email: string) => (await prisma.userBranch.findMany({ where: { user: { email } }, include: { branch: true } })).map((x) => x.branch.code).sort();
    const l1 = (await prisma.branch.findMany({ where: { area: { name: KIT_L1.area }, division: { name: KIT_L1.division } } })).map((b) => b.code!).sort();
    const roleName: Record<string, string> = { SUPERVISOR: "Branch Supervisor", LA_NO_REFRESH: "LA (no refresh)", APPROVER_SMALL: APPROVER_ROLES.small.name, APPROVER_LARGE: APPROVER_ROLES.large.name,
      FIN_CA: "Finance (cash advance)", FIN_FT: "Finance (fund transfer)", APPR_CA: "Approver (cash advance)", APPR_FT: "Approver (fund transfer)" };
    for (const a of CLEAN_ACCOUNTS) {
      const u = users.find((x) => x.email === a.email);
      expect(u, a.email).toBeTruthy();
      expect(u!.name).toBe(a.name);
      expect(u!.isTestUser).toBe(true);
      expect(u!.active, a.email).toBe(!a.inactive);
      if (roleName[a.role]) expect(u!.role.name, a.email).toBe(roleName[a.role]);
      else expect(u!.role.key, a.email).toBe(a.role);
      if (a.branches === "ALL") expect(u!.allBranches, a.email).toBe(true);
      else if (!a.access) expect(await codesOf(a.email), a.email).toEqual([...a.branches].sort());
    }
    expect(await codesOf("kit.area.supervisor@example.test")).toEqual([...new Set([...l1, "390"])].sort());
    expect(await codesOf("kit.la.luzon1@example.test")).toEqual(l1.filter((c) => c !== "174"));
    expect(users.find((u) => u.email === "kit.la.luzon1@example.test")!.homeBranch?.code).toBe("165");
    // The two approver bands, the same amounts for each funds type; each type's own approver shares both.
    const bands = await prisma.approvalBand.findMany({ include: { role: true } });
    for (const [t, own] of [["fundstype_ca", "Approver (cash advance)"], ["fundstype_ft", "Approver (fund transfer)"]]) {
      expect(bands.filter((b) => b.fundsTypeId === t).map((b) => `${b.fromCents} ${b.role.name}`).sort(), t).toEqual(
        [`0 ${APPROVER_ROLES.small.name}`, `0 ${own}`, `${APPROVER_ROLES.large.fromCents} ${APPROVER_ROLES.large.name}`, `${APPROVER_ROLES.large.fromCents} ${own}`].sort());
    }
    // Alicia-Inactive is inactive; the expense kinds and the funds types are there.
    expect((await prisma.branch.findUniqueOrThrow({ where: { code: "718" } })).active).toBe(false);
    expect(await prisma.expenseKind.count()).toBeGreaterThanOrEqual(5);
    expect(await prisma.fundsType.count()).toBeGreaterThanOrEqual(2);

    // The pool: 44 distinct PNs in the real format, found by the sample MyLoans, none opened.
    const pns = CLEAN_POOL.map((l) => l.pn);
    expect(pns).toHaveLength(44);
    expect(new Set(pns).size).toBe(44);
    for (const pn of pns) {
      expect(parsePn(pn).ok, pn).toBe(true);
      expect(/^GD\d{3}20269030\d{2}$/.test(pn), pn).toBe(true); // the new 9-03xxx range
      expect((await getMyLoansAdapter().getByPn(pn)).ok, pn).toBe(true);
    }
    expect(await prisma.loan.count()).toBe(0);
    const by = (h: string) => CLEAN_POOL.filter((l) => poolHeading(l) === h).length;
    expect(by("Antipolo (101)")).toBeGreaterThanOrEqual(8);
    expect(by("Angono (165)")).toBeGreaterThanOrEqual(8);
    expect(by("A. Mabini (168)")).toBe(6);
    expect(by("Alaminos (390)")).toBe(6);

    // A tester's first steps: opening a PN makes a fresh loan file; the special PNs behave as the answers say.
    const tryOpen = async (email: string, pn: string) => { try { await openLoanFile(await asUser(email), { pn }); return "opened"; } catch (e) { return e instanceof Error ? e.message : String(e); } };
    const outcomes: Record<string, string> = {
      plain: await tryOpen("kit.la.antipolo@example.test", "GD1012026903001"),
      unknownCode: await tryOpen("kit.la.antipolo@example.test", "GD7772026903011"),
      inactive: await tryOpen("kit.la.roving@example.test", "GD7182026903040"),
      luzonExcluded: await tryOpen("kit.la.luzon1@example.test", "GD1742026903032"),
      // (Vitest has the built-in branch subset, not the real list: the access checks use its branches.)
      luzonAngono: await tryOpen("kit.la.luzon1@example.test", "GD1652026903016"),
      antipoloAtAngono: await tryOpen("kit.la.antipolo@example.test", "GD1652026903017"),
      alaminosByLuzon: await tryOpen("kit.la.luzon1@example.test", "GD3902026903031"),
      alaminosByArea: await tryOpen("kit.area.supervisor@example.test", "GD3902026903031"),
      alaminosByRoving: await tryOpen("kit.la.roving@example.test", "GD3902026903031"),
    };
    expect(outcomes.plain).toBe("opened");
    // The answers file says exactly this.
    expect(outcomes.unknownCode, "777 in the PN, MyLoans says Antipolo").toBe("opened");
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD7772026903011" }, include: { branch: true } })).branch.code).toBe("101");
    expect(outcomes.inactive).toBe("Alicia-Inactive is inactive in Settings, so no new loan files can be opened for it.");
    expect(outcomes.luzonExcluded, "LA Luzon 1 at Amang Rodriguez").toBe("Outside your branch access.");
    expect(outcomes.luzonAngono, "LA Luzon 1 at Angono").toBe("opened");
    expect(outcomes.antipoloAtAngono, "LA Antipolo at Angono").toBe("Outside your branch access.");
    expect(outcomes.alaminosByLuzon, "LA Luzon 1 at Alaminos").toBe("Outside your branch access.");
    expect(outcomes.alaminosByArea, "Area Supervisor at Alaminos").toBe("Your role does not allow opening loan files.");
    expect(outcomes.alaminosByRoving, "Roving LA at Alaminos").toBe("opened");
    expect(await prisma.branchReview.count()).toBe(0); // opening the PNs made no review item
    const opened = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026903001" }, include: { transactions: true } });
    expect(opened.transactions.length).toBeGreaterThan(0); // what rules 1 to 4 create on opening, nothing more
    expect(await prisma.dpAssignment.count()).toBe(0);
    expect(await prisma.cashAdvance.count()).toBe(0);
  }, 600_000);

  it("start with scenarios: builds the starting state through the app's services and saves the baseline", async () => {
    await fresh();
    const m = await buildBaseline(quiet, { variant: "scenarios", samples: () => buildSamples(quiet) });
    expect(m).toMatchObject({ name: "baseline", kind: "baseline", variant: "scenarios", database: "gdfi_dms_test", savedOn: businessDate(new Date()) });
    expect(loadedKit()?.variant).toBe("scenarios");
    expect(m.loanFiles).toBe(KIT_LOANS.filter((l) => l.opened).length);
    expect(existsSync(path.join(DIR, "baseline.dump"))).toBe(true);
    expect(baselineStatus("scenarios")).toMatchObject({ upToDate: true });

    // Every sample account: @example.test, the inactive one inactive; no seed test users.
    const users = await prisma.user.findMany({ include: { role: true, branches: true } });
    for (const a of KIT_ACCOUNTS) {
      const u = users.find((x) => x.email === a.email);
      expect(u, a.email).toBeTruthy();
      expect(u!.isTestUser).toBe(true);
      expect(u!.active).toBe(!a.inactive);
      // Branch access: All (no rows), single branches, whole areas and exceptions.
      if (a.branches === "ALL") expect(u!.allBranches, a.email).toBe(true);
      else expect(u!.branches.length, a.email).toBeGreaterThanOrEqual(a.branches.length);
    }
    const codesOf = async (email: string) => (await prisma.userBranch.findMany({ where: { user: { email } }, include: { branch: true } })).map((x) => x.branch.code).sort();
    const l1 = (await prisma.branch.findMany({ where: { area: { name: KIT_L1.area }, division: { name: KIT_L1.division } } })).map((b) => b.code!).sort();
    expect(await codesOf("kit.area.supervisor@example.test")).toEqual([...l1, "390"].sort());
    expect(await codesOf("kit.la.luzon1@example.test")).toEqual(l1.filter((c) => c !== "174"));
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "kit.la.luzon1@example.test" }, include: { homeBranch: true } })).homeBranch?.code).toBe("165");
    expect(await prisma.userBranch.count({ where: { user: { email: "kit.la.roving@example.test" } } })).toBe(0);
    expect(users.every((u) => u.email.endsWith("@example.test"))).toBe(true);
    expect((await prisma.role.findFirstOrThrow({ where: { name: "Branch Supervisor" } })).permissions).toContain("holds:transfer");
    // The supervisors use the built-in Branch Supervisor role (migration 20261119090006_decisions_batch), not a kit-made one.
    expect((await prisma.role.findFirstOrThrow({ where: { name: "Branch Supervisor" } })).key).toBe("SUP");
    expect(await prisma.role.count({ where: { name: "Branch Supervisor" } })).toBe(1);
    // The email switch stays Not active.
    expect(await getSetting("email.active")).toBe(false);

    // Every loan of the catalog: opened ones are loan files, the others are only in the sample MyLoans.
    const pns = new Set((await prisma.loan.findMany({ select: { pn: true } })).map((l) => l.pn));
    const source = new Set((await getSetting("myloans.mockExtra")).map((r) => r.pn));
    for (const l of KIT_LOANS) {
      expect(source.has(l.pn), `${l.pn} in the sample MyLoans`).toBe(true);
      expect(pns.has(l.pn), `${l.pn} opened`).toBe(l.opened);
    }
    expect(source.has(KIT_REPLACEMENT_PN)).toBe(true);
    expect(pns.has(KIT_REPLACEMENT_PN)).toBe(false);

    // A sample of the cases is in the state the test sheet says.
    const job = async (pn: string, code: string) => prisma.dpAssignment.findFirstOrThrow({ where: { loan: { pn }, transaction: { type: { code } } }, orderBy: { createdAt: "desc" } });
    expect((await job("GD1012026902015", "NOTARY")).status).toBe("PENDING_ACCEPTANCE");
    expect((await job("GD1012026902016", "NOTARY")).status).toBe("PENDING_ACCEPTANCE");
    expect((await job("GD1012026902019", "NOTARY")).status).toBe("DECLINED");
    expect(await prisma.hold.count({ where: { loan: { pn: "GD1012026902013" }, resumedAt: null } })).toBe(2);
    const adv = async (pn: string) => (await prisma.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transaction: { loan: { pn } } } } } })).status;
    expect(await adv("GD1012026902031")).toBe("REQUESTED");
    expect(await adv("GD1012026902032")).toBe("APPROVED");
    expect(await adv("GD1012026902033")).toBe("RELEASED");
    expect((await prisma.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transaction: { loan: { pn: "GD1012026902034" } } } } } })).overdueNotifiedAt).not.toBeNull();
    expect(await adv("GD1012026902035")).toBe("LIQUIDATED");
    expect(await adv("GD1012026902036")).toBe("CLOSED");
    // Fund transfers in the same states, with the type and the transfer details.
    const ft = async (pn: string) => prisma.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transaction: { loan: { pn } } } } } });
    for (const [pn, status] of [["GD1012026902051", "REQUESTED"], ["GD1012026902052", "APPROVED"], ["GD1012026902053", "RELEASED"], ["GD1012026902054", "LIQUIDATED"], ["GD1012026902055", "CLOSED"], ["GD1012026902056", "RELEASED"], ["GD1012026902057", "RELEASED"]] as const) {
      expect(await ft(pn), pn).toMatchObject({ status, fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });
    }
    expect(await ft("GD1012026902053")).toMatchObject({ accountProvider: "BPI", accountLast4: "4821" });
    expect((await ft("GD1012026902057")).overdueNotifiedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "funds_type_changed", entityId: (await ft("GD1012026902052")).id } })).toBe(1);
    expect((await prisma.cashAdvance.findMany()).filter((a) => a.fundsTypeCode === "CA").length).toBeGreaterThan(0);
    // Numbers follow the type: FT- for every fund transfer, CA- for every cash advance; the one changed to a
    // fund transfer keeps its CA- number as "Formerly".
    for (const a of await prisma.cashAdvance.findMany()) expect(a.number, a.number).toMatch(new RegExp(`^${a.fundsTypeCode}-[0-9]{4}-[0-9]{4}$`));
    expect((await ft("GD1012026902052")).formerNumbers).toEqual([expect.stringMatching(/^CA-\d{4}-\d{4}$/)]);
    // Expense kinds: two "Other: Courier" expenses (the suggestion block shows once a third is typed).
    expect((await prisma.cashAdvanceLine.findMany({ where: { kind: "OTHER" } })).map((l) => l.otherDescription)).toEqual(KIT_OTHER_SAMPLES.map((o) => o.description));
    expect((await prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1012026902028" }, type: { code: "NOTARY" } } })).status).toBe("COMPLETED");
    // MyLoans: material, status and replacement wait for Admin review; a minor change updates the copy by itself.
    for (const pn of ["GD1012026902042", "GD1012026902043", "GD1012026902044"]) expect(await prisma.sourceChange.count({ where: { loan: { pn }, state: "OPEN" } }), pn).toBe(1);
    // Borrower details (name, address, contact): their own review item, the loan keeps the old name.
    expect(await prisma.sourceChange.count({ where: { loan: { pn: "GD1012026902041" }, state: "OPEN", category: "BORROWER" } })).toBe(1);
    // Branches: a branch change waiting, one applied (opened at Antipolo, now at Angono), an open loan at
    // a branch MyLoans closed, a rename and a code change waiting in the Branch review.
    const moved = await prisma.sourceChange.findFirstOrThrow({ where: { loan: { pn: "GD1012026902071" }, state: "OPEN" } });
    expect((moved.changes as { field: string }[]).map((c) => c.field)).toEqual(expect.arrayContaining(["branchName", "branchCode"]));
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026902072" }, include: { branch: true } })).branch.code).toBe("165");
    const closed = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD7182026902073" }, include: { branch: true } });
    expect(closed.branch).toMatchObject({ code: "718", active: false });
    const open = await prisma.branchReview.findMany({ where: { state: "OPEN" } });
    expect(open.map((r) => `${r.kind} ${r.code}`)).toEqual(expect.arrayContaining(["RENAMED 174", `CODE_CHANGED ${KIT_BRANCH_CHANGES.code.to}`]));
    expect(await prisma.loan.findUnique({ where: { pn: "GD7772026902070" } })).toBeNull();
    // Monitoring: capacity and leave, finished jobs with different times, an overdue job, three advisories.
    const dp3 = await prisma.user.findUniqueOrThrow({ where: { email: "kit.dp3@example.test" } });
    const dp4 = await prisma.user.findUniqueOrThrow({ where: { email: "kit.dp4@example.test" } });
    expect(dp3).toMatchObject({ dpOnLeave: true });
    expect(dp3.dpLeaveUntil! > businessDate(new Date())).toBe(true);
    expect(dp4).toMatchObject({ dpCapacity: 5, dpOnLeave: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "kit.monitor@example.test" }, include: { role: true } })).role.key).toBe("MONITOR");
    for (const pn of ["GD1012026902060", "GD1012026902061", "GD1682026902062"]) expect((await job(pn, "NOTARY")).status, pn).toBe("CLOSED");
    expect((await job("GD1682026902063", "NOTARY")).status).toBe("PENDING_ACCEPTANCE");
    const finished = await prisma.jobStage.findFirstOrThrow({ where: { kind: "VERIFY", assignment: { loan: { pn: "GD1012026902060" } } } });
    expect(businessDate(finished.finishedAt!) < businessDate(new Date())).toBe(true); // finished on an earlier business day
    const advisories = await prisma.ltoAdvisory.findMany({ include: { ltoOffice: true } });
    expect(advisories).toHaveLength(3);
    expect(advisories.filter((a) => a.resolvedAt)).toHaveLength(1);
    expect(advisories.filter((a) => !a.resolvedAt && Date.now() - a.startedAt.getTime() > 24 * 3_600_000).map((a) => a.ltoOffice.code)).toEqual(["LTO-CEB"]);
    // Release dates: N business days before today (TAT cases).
    const holidays = new Set((await prisma.holidayCalendar.findMany()).map((h) => h.date));
    const late = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026902040" } });
    expect(businessDate(late.releasedAt)).toBe(shiftBusinessDays(businessDate(new Date()), -4, holidays));
  }, 600_000);

  it("the tester sheet lists the 44 PNs by branch and nothing about them; the answers file covers each one", () => {
    const sheet = readFileSync(path.join("docs", "MANUAL-TEST-KIT.md"), "utf8");
    const inSheet = sheet.match(/\bGD\d{13}\b/g) ?? [];
    expect([...inSheet].sort()).toEqual(CLEAN_POOL.map((l) => l.pn).sort()); // each PN once, no other PN
    // Under its branch heading, each line just the PN.
    for (const l of CLEAN_POOL) {
      const at = sheet.indexOf(l.pn);
      const heading = sheet.slice(0, at).match(/^### (.+)$/gm)?.at(-1)?.slice(4);
      expect(heading, l.pn).toBe(poolHeading(l));
      expect(sheet.split(/\r?\n/).find((x) => x.includes(l.pn))!.replace(/^[-*]\s*`?|`?\s*$/g, "")).toBe(l.pn);
      expect(sheet.includes(l.borrower), `${l.pn} borrower must not be on the sheet`).toBe(false);
    }
    // Every account of the clean kit is on the sheet, with its role and branch access.
    for (const a of CLEAN_ACCOUNTS) expect(sheet.split(/\r?\n/).some((x) => x.startsWith(`| ${a.name} | ${a.roleLabel} | ${a.accessLabel} |`)), a.name).toBe(true);
    expect(sheet).toContain("MANUAL-TEST-KIT-ANSWERS.md");
    const answers = readFileSync(path.join("docs", "MANUAL-TEST-KIT-ANSWERS.md"), "utf8");
    for (const l of CLEAN_POOL) expect(answers.includes(l.pn), `${l.pn} in the answers`).toBe(true);
  });

  it("every PN in the scenarios sheet is a sample of the kit with scenarios, and every sample is in it", () => {
    const sheet = readFileSync(path.join("docs", "MANUAL-TEST-KIT-SCENARIOS.md"), "utf8");
    // Every real-format PN except the format example and the deliberately wrong ones of the PN cases.
    const inSheet = new Set((sheet.match(/\bGD\d{13}\b/g) ?? []).filter((pn) => pn !== examplePn() && parsePn(pn).ok));
    // The old to new PN table lists every old sample PN (PN-0002001 ...).
    const old = new Set(sheet.match(/PN-\d{7}/g) ?? []);
    expect(KIT_LOANS.filter((l) => l.oldPn.startsWith("PN-") && !old.has(l.oldPn)).map((l) => l.oldPn)).toEqual([]);
    const kit = new Set([...KIT_LOANS.map((l) => l.pn), KIT_REPLACEMENT_PN]);
    expect([...inSheet].filter((p) => !kit.has(p))).toEqual([]);
    expect([...kit].filter((p) => !inSheet.has(p))).toEqual([]);
  });

  it("change data, back up, reset to the baseline, restore the backup", async () => {
    const start = await counts();
    const la = await asUser("kit.la1@example.test");
    await openLoanFile(la, { pn: "GD1012026902050" });
    await prisma.$disconnect();
    saveDump("after-open", "backup", quiet);
    expect(await prisma.loan.count()).toBe(start.loans + 1);

    await fresh();
    restoreSave("baseline", quiet);
    expect(await counts()).toEqual(start);
    expect(await prisma.loan.findUnique({ where: { pn: "GD1012026902050" } })).toBeNull();
    expect(await prisma.hold.count({ where: { loan: { pn: "GD1012026902013" }, resumedAt: null } })).toBe(2);
    // The reset took an automatic backup first.
    expect(listSaves().filter((s) => s.kind === "auto").length).toBeGreaterThan(0);

    await fresh();
    restoreSave("after-open", quiet);
    expect(await prisma.loan.findUnique({ where: { pn: "GD1012026902050" } })).not.toBeNull();
    expect(await prisma.loan.count()).toBe(start.loans + 1);
  }, 600_000);

  it("refuses an out-of-date baseline and does nothing", async () => {
    const file = path.join(DIR, "baseline.json");
    const saved = readFileSync(file, "utf8");
    const before = await prisma.loan.count();
    try {
      writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), migrations: ["20260101000000_old"] }));
      expect(baselineStatus("scenarios")).toMatchObject({ upToDate: false });
      await fresh();
      expect(() => restoreSave("baseline", quiet)).toThrow(OUT_OF_DATE);
      expect(await prisma.loan.count()).toBe(before);
    } finally {
      writeFileSync(file, saved);
    }
  });

  it("moves the dates by business days when the save is older; holidays stay", async () => {
    const file = path.join(DIR, "baseline.json");
    const saved = readFileSync(file, "utf8");
    const m = JSON.parse(saved);
    const holidays = new Set((await prisma.holidayCalendar.findMany()).map((h) => h.date));
    const today = businessDate(new Date());
    try {
      // As if the baseline was saved 3 business days ago: every date moves by the business days from then to today.
      const savedOn = shiftBusinessDays(today, -3, holidays);
      const shift = businessDaysBetween(savedOn, today, holidays);
      writeFileSync(file, JSON.stringify({ ...m, savedOn }));
      const holidayCount = await prisma.holidayCalendar.count();
      await fresh();
      restoreSave("baseline", quiet, { autoBackup: false });
      const late = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026902040" } });
      expect(businessDate(late.releasedAt)).toBe(shiftBusinessDays(shiftBusinessDays(today, -4, holidays), shift, holidays));
      expect(await prisma.holidayCalendar.count()).toBe(holidayCount);
      expect(readManifest("baseline")?.savedOn).toBe(savedOn);
    } finally {
      writeFileSync(file, saved);
    }
  }, 300_000);

  it("keeps only the last 5 automatic backups", async () => {
    await fresh();
    for (let i = 0; i < 6; i++) {
      autoBackup(quiet);
      await new Promise((r) => setTimeout(r, 1100)); // names are per second
    }
    expect(listSaves().filter((s) => s.kind === "auto")).toHaveLength(5);
    expect(kitConfig.dir).toBe(DIR);
  }, 300_000);
});
