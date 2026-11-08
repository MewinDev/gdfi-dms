import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { businessDate } from "@/lib/time";
import { docker, containerId, dbUser, lit, psql, runBin, terminateConnections } from "./docker";
import { blankGraph, kitConfig, kitDatabase, kitRefusal, migrationsDiffer, OUT_OF_DATE } from "./guard";
import { dateMap, rebaseSql, YMD_COLUMNS, type DateColumn } from "./rebase";

/**
 * The Manual Test Kit: the starting state of gdfi_dms (migrations, settings and master data, the sample
 * accounts and the sample loans) saved as a "baseline", plus named backups.
 *
 * Files: storage/kit/ (ignored by Git). Each save is a pg_dump custom-format file (.dump) and a small
 * .json beside it (when, the Manila date, the migrations, the number of loan files). Dumps, not a
 * template database: a backup is an ordinary file the person can copy to another PC and restore there,
 * one mechanism serves the baseline and the backups, and putting back ~3 MB takes a few seconds.
 * Files move in and out of the container with `docker cp`, never through a console pipe.
 */

const kitDir = () => path.normalize(kitConfig.dir);
const backupDir = () => path.join(kitDir(), "backups");
const BASELINE = "baseline";
const KEEP_AUTO = 5;

export interface KitManifest {
  name: string;
  kind: "baseline" | "backup" | "auto";
  createdAt: string; // ISO instant
  savedOn: string; // Manila date (YYYY-MM-DD), for re-basing the dates on restore
  migrations: string[];
  database: string;
  sizeBytes: number;
  loanFiles: number;
}

export type Log = (line: string) => void;

/** Every migration folder, in the order Prisma applies them. */
export function currentMigrations(root = process.cwd()): string[] {
  const dir = path.join(root, "prisma", "migrations");
  return readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isDirectory()).sort();
}

function assertKit() {
  const why = kitRefusal();
  if (why) throw new Error(why);
}

const fileOf = (name: string) => (name === BASELINE ? path.join(kitDir(), `${BASELINE}.dump`) : path.join(backupDir(), `${name}.dump`));
const jsonOf = (name: string) => fileOf(name).replace(/\.dump$/, ".json");

export function readManifest(name: string): KitManifest | null {
  try {
    return JSON.parse(readFileSync(jsonOf(name), "utf8")) as KitManifest;
  } catch {
    return null;
  }
}

