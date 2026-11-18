import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { databaseName } from "@/lib/env/load-files";
import { containerId, databaseExists, docker, dbUser, psql } from "@/lib/kit/docker";
import { currentMigrations } from "@/lib/kit/core";
import { sizeOf, walk, type BackupTarget } from "./target";

/**
 * Backup and restore of the DATABASE and the UPLOADED FILES together (D-055), to any target (a folder or an
 * S3-compatible bucket). A set holds:
 *   db.dump                 pg_dump custom format of the database
 *   files/<root>/...        every uploaded file (receipts, stage evidence, LTO proof) from each storage root
 *   manifest.json           when, which database and migrations, and every file with its size and SHA-256
 * Restore always goes into a CLEAN COPY (a new database and an empty folder), never over the live data; checksums are
 * verified first. pg_dump / pg_restore run from PATH (a hosted server) or, on a developer PC, inside the Docker
 * database container. Retention: BACKUP_KEEP_DAYS (default 30), applied after each good backup.
 */

export interface Manifest {
  set: string; createdAt: string; database: string; migrations: string[];
  roots: { name: string; dir: string }[];
  files: { path: string; bytes: number; sha256: string }[];
}
export type Log = (line: string) => void;

const sha256File = (file: string) => new Promise<string>((ok, fail) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
});
export const setName = (d = new Date()) => `gdfi-dms-${d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}`;

/** The folders that hold uploaded files (the kit's own dumps and the backup folder are never included). */
export function storageRoots(env: Record<string, string | undefined> = process.env): { name: string; dir: string }[] {
  const storage = path.resolve(env.STORAGE_LOCAL_DIR ?? "./storage");
  const receipts = path.resolve(env.RECEIPTS_DIR ?? path.join(process.cwd(), "storage", "receipts"));
  const roots = [{ name: "storage", dir: storage }];
  if (!receipts.startsWith(storage + path.sep) && receipts !== storage) roots.push({ name: "receipts", dir: receipts });
  return roots;
}
const SKIP = (rel: string) => rel.startsWith("kit/") || rel.startsWith("backups/");

// ---------------------------------------------------------------------------------------------------
// pg_dump / pg_restore: from PATH, else the developer's Docker database container
// ---------------------------------------------------------------------------------------------------

