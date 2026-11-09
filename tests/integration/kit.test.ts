/**
 * The Manual Test Kit, for real, on the TEST database (gdfi_dms_test) with a scratch folder: start
 * (build the baseline), every sample in the test sheet exists, change data, backup, reset, restore a
 * backup, the out-of-date refusal, dates moved on restore, the last 5 automatic backups. The test
 * database is saved first and put back at the end, so the other tests keep their data.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { businessDate, businessDaysBetween } from "@/lib/time";
import { openLoanFile } from "@/lib/services/loan-file";
import { setKitConfigForTests, kitConfig, KIT_DATABASES, OUT_OF_DATE } from "@/lib/kit/guard";
import { autoBackup, baselineStatus, buildBaseline, listSaves, readManifest, restoreSave, saveDump } from "@/lib/kit/core";
import { buildSamples } from "@/lib/kit/build";
import { KIT_ACCOUNTS, KIT_BRANCH_CHANGES, KIT_L1, KIT_LOANS, KIT_REPLACEMENT_PN } from "@/lib/kit/catalog";
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
  it("start: builds the starting state through the app's services and saves the baseline", async () => {
    await fresh();
    const m = await buildBaseline(quiet, { samples: () => buildSamples(quiet) });
    expect(m).toMatchObject({ name: "baseline", kind: "baseline", database: "gdfi_dms_test", savedOn: businessDate(new Date()) });
    expect(m.loanFiles).toBe(KIT_LOANS.filter((l) => l.opened).length);
    expect(existsSync(path.join(DIR, "baseline.dump"))).toBe(true);
    expect(baselineStatus()).toMatchObject({ upToDate: true });

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
    expect((await prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1012026902028" }, type: { code: "NOTARY" } } })).status).toBe("COMPLETED");
    // MyLoans: material, status and replacement wait for Admin review; a minor change updates the copy by itself.
    for (const pn of ["GD1012026902042", "GD1012026902043", "GD1012026902044"]) expect(await prisma.sourceChange.count({ where: { loan: { pn }, state: "OPEN" } }), pn).toBe(1);
    expect(await prisma.auditLog.count({ where: { pn: "GD1012026902041", action: "source_minor_updated" } })).toBe(1);
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
    expect(finished.finishedAt!.getTime()).toBeLessThan(Date.now() - 86_400_000);
    const advisories = await prisma.ltoAdvisory.findMany({ include: { ltoOffice: true } });
    expect(advisories).toHaveLength(3);
    expect(advisories.filter((a) => a.resolvedAt)).toHaveLength(1);
    expect(advisories.filter((a) => !a.resolvedAt && Date.now() - a.startedAt.getTime() > 24 * 3_600_000).map((a) => a.ltoOffice.code)).toEqual(["LTO-CEB"]);
    // Release dates: N business days before today (TAT cases).
    const holidays = new Set((await prisma.holidayCalendar.findMany()).map((h) => h.date));
    const late = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026902040" } });
    expect(businessDate(late.releasedAt)).toBe(shiftBusinessDays(businessDate(new Date()), -4, holidays));
  }, 600_000);

  it("every PN in the test sheet is a sample of the kit, and every sample is in the test sheet", () => {
    const sheet = readFileSync(path.join("docs", "MANUAL-TEST-KIT.md"), "utf8");
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
      expect(baselineStatus()).toMatchObject({ upToDate: false });
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
