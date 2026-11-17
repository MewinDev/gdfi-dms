// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setUserBranches } from "@/lib/services/access";
import { cleanFilters, exportFileLog, fileLogPage, fileLogWhere } from "@/lib/services/file-access-log";
import { asUser } from "./helpers";

/**
 * Audit, File access log (D-039): filters (user, branch, PN #, file type, date), branch scope, and the CSV
 * export that writes its own log row. The log is append-only and its rows keep their user (ON DELETE
 * RESTRICT): only the seeded Test Admin (never deleted) writes rows here; the test's own people only read,
 * so they can be removed. Rows carry a run marker.
 */
const RUN = `zzlog${Date.now().toString(36)}`;
const PN = (n: string) => `GD99920999${n}`;
let angono: string, pasig: string;
let viewer: CurrentUser, angonoDpo: CurrentUser, noTick: CurrentUser;

async function person(key: string, role: string, branchIds: string[]) {
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const u = await prisma.user.create({ data: { email: `zz.filelog.${key}@gdfi.ph`, name: `Zz Filelog ${key}`, roleId: r.id, isTestUser: true } });
  await setUserBranches(u.id, branchIds);
  return asUser(u.email);
}
/** Only people who never wrote a log row (the readers); Test Admin is seeded and kept. */
const clean = () => prisma.user.deleteMany({ where: { email: { startsWith: "zz.filelog." } } });

beforeAll(async () => {
  await clean();
  [angono, pasig] = await Promise.all(["165", "174"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  viewer = await asUser("test.admin@gdfi.ph"); // All branches
  angonoDpo = await person("dpo", "ADMIN", [angono]);
  noTick = await person("la", "LA", [angono]);
  const row = (n: string, entityType: string, branchId: string, action = "VIEW") => ({
    userId: viewer.id, entityType, entityId: `${RUN}-${n}`, pn: PN(n), branchId, fileKey: `k/${RUN}/${n}`, fileName: `${RUN}-${n}.jpg`, action,
  });
  await prisma.fileAccessLog.createMany({ data: [row("01", "RECEIPT", angono), row("02", "STAGE_EVIDENCE", pasig, "DOWNLOAD"), row("03", "LTO_PROOF", angono)] });
});
afterAll(clean);

const mine = <T extends { fileName: string }>(rows: T[]) => rows.filter((r) => r.fileName.startsWith(RUN));

describe("file access log (D-039)", () => {
  it("is append-only: the database refuses changes and deletes", async () => {
    await expect(prisma.fileAccessLog.updateMany({ where: { fileName: `${RUN}-01.jpg` }, data: { fileName: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.fileAccessLog.deleteMany({ where: { fileName: `${RUN}-01.jpg` } })).rejects.toThrow(/append-only/);
  });

  it("filters by PN #, file type, branch, user and date", async () => {
    const rows = async (f: Record<string, string>) => mine((await fileLogPage(viewer, cleanFilters(f), 1, 500)).rows);
    expect((await rows({ pn: PN("02") })).map((r) => r.pn)).toEqual([PN("02")]);
    expect((await rows({ type: "LTO_PROOF" })).map((r) => r.pn)).toEqual([PN("03")]);
    expect((await rows({ branchId: pasig })).map((r) => r.pn)).toEqual([PN("02")]);
    expect(await rows({ user: "test.admin@gdfi.ph", pn: PN("0") })).toHaveLength(3);
    expect(await rows({ user: "nobody-like-this" })).toHaveLength(0);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    expect(await rows({ from: today, to: today })).toHaveLength(3);
    expect(await rows({ to: "2020-01-01" })).toHaveLength(0);
    // Unknown values are dropped, not passed to the database.
    expect(cleanFilters({ type: "SOMETHING", from: "yesterday", pn: "  " })).toEqual({});
  });

  it("follows branch access: an Angono-only reader sees no Pasig row, on the page or in the export", async () => {
    const pns = mine((await fileLogPage(angonoDpo, cleanFilters({ pn: PN("0") }), 1, 500)).rows).map((r) => r.pn).sort();
    expect(pns).toEqual([PN("01"), PN("03")]);
    // The export reads through the same where-clause.
    expect(fileLogWhere(angonoDpo, {}).AND).toContainEqual({ branchId: { in: [angono] } });
  });

  it("needs the tick", async () => {
    await expect(fileLogPage(noTick, {}, 1)).rejects.toThrow(/View file access log/);
    await expect(exportFileLog(noTick, {})).rejects.toThrow(/View file access log/);
  });

  it("CSV export: the filtered rows, and the export is logged", async () => {
    const before = await prisma.fileAccessLog.count({ where: { userId: viewer.id, action: "EXPORT" } });
    const { csv } = await exportFileLog(viewer, cleanFilters({ pn: PN("0"), branchId: angono }), { ip: "127.0.0.1", userAgent: "vitest" });
    expect(csv).toContain("When (Philippine time),User,Email,Action,File type");
    expect(csv).toContain(`${RUN}-01.jpg`);
    expect(csv).not.toContain(`${RUN}-02.jpg`); // Pasig: filtered out
    const ex = await prisma.fileAccessLog.findMany({ where: { userId: viewer.id, action: "EXPORT" }, orderBy: { at: "desc" } });
    expect(ex.length).toBe(before + 1);
    expect(ex[0]).toMatchObject({ entityType: "FILE_ACCESS_LOG", branchId: null, ip: "127.0.0.1", userAgent: "vitest" });
    expect(JSON.parse(ex[0].entityId)).toMatchObject({ filters: { pn: PN("0"), branchId: angono } });
    // Export rows have no branch: only someone with All branches sees them on the page.
    expect((await fileLogPage(viewer, cleanFilters({ type: "FILE_ACCESS_LOG" }), 1)).rows.map((r) => r.id)).toContain(ex[0].id);
    expect((await fileLogPage(angonoDpo, cleanFilters({ type: "FILE_ACCESS_LOG" }), 1)).rows).toHaveLength(0);
  });

  it("guards the CSV against spreadsheet formulas", async () => {
    await prisma.fileAccessLog.create({ data: { userId: viewer.id, entityType: "RECEIPT", entityId: `${RUN}-f`, pn: PN("09"), branchId: angono, fileName: `=HYPERLINK("x")`, action: "VIEW" } });
    const { csv } = await exportFileLog(viewer, cleanFilters({ pn: PN("09") }));
    expect(csv).toContain(`'=HYPERLINK`);
  });
});