/** The baseline and every backup, newest first (the baseline on top). */
export function listSaves(): KitManifest[] {
  const out: KitManifest[] = [];
  const base = existsSync(fileOf(BASELINE)) ? readManifest(BASELINE) : null;
  if (base) out.push(base);
  if (existsSync(backupDir())) {
    const rows = readdirSync(backupDir()).filter((f) => f.endsWith(".json")).map((f) => readManifest(f.replace(/\.json$/, ""))).filter((m): m is KitManifest => !!m && existsSync(fileOf(m.name)));
    out.push(...rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  return out;
}

/** "out of date" when the migrations changed since the baseline was saved; null when there is none. */
export function baselineStatus(): { manifest: KitManifest; upToDate: boolean } | null {
  const m = existsSync(fileOf(BASELINE)) ? readManifest(BASELINE) : null;
  return m ? { manifest: m, upToDate: !migrationsDiffer(m.migrations, currentMigrations()) } : null;
}

function countLoans(db: string): number {
  try {
    return Number(psql(db, `SELECT count(*) FROM "Loan";`).trim()) || 0;
  } catch {
    return 0; // no tables yet
  }
}

/** pg_dump of the kit database to storage/kit (custom format), with its manifest. */
export function saveDump(name: string, kind: KitManifest["kind"], log: Log = () => {}): KitManifest {
  assertKit();
  const db = kitDatabase();
  mkdirSync(backupDir(), { recursive: true });
  const c = containerId();
  const tmp = `/tmp/kit-save-${Date.now()}.dump`;
  docker(["exec", c, "pg_dump", "-U", dbUser(), "-d", db, "-Fc", "--no-owner", "-f", tmp]);
  const out = fileOf(name);
  docker(["cp", `${c}:${tmp}`, out]); // a relative path: no drive letter for docker cp to misread
  docker(["exec", c, "rm", "-f", tmp]);
  const now = new Date();
  const m: KitManifest = {
    name, kind, createdAt: now.toISOString(), savedOn: businessDate(now), migrations: currentMigrations(), database: db,
    sizeBytes: statSync(out).size, loanFiles: countLoans(db),
  };
  writeFileSync(jsonOf(name), JSON.stringify(m, null, 2));
  log(`Saved ${name === BASELINE ? "the baseline" : `backup "${name}"`} (${(m.sizeBytes / 1024).toFixed(0)} KB, ${m.loanFiles} loan files) to ${out}.`);
  return m;
}

/** Automatic backup before a reset or restore: pre-reset-<time>; only the last 5 are kept. */
export function autoBackup(log: Log = () => {}): KitManifest | null {
  if (!tablesExist()) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const m = saveDump(`pre-reset-${stamp}`, "auto", log);
  const autos = listSaves().filter((s) => s.kind === "auto");
  for (const old of autos.slice(KEEP_AUTO)) {
    rmSync(fileOf(old.name), { force: true });
    rmSync(jsonOf(old.name), { force: true });
    log(`Removed the old automatic backup ${old.name} (the last ${KEEP_AUTO} are kept).`);
  }
  return m;
}

function tablesExist(): boolean {
  return psql(kitDatabase(), `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL;`).trim() === "t";
}

/** Every timestamp column of the app's tables (not Prisma's own migration table). */
function timestampColumns(db: string): DateColumn[] {
  const rows = psql(db, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND table_name <> '_prisma_migrations' ORDER BY 1, 2;`);
  return rows.split("\n").filter(Boolean).map((r) => { const [table, column] = r.split("|"); return { table, column, kind: "timestamp" as const }; });
}

/** Moves every date by the business days between the save and today; the email switch stays Not active. */
export function afterRestore(savedOn: string, log: Log = () => {}) {
  const db = kitDatabase();
  const today = businessDate(new Date());
  const holidays = new Set(psql(db, `SELECT date FROM "HolidayCalendar";`).split("\n").map((s) => s.trim()).filter(Boolean));
  const map = dateMap(savedOn, today, holidays);
  if (map.size) {
    psql(db, rebaseSql(map, [...timestampColumns(db), ...YMD_COLUMNS]));
    log(`Moved the dates from ${savedOn} to ${today} (business days, weekends and holidays skipped), so the TAT shows as it did.`);
  } else {
    log("Dates kept: saved today.");
  }
  emailOff(db);
}

/** The email switch: Not active (the kit never sends email). */
export function emailOff(db = kitDatabase()) {
  psql(db, `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('email.active', 'false'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, "updatedAt" = now();`);
}

/**
 * Puts a save back: refuses a save made with other migrations, takes the automatic backup, closes the
 * other connections (the dev server reconnects), pg_restore in one transaction, then the dates.
 */
export function restoreSave(name: string, log: Log = () => {}, opts: { autoBackup?: boolean } = {}): KitManifest {
  assertKit();
  const m = readManifest(name);
  if (!m || !existsSync(fileOf(name))) throw new Error(name === BASELINE ? "There is no baseline yet. Run npm run kit:start." : `There is no backup called "${name}".`);
  if (migrationsDiffer(m.migrations, currentMigrations())) {
    throw new Error(name === BASELINE ? OUT_OF_DATE : `The backup "${name}" was saved with other migrations (${m.migrations.at(-1)}). It cannot be restored on this version.`);
  }
  if (opts.autoBackup !== false) autoBackup(log);
  const db = kitDatabase();
  const c = containerId();
  const tmp = `/tmp/kit-restore-${Date.now()}.dump`;
  docker(["cp", fileOf(name), `${c}:${tmp}`]);
  try {
    terminateConnections(db);
    docker(["exec", c, "pg_restore", "-U", dbUser(), "-d", db, "--clean", "--if-exists", "--single-transaction", "--no-owner", tmp]);
  } finally {
    docker(["exec", c, "rm", "-f", tmp]);
  }
  log(`Restored ${name === BASELINE ? "the baseline" : `backup "${name}"`} (saved ${m.createdAt.slice(0, 16).replace("T", " ")} UTC).`);
  afterRestore(m.savedOn, log);
  return m;
}

/**
 * Builds the starting state from nothing: empty schema, every migration, the seed (reference data,
 * no test users), then the sample accounts and loans through the app's own services
 * (scripts/kit-build.ts), then saves the baseline. Takes the automatic backup first.
 */
export async function buildBaseline(log: Log = () => {}, opts: { samples?: () => Promise<void> } = {}): Promise<KitManifest> {
  assertKit();
  const db = kitDatabase();
  autoBackup(log);
  const env: NodeJS.ProcessEnv = { ...process.env, SEED_TEST_USERS: "false" };
  blankGraph(env);
  terminateConnections(db);
  psql(db, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
  log(`Emptied ${db}.`);
  runBin("prisma", ["migrate", "deploy"], env, true);
  log(`Applied ${currentMigrations().length} migrations.`);
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "prisma/seed.ts"], env, true);
  log("Seeded the settings and master data (roles, branches, transaction types, documents, hold reasons, stages, LTO offices).");
  if (opts.samples) await opts.samples(); // the kit's own integration test, in-process
  else runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "scripts/kit-build.ts"], env);
  emailOff(db);
  return saveDump(BASELINE, "baseline", log);
}

export const BASELINE_NAME = BASELINE;
/** Exposed for the integration test (a quoted SQL literal). */
export const sqlLiteral = lit;
