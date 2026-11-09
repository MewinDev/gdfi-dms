/**
 * Branches from MyLoans: Import from MyLoans (preview, confirm), the API run, the Branch review (each kind,
 * Accept and Ignore), "same branch, code changed", Hide from DMS, read-only MyLoans fields, permissions,
 * and a large import. Synthetic branches only (codes and MyLoans ids no real branch has), removed at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { BUILTIN_BRANCHES } from "@/lib/branches/builtin";
import type { MyLoansBranchRow } from "@/lib/branches/file";
import {
  acceptReview, confirmBranchFile, ignoreReview, linkSameBranch, previewBranchFile, reportUnknownBranchCode, reviewImpact, reviewRows, runBranchSync, setBranchHidden,
} from "@/lib/services/branches";
import { writeUserAccess } from "@/lib/services/access";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { checkImport, runImport } from "@/lib/import/importer";
import { asUser } from "./helpers";

const t0 = new Date();
let admin: CurrentUser, la: CurrentUser, dp: CurrentUser, fin: CurrentUser;
const savedSync = { value: null as unknown };
const savedMock = { value: null as unknown };

const Z = { divisionId: 990, divisionName: "Z Test Division", areaName: "Z Area One", areaId: 991, address: "", active: null, updatedAt: null };
const zrow = (n: number, o: Partial<MyLoansBranchRow> = {}): MyLoansBranchRow => ({ ...Z, branchId: 99000 + n, code: String(800 + n), name: `Z Branch ${n}`, ...o });
const HEAD = "division_id,division,area_id,area,branch_id,code,name,address,is_active";
const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: MyLoansBranchRow[], withIds = true) => [
  withIds ? HEAD : "division,area,code,name,address,is_active",
  ...rows.map((r) => (withIds
    ? [r.divisionId ?? "", r.divisionName, r.areaId ?? "", r.areaName, r.branchId ?? "", r.code, r.name, r.address, r.active === null ? "" : r.active ? "Active" : "Inactive"]
    : [r.divisionName, r.areaName, r.code, r.name, r.address, r.active === null ? "" : r.active ? "Active" : "Inactive"]).map((v) => q(String(v))).join(",")),
].join("\n");
const builtin = BUILTIN_BRANCHES;
const byCode = (code: string) => prisma.branch.findUniqueOrThrow({ where: { code } });
const open = async () => (await reviewRows("OPEN")).filter((r) => r.title.startsWith("Z ") || /\(8\d\d\)/.test(r.title));

async function loanAt(branchId: string, pn: string) {
  return prisma.loan.create({
    data: {
      pn, borrowerName: "Z Branch Test", branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED",
      retrievedAt: new Date(), openedById: admin.id, classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "branches test", stage: "For checklist",
    },
  });
}

beforeAll(async () => {
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  savedSync.value = await getSetting("branches.sync");
  savedMock.value = await getSetting("myloans.mockBranches");
  // No background refresh from an unknown code during the tests.
  await setSetting("branches.sync", { time: "02:00", paused: false, lastRunDate: null, lastSuccessAt: null, lastFullAt: null, lastLookupAt: new Date().toISOString() });
});

afterAll(async () => {
  const made = await prisma.branch.findMany({ where: { OR: [{ createdAt: { gte: t0 } }, { myloansBranchId: { gte: 99000 } }] }, select: { id: true } });
  const ids = made.map((b) => b.id);
  const zUsers = (await prisma.user.findMany({ where: { email: { startsWith: "zz.branches" } }, select: { id: true } })).map((u) => u.id);
  await prisma.loan.deleteMany({ where: { borrowerName: "Z Branch Test" } });
  await prisma.branchReview.deleteMany({ where: { OR: [{ firstSeenAt: { gte: t0 } }, { branchId: { in: ids } }] } });
  await prisma.userAccessGrant.deleteMany({ where: { OR: [{ userId: { in: zUsers } }, { branchId: { in: ids } }] } });
  await prisma.userBranch.deleteMany({ where: { OR: [{ userId: { in: zUsers } }, { branchId: { in: ids } }] } });
  await prisma.user.updateMany({ where: { homeBranchId: { in: ids } }, data: { homeBranchId: null } });
  await prisma.user.deleteMany({ where: { id: { in: zUsers } } });
  await prisma.branch.deleteMany({ where: { id: { in: ids } } });
  await prisma.area.deleteMany({ where: { createdAt: { gte: t0 } } });
  await prisma.division.deleteMany({ where: { createdAt: { gte: t0 } } });
  await prisma.branchSyncRun.deleteMany({ where: { at: { gte: t0 } } });
  // Built-in branches back to the seed (the read-only test changes the LTO office of 101).
  await prisma.branch.updateMany({ where: { code: { in: builtin.map((b) => b.code) } }, data: { hidden: false, hiddenAt: null, hiddenById: null } });
  await setSetting("branches.sync", savedSync.value as never);
  await setSetting("myloans.mockBranches", savedMock.value as never);
});

describe("Import from MyLoans: preview and confirm", () => {
  it("the preview lists New, Unchanged and Not in this file, and saves nothing", async () => {
    const before = await prisma.branch.count();
    const p = await previewBranchFile(admin, csv([...builtin.slice(1), zrow(1), zrow(2), zrow(3), zrow(4), zrow(5), zrow(6), zrow(7, { active: false })]), "z.csv");
    expect(p.diff.counts).toMatchObject({ new: 7, changed: 0, unchanged: 11, missing: 1 });
    expect(p.diff.missing.map((m) => m.code)).toEqual(["101"]);
    expect(p.diff.newGroups.map((g) => g.name).sort()).toEqual(["Z Area One", "Z Test Division"]);
    expect(p.diff.perGroup.find((g) => g.area === "Z Area One")).toMatchObject({ division: "Z Test Division", total: 7, new: 7 });
    expect(await prisma.branch.count()).toBe(before);
    expect(await prisma.branchReview.count({ where: { firstSeenAt: { gte: t0 } } })).toBe(0);
  });

  it("confirm applies what the preview showed, leaves the unticked row and the missing branch in the review, deletes nothing", async () => {
    const text = csv([...builtin.slice(1), zrow(1), zrow(2), zrow(3), zrow(4), zrow(5), zrow(6), zrow(7, { active: false })]);
    const p = await previewBranchFile(admin, text, "z.csv");
    const r = await confirmBranchFile(admin, text, "z.csv", p.fingerprint, { leave: ["805"] });
    expect(r).toMatchObject({ applied: 6, left: 1, missing: 1, unchanged: 11 });
    expect((await byCode("801")).source).toBe("MYLOANS");
    expect((await byCode("807")).active).toBe(false);
    expect(await prisma.branch.findUnique({ where: { code: "805" } })).toBeNull();
    expect((await byCode("101")).active).toBe(true); // not in the file: never deleted, never switched off by itself
    const acc = await prisma.branchReview.findMany({ where: { runId: r.runId, state: "ACCEPTED" } });
    expect(acc.map((x) => x.code).sort()).toEqual(["801", "802", "803", "804", "806", "807"]);
    const items = await reviewRows("OPEN");
    expect(items.find((x) => x.code === "805")?.kind).toBe("NEW_BRANCH");
    expect(items.find((x) => x.code === "101")?.kind).toBe("NOT_IN_LIST");
    // A stale preview is refused.
    await expect(confirmBranchFile(admin, text, "z.csv", p.fingerprint)).rejects.toThrow(/changed since the preview/);
    // Tidy: the missing Antipolo is ignored (it is in MyLoans).
    await ignoreReview(admin, items.find((x) => x.code === "101")!.id, "Still in MyLoans");
  });

  it("test-looking rows: imported inactive unless switched on, hidden only when Admin ticks it", async () => {
    const text = csv([...builtin, zrow(1), zrow(2), zrow(3), zrow(4), zrow(6), zrow(7, { active: false }), zrow(9, { name: "Z Test Branch", code: "899" }), zrow(10, { name: "Z Old (DONT USE)", code: "898" })]);
    const p = await previewBranchFile(admin, text, "z.csv");
    expect(p.diff.items.slice(0, 2).every((i) => i.suggestHide)).toBe(true);
    await confirmBranchFile(admin, text, "z.csv", p.fingerprint, { activate: ["898"], hide: ["899"] });
    expect(await byCode("899")).toMatchObject({ active: false, hidden: true, note: "Looks like a test or unused branch" });
    expect(await byCode("898")).toMatchObject({ active: true, hidden: false });
  });
});

describe("Branches from MyLoans (API) and the Branch review", () => {
  it("every difference goes to the review; nothing changes until accepted", async () => {
    const loan = await loanAt((await byCode("802")).id, "GD8022026900001");
    await setSetting("myloans.mockBranches", {
      overrides: {},
      extra: [
        zrow(1, { name: "Z Branch 1 Renamed" }), zrow(2, { code: "812" }), zrow(3, { areaId: 992, areaName: "Z Area Two" }), zrow(4, { active: false }),
        zrow(5), zrow(7, { active: true }), zrow(9, { name: "Z Test Branch", code: "899" }), zrow(10, { name: "Z Old (DONT USE)", code: "898" }),
      ],
    });
    const r = await runBranchSync({ trigger: "api", user: admin, mode: "full" });
    expect(r?.ok).toBe(true);
    const items = await open();
    const kinds = Object.fromEntries(items.map((i) => [i.code, i.kind]));
    expect(kinds).toMatchObject({ "801": "RENAMED", "812": "CODE_CHANGED", "803": "MOVED", "804": "CLOSED", "805": "NEW_BRANCH", "807": "REOPENED", "806": "NOT_IN_LIST" });
    expect((await byCode("801")).name).toBe("Z Branch 1");
    expect((await byCode("802")).id).toBe(loan.branchId);
    const run = await prisma.branchSyncRun.findUniqueOrThrow({ where: { id: r!.runId! } });
    expect(run).toMatchObject({ trigger: "api", mode: "FULL", ok: true, newCount: 1, missingCount: 1 });
  });

  it("Ignore leaves the DMS as it is (Renamed, Closed)", async () => {
    const items = await open();
    await ignoreReview(admin, items.find((i) => i.code === "801")!.id, "");
    await ignoreReview(admin, items.find((i) => i.code === "804")!.id, "Checked with MyLoans");
    expect((await byCode("801")).name).toBe("Z Branch 1");
    expect((await byCode("804")).active).toBe(true);
    const decided = await reviewRows("DECIDED");
    expect(decided.find((d) => d.code === "804")).toMatchObject({ state: "IGNORED", note: "Checked with MyLoans", decidedByLabel: admin.name });
  });

  it("Code changed is matched by the MyLoans id: Accept keeps the same branch (and its loans)", async () => {
    const before = await byCode("802");
    const item = (await open()).find((i) => i.code === "812")!;
    await acceptReview(admin, item.id);
    const after = await byCode("812");
    expect(after.id).toBe(before.id);
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD8022026900001" } })).branchId).toBe(before.id);
    await expect(acceptReview(admin, item.id)).rejects.toThrow(/already decided/);
  });

  it("Area or division changed: the impact names who gains or loses access; Accept rebuilds the access", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    const u = await prisma.user.create({ data: { email: "zz.branches.la@gdfi.ph", name: "Zz Area Two LA", roleId: role.id, isTestUser: true } });
    const area2 = await prisma.area.findUniqueOrThrow({ where: { myloansId: 992 } }).catch(() => null);
    // The area does not exist yet (the review creates it): give the grant on Z Area One and see the loss.
    const area1 = await prisma.area.findUniqueOrThrow({ where: { myloansId: 991 } });
    const div = await prisma.division.findUniqueOrThrow({ where: { myloansId: 990 } });
    expect(area2).toBeNull();
    await prisma.$transaction((tx) => writeUserAccess(tx, u.id, { all: false, grants: [{ kind: "AREA", divisionId: div.id, areaId: area1.id, branchId: null, exclude: false }], homeBranchId: null }));
    const b803 = await byCode("803");
    expect(await prisma.userBranch.count({ where: { userId: u.id, branchId: b803.id } })).toBe(1);
    const item = (await open()).find((i) => i.code === "803")!;
    const impact = await reviewImpact(item.id);
    expect(impact.text).toMatch(/1 person loses access: Zz Area Two LA\./);
    await acceptReview(admin, item.id);
    expect((await byCode("803")).areaId).toBe((await prisma.area.findUniqueOrThrow({ where: { myloansId: 992 } })).id);
    expect(await prisma.userBranch.count({ where: { userId: u.id, branchId: b803.id } })).toBe(0);
  });

  it("Reopened, New branch and Not in the last list: Accept applies; the missing branch is switched off, never deleted", async () => {
    const items = await open();
    await acceptReview(admin, items.find((i) => i.code === "807")!.id);
    expect((await byCode("807")).active).toBe(true);
    await acceptReview(admin, items.find((i) => i.code === "805")!.id);
    expect((await byCode("805")).source).toBe("MYLOANS");
    const missing = items.find((i) => i.code === "806")!;
    await loanAt((await byCode("806")).id, "GD8062026900001");
    expect((await reviewImpact(missing.id)).text).toMatch(/still has \d+ active users? and 1 open loan file/);
    await acceptReview(admin, missing.id);
    expect(await byCode("806")).toMatchObject({ active: false });
  });

  it("the next run asks again about an ignored change; Closed and Renamed can then be accepted", async () => {
    await runBranchSync({ trigger: "api", user: admin, mode: "full" });
    const items = await open();
    await acceptReview(admin, items.find((i) => i.code === "801")!.id);
    await acceptReview(admin, items.find((i) => i.code === "804")!.id);
    expect((await byCode("801")).name).toBe("Z Branch 1 Renamed");
    expect((await byCode("804")).active).toBe(false);
  });

  it("an unknown branch code seen in a PN: the review says so; Accept adds a DMS branch", async () => {
    await reportUnknownBranchCode("877", "GD8772026900001", "Z Brand New Branch");
    await reportUnknownBranchCode("877", "GD8772026900002", "Z Brand New Branch");
    const item = (await reviewRows("OPEN")).find((i) => i.kind === "UNKNOWN_CODE" && i.code === "877")!;
    expect(item.pn).toBe("GD8772026900002");
    expect((await reviewRows("OPEN")).filter((i) => i.code === "877")).toHaveLength(1);
    await acceptReview(admin, item.id);
    expect(await byCode("877")).toMatchObject({ name: "Z Brand New Branch", source: "DMS" });
    // A code the DMS has is not reported.
    await reportUnknownBranchCode("877", "GD8772026900003", null);
    expect((await reviewRows("OPEN")).filter((i) => i.code === "877")).toHaveLength(0);
  });
});

describe("Same branch, code changed (a source without MyLoans ids)", () => {
  it("links the new row to the branch not in the list: the old id, its loans and history stay", async () => {
    const old = await byCode("898");
    const loan = await loanAt(old.id, "GD8982026900001");
    // A full list without ids, where 898 now comes as 897 with another name.
    const rows = [...builtin, zrow(1, { name: "Z Branch 1 Renamed" }), zrow(2, { code: "812" }), zrow(3, { areaId: 992, areaName: "Z Area Two" }), zrow(4, { active: false }), zrow(5), zrow(6), zrow(7), zrow(9, { name: "Z Test Branch", code: "899" }), zrow(10, { name: "Z Old Renumbered", code: "897" })]
      .map((r) => ({ ...r, branchId: null, divisionId: null, areaId: null }));
    const text = csv(rows, false);
    const p = await previewBranchFile(admin, text, "noids.csv");
    expect(p.diff.missing.map((m) => m.code)).toContain("898");
    await confirmBranchFile(admin, text, "noids.csv", p.fingerprint, { leave: rows.filter((r) => r.code === "897").map((r) => r.code) });
    const items = await reviewRows("OPEN");
    const fresh = items.find((i) => i.kind === "NEW_BRANCH" && i.code === "897")!;
    expect(fresh.linkable.map((l) => l.code)).toContain("898");
    await linkSameBranch(admin, fresh.id, old.id);
    const after = await byCode("897");
    expect(after.id).toBe(old.id);
    expect(after.name).toBe("Z Old Renumbered");
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).branchId).toBe(old.id);
    expect((await reviewRows("DECIDED")).filter((d) => d.note?.startsWith("Same branch, code changed")).length).toBe(2);
  });
});

describe("Hide from DMS, read-only MyLoans fields, permissions", () => {
  it("hide survives a re-import", async () => {
    const b = await byCode("801");
    await setBranchHidden(admin, b.id, true);
    const text = csv([...builtin, zrow(1, { name: "Z Branch 1 Again" })]);
    const p = await previewBranchFile(admin, text, "z.csv");
    await confirmBranchFile(admin, text, "z.csv", p.fingerprint);
    expect(await byCode("801")).toMatchObject({ hidden: true, name: "Z Branch 1 Again" });
    await setBranchHidden(admin, b.id, false);
  });

  it("a MyLoans branch: code, name, area, division, address and status are read-only; the usual LTO office is not", async () => {
    const b = await byCode("101");
    const base = { code: b.code, name: b.name, address: b.address, divisionId: b.divisionId, areaId: b.areaId, usualLtoOfficeId: b.usualLtoOfficeId ?? "" };
    await expect(saveSettingsRow(admin, "branch", b.id, { ...base, name: "Antipolo City" })).rejects.toThrow(/comes from MyLoans/);
    await expect(saveSettingsRow(admin, "branch", b.id, { ...base, code: "102" })).rejects.toThrow(/comes from MyLoans/);
    await expect(setRowActive(admin, "branch", b.id, false)).rejects.toThrow(/comes from MyLoans/);
    const east = await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-EAST" } });
    await saveSettingsRow(admin, "branch", b.id, { ...base, usualLtoOfficeId: east.id });
    expect((await byCode("101")).usualLtoOfficeId).toBe(east.id);
    await saveSettingsRow(admin, "branch", b.id, base);
  });

  it("a branch made in the DMS is fully editable; its code must be 3 digits and unique", async () => {
    await expect(saveSettingsRow(admin, "branch", null, { code: "", name: "Z Manual" })).rejects.toThrow(/3-digit/);
    await expect(saveSettingsRow(admin, "branch", null, { code: "12", name: "Z Manual" })).rejects.toThrow(/3 digits/);
    await expect(saveSettingsRow(admin, "branch", null, { code: "101", name: "Z Manual" })).rejects.toThrow(/already used/);
    await saveSettingsRow(admin, "branch", null, { code: "876", name: "Z Manual" });
    const m = await byCode("876");
    expect(m.source).toBe("DMS");
    const area = await prisma.area.findUniqueOrThrow({ where: { myloansId: 991 } });
    await expect(saveSettingsRow(admin, "branch", m.id, { code: "875", name: "Z Manual 2", areaId: area.id })).rejects.toThrow(/division/);
    const div = await prisma.division.findUniqueOrThrow({ where: { myloansId: 990 } });
    await saveSettingsRow(admin, "branch", m.id, { code: "875", name: "Z Manual 2", address: "Somewhere", divisionId: div.id, areaId: area.id });
    expect(await prisma.branch.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ code: "875", name: "Z Manual 2", areaId: area.id });
    await setRowActive(admin, "branch", m.id, false);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: m.id } })).active).toBe(false);
  });

  it("Branches Import / Export: MyLoans fields refused, the LTO office allowed, a DMS branch updated", async () => {
    const text = [
      "code,name,division,area,address,usual_lto_office,status,notes",
      "101,Antipolo City,Branch Division,LUZON 1 (NGMA + RIZAL),,LTO-QC,Active,",
      "165,Angono,Branch Division,LUZON 1 (NGMA + RIZAL),,LTO-EAST,Active,",
      "875,Z Manual 3,Z Test Division,Z Area One,Somewhere,,Inactive,",
      "874,Z Manual 4,,Nowhere Area,,,Active,",
      "AB,Z Bad,,,,,Active,",
    ].join("\n");
    const plan = await checkImport(admin, "branches", "b.csv", text);
    if (!plan.ok) throw new Error(plan.error);
    const by = (k: string) => plan.rows.find((r) => r.cells.code === k)!;
    expect(by("101").problems.join(" ")).toMatch(/comes from MyLoans/);
    expect(by("165")).toMatchObject({ action: "changed", changes: ["Usual LTO office"] });
    expect(by("875")).toMatchObject({ action: "changed" });
    expect(by("874").problems.join(" ")).toMatch(/no area is called/);
    expect(by("AB").problems.join(" ")).toMatch(/3 digits/);
    const ok = text.split("\n").filter((l) => !/^(101|874|AB),/.test(l)).join("\n");
    const done = await runImport(admin, "branches", "b.csv", ok);
    expect(done.ok).toBe(true);
    expect((await byCode("165")).usualLtoOfficeId).toBe((await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-EAST" } })).id);
    expect((await byCode("875")).name).toBe("Z Manual 3");
    await prisma.branch.update({ where: { code: "165" }, data: { usualLtoOfficeId: (await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-CEB" } })).id } });
  });

  it("only the import, review and change ticks (Admin by default) import, run, decide and hide", async () => {
    const text = csv([zrow(1)]);
    for (const u of [la, dp, fin]) {
      await expect(previewBranchFile(u, text, "x.csv")).rejects.toThrow('Ask an Admin to turn on "Import branches from MyLoans"');
      await expect(confirmBranchFile(u, text, "x.csv", null)).rejects.toThrow(/Import branches from MyLoans/);
      await expect(runBranchSync({ trigger: "api", user: u })).rejects.toThrow(/Import branches from MyLoans/);
      await expect(acceptReview(u, "x")).rejects.toThrow(/Decide branch changes/);
      await expect(ignoreReview(u, "x", "")).rejects.toThrow(/Decide branch changes/);
      await expect(setBranchHidden(u, "x", true)).rejects.toThrow(/Change branches/);
      await expect(saveSettingsRow(u, "branch", null, { code: "873", name: "Z Nope" })).rejects.toThrow(/does not allow/);
    }
  });

  it("a failed API run changes nothing and says why", async () => {
    await setSetting("myloans.simulateUnavailable", true);
    try {
      const before = await prisma.branchReview.count();
      const r = await runBranchSync({ trigger: "api", user: admin, mode: "full" });
      expect(r).toMatchObject({ ok: false });
      expect(r!.message).toMatch(/did not run.*Nothing was changed/);
      expect(await prisma.branchReview.count()).toBe(before);
      expect(await prisma.branchSyncRun.findUniqueOrThrow({ where: { id: r!.runId! } })).toMatchObject({ ok: false });
    } finally {
      await setSetting("myloans.simulateUnavailable", false);
    }
  });
});

describe("A large import", () => {
  it("about 900 rows: preview and confirm in a few seconds", async () => {
    const taken = new Set((await prisma.branch.findMany({ select: { code: true } })).map((b) => b.code));
    const rows: MyLoansBranchRow[] = [...builtin];
    for (let c = 100; c <= 999; c++) {
      if (taken.has(String(c)) || builtin.some((b) => b.code === String(c))) continue;
      rows.push({ divisionId: 990 + (c % 3), divisionName: `Z Large Division ${c % 3}`, areaId: 900 + (c % 25), areaName: `Z Large Area ${c % 25}`, branchId: 98000 + c, code: String(c), name: `Z Large ${c}`, address: `${c} Main St, "Big" City, Philippines`, active: null, updatedAt: null });
    }
    const text = csv(rows);
    let t = Date.now();
    const p = await previewBranchFile(admin, text, "large.csv");
    const previewMs = Date.now() - t;
    t = Date.now();
    const r = await confirmBranchFile(admin, text, "large.csv", p.fingerprint);
    const confirmMs = Date.now() - t;
    console.log(`Large import: ${rows.length} rows, ${r.applied} applied; preview ${previewMs} ms, confirm ${confirmMs} ms`);
    expect(r.applied).toBe(rows.length - builtin.length);
    expect(previewMs).toBeLessThan(5_000);
    expect(confirmMs).toBeLessThan(15_000);
  }, 120_000);
});
