// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setUserBranches } from "@/lib/services/access";
import { cleanFilters, exportFileLog, fileLogPage } from "@/lib/services/file-access-log";
import { asUser } from "./helpers";

/**
 * Audit, File access log (D-039): filters (user, branch, PN #, file type, date), branch scope, and the CSV
 * export that writes its own log row. The log is append-only and its rows keep their user (ON DELETE
 * RESTRICT), so this test never deletes: its people are kept (upserted) and its rows carry a run marker.
 */
const RUN = `zzlog${Date.now().toString(36)}`;
const PN = (n: string) => `GD99920999${n}`;
let angono: string, pasig: string;
let viewer: CurrentUser, angonoDpo: CurrentUser, noTick: CurrentUser, actor: { id: string };

async function person(key: string, role: string, branchIds: string[] | "ALL") {
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const email = `zz.filelog.${key}@gdfi.ph`;
  const u = await prisma.user.upsert({ where: { email }, create: { email, name: `Zz Filelog ${key}`, roleId: r.id, isTestUser: true, allBranches: branchIds === "ALL" }, update: { roleId: r.id, active: true, allBranches: branchIds === "ALL" } });
  if (branchIds !== "ALL") await setUserBranches(u.id, branchIds);
  return asUser(email);
}

beforeAll(async () => {
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  viewer = await person("admin", "ADMIN", "ALL");
  angonoDpo = await person("dpo", "ADMIN", [angono]);
  noTick = await person("la", "LA", [angono]);
  actor = await prisma.user.findUniqueOrThrow({ where: { email: "zz.filelog.admin@gdfi.ph" }, select: { id: true } });
  const row = (n: string, entityType: string, branchId: string, action = "VIEW") => ({
    userId: actor.id, entityType, entityId: `${RUN}-${n}`, pn: PN(n), branchId, fileKey: `k/${RUN}/${n}`, fileName: `${RUN}-${n}.jpg`, action,
  });
  await prisma.fileAccessLog.createMany({ data: [row("01", "RECEIPT", angono), row("02", "STAGE_EVIDENCE", pasig, "DOWNLOAD"), row("03", "LTO_PROOF", angono)] });
});

const mine = <T extends { fileName: string }>(rows: T[]) => rows.filter((r) => r.fileName.startsWith(RUN));

describe("file access log (D-039)", () => {
  it("is append-only: the database refuses changes and deletes", async () => {
    await expect(prisma.fileAccessLog.updateMany({ where: { fileName: `${RUN}-01.jpg` }, data: { fileName: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.fileAccessLog.deleteMany({ where: { fileName: `${RUN}-01.jpg` } })).rejects.toThrow(/append-only/);
  });

  it("filters by PN #, file type, branch, user and date", async () => {
    expect(mine((await fileLogPage(viewer, cleanFilters({ pn: PN("02") }), 1)).rows).map((r) => r.pn)).toEqual([PN("02")]);
    expect(mine((await fileLogPage(viewer, cleanFilters({ type: "LTO_PROOF" }), 1, 500)).rows).map((r) => r.pn)).toEqual([PN("03")]);
    expect(mine((await fileLogPage(viewer, cleanFilters({ branchId: pasig }), 1, 500)).rows).map((r) => r.pn)).toEqual([PN("02")]);
    expect(mine((await fileLogPage(viewer, cleanFilters({ user: "zz.filelog.admin" }), 1, 500)).rows)).toHaveLength(3);
    expect(mine((await fileLogPage(viewer, cleanFilters({ user: "nobody-like-this" }), 1, 500)).rows)).toHaveLength(0);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    expect(mine((await fileLogPage(viewer, cleanFilters({ from: today, to: today }), 1, 500)).rows)).toHaveLength(3);
    expect(mine((await fileLogPage(viewer, cleanFilters({ to: "2020-01-01" }), 1, 500)).rows)).toHaveLength(0);
    // Unknown values are dropped, not passed to the database.
    expect(cleanFilters({ type: "SOMETHING", from: "yesterday", pn: "  " })).toEqual({});
  });

  it("follows branch access: an Angono-only reader sees no Pasig row", async () => {
    const pns = mine((await fileLogPage(angonoDpo, cleanFilters({}), 1, 500)).rows).map((r) => r.pn).sort();
    expect(pns).toEqual([PN("01"), PN("03")]);
  });

  it("needs the tick", async () => {
    await expect(fileLogPage(noTick, {}, 1)).rejects.toThrow(/View file access log/);
    await expect(exportFileLog(noTick, {})).rejects.toThrow(/View file access log/);
  });

  it("CSV export: the filtered rows, and the export is logged", async () => {
    const before = await prisma.fileAccessLog.count({ where: { userId: angonoDpo.id, action: "EXPORT" } });
    const { csv, count } = await exportFileLog(angonoDpo, cleanFilters({ pn: PN("0") }), { ip: "127.0.0.1", userAgent: "vitest" });
    expect(csv.split("\r\n")[0]).toContain("When (Philippine time),User,Email,Action,File type");
    expect(csv).toContain(PN("01"));
    expect(csv).not.toContain(PN("02")); // Pasig: outside this reader's branches
    expect(count).toBeGreaterThanOrEqual(2);
    const ex = await prisma.fileAccessLog.findMany({ where: { userId: angonoDpo.id, action: "EXPORT" }, orderBy: { at: "desc" } });
    expect(ex.length).toBe(before + 1);
    expect(ex[0]).toMatchObject({ entityType: "FILE_ACCESS_LOG", branchId: null, ip: "127.0.0.1", userAgent: "vitest" });
    expect(JSON.parse(ex[0].entityId)).toMatchObject({ filters: { pn: PN("0") } });
    // Export rows have no branch: only someone with All branches sees them on the page.
    expect((await fileLogPage(viewer, cleanFilters({ type: "FILE_ACCESS_LOG", user: "zz.filelog.dpo" }), 1)).rows.length).toBeGreaterThan(0);
    expect((await fileLogPage(angonoDpo, cleanFilters({ type: "FILE_ACCESS_LOG" }), 1)).rows).toHaveLength(0);
  });

  it("guards the CSV against spreadsheet formulas", async () => {
    await prisma.fileAccessLog.create({ data: { userId: actor.id, entityType: "RECEIPT", entityId: `${RUN}-f`, pn: PN("09"), branchId: angono, fileName: `=HYPERLINK("x")`, action: "VIEW" } });
    const { csv } = await exportFileLog(viewer, cleanFilters({ pn: PN("09") }));
    expect(csv).toContain(`'=HYPERLINK`);
  });
});
