// @vitest-environment node
/**
 * D-055 backup and restore rehearsal (test database only, fake data): a receipt and its file are backed up together
 * (the database and the uploaded files, with checksums), restored into a CLEAN COPY (a new database and an empty folder),
 * and the restored receipt opens through the file route. A damaged backup restores nothing; restore never goes over the
 * database in use; retention removes old sets but always keeps the newest.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/current-user", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/current-user")>()), getCurrentUser: async () => session.user }));

import { prisma } from "@/lib/db";
import { databaseName } from "@/lib/env/load-files";
import { psql } from "@/lib/kit/docker";
import { backup, prune, restore } from "@/lib/backup/run";
import { FolderTarget } from "@/lib/backup/target";
import { asUser } from "./helpers";

const RESTORED = `gdfi_dms_test_restore_${Date.now()}`;
let work: string, receiptsDir: string, restoredFiles: string, target: FolderTarget;
let receiptId: string, bytes: Buffer;
const testDb = () => databaseName(process.env.DATABASE_URL)!;

beforeAll(async () => {
  work = await mkdtemp(path.join(process.cwd(), ".backup-test-"));
  receiptsDir = path.join(work, "receipts");
  restoredFiles = path.join(work, "restored");
  target = new FolderTarget(path.join(work, "sets"));
  // A fake receipt: an image file in the receipts folder and its row.
  bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
  const key = "0f0e0d0c-0b0a-4908-8706-050403020100.jpg";
  await (await import("node:fs/promises")).mkdir(receiptsDir, { recursive: true });
  await writeFile(path.join(receiptsDir, key), bytes);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "165" } });
  const adv = await prisma.cashAdvance.create({ data: { number: "CA-2099-9555", requestedById: admin.id, branchId: branch.id, status: "RELEASED", requestedCents: 1000, approvedCents: 1000, releasedCents: 1000, lines: { create: { kind: "TRANSPORT", requestedCents: 1000, approvedCents: 1000, releasedCents: 1000 } } }, include: { lines: true } });
  const r = await prisma.receipt.create({ data: { lineId: adv.lines[0].id, date: "2026-11-18", cents: 1000, number: "OR-FAKE-1", uploadedById: admin.id, fileKey: key, fileName: "fake-receipt.jpg", mime: "image/jpeg" } });
  receiptId = r.id;
});

afterAll(async () => {
  await prisma.receipt.deleteMany({ where: { number: "OR-FAKE-1" } });
  await prisma.cashAdvance.deleteMany({ where: { number: "CA-2099-9555" } });
  try { psql("postgres", `DROP DATABASE IF EXISTS "${RESTORED}" WITH (FORCE);`); } catch { /* the container may be gone */ }
  await rm(work, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("backup and restore (D-055)", () => {
  it("backs up the database and the uploaded files with checksums, restores both into a clean copy, and the restored receipt opens through the file route", async () => {
    const m = await backup(target, { database: testDb(), roots: [{ name: "receipts", dir: receiptsDir }] });
    expect(m.files.map((f) => f.path)).toEqual(["db.dump", "files/receipts/0f0e0d0c-0b0a-4908-8706-050403020100.jpg"]);
    expect(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    // Never over the database in use.
    await expect(restore(target, { intoDatabase: testDb(), intoFiles: path.join(work, "x") })).rejects.toThrow(/never over the database in use/);
    await restore(target, { intoDatabase: RESTORED, intoFiles: restoredFiles });
    expect(await readFile(path.join(restoredFiles, "receipts", "0f0e0d0c-0b0a-4908-8706-050403020100.jpg"))).toEqual(bytes);
    // The file route, on the restored copy: its database and its receipts folder.
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${RESTORED}`;
    const saved = { db: process.env.DATABASE_URL, receipts: process.env.RECEIPTS_DIR };
    process.env.DATABASE_URL = url.toString();
    process.env.RECEIPTS_DIR = path.join(restoredFiles, "receipts");
    try {
      const { prisma: restoredDb } = await import("@/lib/db");
      const { asUser: as } = await import("./helpers");
      session.user = await as("test.admin@gdfi.ph");
      expect(await restoredDb.receipt.count({ where: { id: receiptId } })).toBe(1);
      const { GET } = await import("@/app/api/files/[kind]/[id]/route");
      const res = await GET(new Request(`http://localhost/api/files/receipt/${receiptId}`), { params: Promise.resolve({ kind: "receipt", id: receiptId }) });
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
      await restoredDb.$disconnect();
    } finally {
      process.env.DATABASE_URL = saved.db;
      if (saved.receipts === undefined) delete process.env.RECEIPTS_DIR; else process.env.RECEIPTS_DIR = saved.receipts;
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
    }
  }, 180_000);

  it("a damaged backup restores nothing", async () => {
    const set = (await target.sets()).at(-1)!;
    const file = path.join(work, "sets", set, "files", "receipts", "0f0e0d0c-0b0a-4908-8706-050403020100.jpg");
    await writeFile(file, Buffer.from("tampered"));
    await expect(restore(target, { set, intoDatabase: `${RESTORED}_x`, intoFiles: path.join(work, "restored-2") })).rejects.toThrow(/does not match its checksum/);
  });

  it("retention removes sets older than the setting but always keeps the newest", async () => {
    const sets = path.join(work, "sets");
    for (const s of ["gdfi-dms-20250101-000000", "gdfi-dms-20250102-000000"]) await (await import("node:fs/promises")).mkdir(path.join(sets, s), { recursive: true });
    const removed = await prune(target, 30);
    expect(removed).toEqual(["gdfi-dms-20250101-000000", "gdfi-dms-20250102-000000"]);
    expect((await target.sets()).length).toBe(1);
  });
});
void asUser;
void os;