function hasLocalPg(): boolean {
  try { execFileSync("pg_dump", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
function pgEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  // From the connection string in the environment; passed to pg_dump as PGPASSWORD, never on the command line.
  const pw = decodeURIComponent(u.password);
  return { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: pw };
}
const sourceUrl = () => process.env.DIRECT_URL || process.env.DATABASE_URL || "";

export function dumpDatabase(database: string, outFile: string) {
  if (hasLocalPg()) {
    execFileSync("pg_dump", ["-d", database, "-Fc", "--no-owner", "-f", outFile], { env: pgEnv(sourceUrl()), stdio: ["ignore", "ignore", "pipe"] });
    return;
  }
  const c = containerId();
  const tmp = `/tmp/backup-${Date.now()}.dump`;
  docker(["exec", c, "pg_dump", "-U", dbUser(), "-d", database, "-Fc", "--no-owner", "-f", tmp]);
  const rel = path.relative(process.cwd(), outFile); // relative: no drive letter for docker cp to misread
  docker(["cp", `${c}:${tmp}`, rel]);
  docker(["exec", c, "rm", "-f", tmp]);
}

function createEmptyDatabase(database: string) {
  if (hasLocalPg()) {
    execFileSync("createdb", [database], { env: pgEnv(sourceUrl()), stdio: ["ignore", "ignore", "pipe"] });
    return;
  }
  if (databaseExists(database)) throw new Error(`The database ${database} already exists. Restore goes into a clean copy: pick a new name.`);
  psql("postgres", `CREATE DATABASE "${database.replace(/"/g, '""')}";`);
}

export function restoreDatabase(database: string, dumpFile: string) {
  createEmptyDatabase(database);
  if (hasLocalPg()) {
    execFileSync("pg_restore", ["-d", database, "--no-owner", "--single-transaction", dumpFile], { env: pgEnv(sourceUrl()), stdio: ["ignore", "ignore", "pipe"] });
    return;
  }
  const c = containerId();
  const tmp = `/tmp/restore-${Date.now()}.dump`;
  docker(["cp", path.relative(process.cwd(), dumpFile), `${c}:${tmp}`]);
  try {
    docker(["exec", c, "pg_restore", "-U", dbUser(), "-d", database, "--no-owner", "--single-transaction", tmp]);
  } finally {
    docker(["exec", c, "rm", "-f", tmp]);
  }
}

// ---------------------------------------------------------------------------------------------------
// Backup, restore, retention
// ---------------------------------------------------------------------------------------------------

export async function backup(target: BackupTarget, o: { database?: string; roots?: { name: string; dir: string }[]; now?: Date; log?: Log } = {}): Promise<Manifest> {
  const log = o.log ?? (() => {});
  const database = o.database ?? databaseName(sourceUrl());
  if (!database) throw new Error("No database: set DATABASE_URL.");
  const set = setName(o.now);
  const work = await mkdtemp(path.join(process.cwd(), ".backup-work-"));
  try {
    const dump = path.join(work, "db.dump");
    log(`Dumping the database ${database}...`);
    dumpDatabase(database, dump);
    const files: Manifest["files"] = [{ path: "db.dump", bytes: await sizeOf(dump), sha256: await sha256File(dump) }];
    await target.put(set, "db.dump", dump);
    const roots = o.roots ?? storageRoots();
    for (const r of roots) {
      const list = (await walk(r.dir)).filter((rel) => !SKIP(rel));
      log(`Copying ${list.length} uploaded file${list.length === 1 ? "" : "s"} from ${r.name}...`);
      for (const rel of list) {
        const full = path.join(r.dir, rel);
        const p = `files/${r.name}/${rel}`;
        files.push({ path: p, bytes: await sizeOf(full), sha256: await sha256File(full) });
        await target.put(set, p, full);
      }
    }
    const m: Manifest = { set, createdAt: (o.now ?? new Date()).toISOString(), database, migrations: currentMigrations(), roots, files };
    const mf = path.join(work, "manifest.json");
    await writeFile(mf, JSON.stringify(m, null, 2));
    await target.put(set, "manifest.json", mf);
    log(`Backed up to ${target.label}: ${set} (${files.length} files, ${(files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024).toFixed(1)} MB).`);
    return m;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Restore a set into a CLEAN COPY: a new database and an empty folder. Every checksum is verified first. */
export async function restore(target: BackupTarget, o: { set?: string; intoDatabase: string; intoFiles: string; log?: Log }): Promise<Manifest> {
  const log = o.log ?? (() => {});
  const set = o.set ?? (await target.sets()).at(-1);
  if (!set) throw new Error(`No backup found in ${target.label}.`);
  if (o.intoDatabase === databaseName(sourceUrl())) throw new Error("Restore goes into a clean copy, never over the database in use. Pick a new database name.");
  if (existsSync(o.intoFiles) && readdirSync(o.intoFiles).length) throw new Error(`${o.intoFiles} is not empty. Restore the files into an empty folder.`);
  const work = await mkdtemp(path.join(os.tmpdir(), "gdfi-restore-"));
  try {
    const mf = path.join(work, "manifest.json");
    await target.get(set, "manifest.json", mf);
    const m = JSON.parse(await readFile(mf, "utf8")) as Manifest;
    log(`Checking ${m.files.length} files of ${set}...`);
    for (const f of m.files) {
      const local = f.path === "db.dump" ? path.join(work, "db.dump") : path.join(o.intoFiles, f.path.replace(/^files\//, ""));
      await target.get(set, f.path, local);
      const got = await sha256File(local);
      if (got !== f.sha256) throw new Error(`${f.path} does not match its checksum. The backup is damaged: nothing was restored.`);
    }
    log(`Restoring the database into ${o.intoDatabase}...`);
    restoreDatabase(o.intoDatabase, path.join(work, "db.dump"));
    log(`Restored ${set}: database ${o.intoDatabase}, files in ${o.intoFiles} (one folder per storage root: ${m.roots.map((r) => r.name).join(", ")}).`);
    return m;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Deletes sets older than keepDays (the newest set is always kept). */
export async function prune(target: BackupTarget, keepDays: number, now = new Date(), log: Log = () => {}): Promise<string[]> {
  const sets = await target.sets();
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const old = sets.slice(0, -1).filter((s) => {
    const m = /^gdfi-dms-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) < cutoff : false;
  });
  for (const s of old) await target.remove(s);
  if (old.length) log(`Removed ${old.length} backup${old.length === 1 ? "" : "s"} older than ${keepDays} days.`);
  return old;
}

export const keepDays = (env: Record<string, string | undefined> = process.env) => {
  const n = Number(env.BACKUP_KEEP_DAYS ?? 30);
  return Number.isInteger(n) && n >= 1 ? n : 30;
};

