/**
 * npm run db:reset-seed: empties the LOCAL development database gdfi_dms, applies every migration and
 * fills it with FAKE data for development and manual testing. Documented in README.md.
 *
 * Refuses unless (lib/env/reset-seed-guard.ts and lib/kit/guard.ts):
 *   APP_ENV=local, the database is gdfi_dms on this computer (never gdfi_dms_test), ALLOW_DESTRUCTIVE=1
 *   for this one command, TEST_MODE=true and the sample MyLoans (MYLOANS_MODE=mock).
 * Asks for RESET (or --confirm=RESET). Takes a plain-SQL backup to backups/ first.
 *
 * Steps: backup -> empty the schema -> migrate:check -> every migration -> migrate:check -> seed
 * (reference data, no test users) -> the scenario kit (sample accounts and loans at every current stage,
 * some near or over TAT, pending myloans changes, a branch sync from the sample MyLoans) -> the
 * foundation layer (lib/seed/foundation.ts). It never saves or replaces a Manual Test Kit baseline.
 */
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadEnvFiles } from "@/lib/env/load-files";
import { resetSeedRefusal, RESET_SEED_DATABASE } from "@/lib/env/reset-seed-guard";
import { blankGraph, confirmRefusal, KIT_CONFIRM_WORD, kitRefusal } from "@/lib/kit/guard";
import { containerId, dbUser, docker, psql, runBin, terminateConnections } from "@/lib/kit/docker";

loadEnvFiles([".env.local", ".env"]);
blankGraph(); // this run can never send an email

const say = (line: string) => console.log(line);
const done = (line: string) => console.log(`- ${line}`);
const confirmFlag = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length) ?? null;

async function confirmed(): Promise<boolean> {
  say(`Will: back up ${RESET_SEED_DATABASE}, then REPLACE EVERYTHING in it with fresh migrations and fake data (this also replaces the Manual Test Kit data; saved kit baselines in storage/kit are not touched).`);
  let typed = confirmFlag;
  if (typed === null) {
    if (!process.stdin.isTTY) {
      say(`No console to type in. Run it again with --confirm=${KIT_CONFIRM_WORD} to go ahead.`);
      return false;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    typed = await rl.question(`Type ${KIT_CONFIRM_WORD} to go ahead: `);
    rl.close();
  }
  const why = confirmRefusal(typed);
  if (why) say(`Stopped: ${why} Nothing was changed.`);
  return !why;
}

/** Plain-SQL pg_dump of the database to backups/dev-before-reset-<time>.sql (inside the container: no local pg_dump needed). */
function backup(): string | null {
  const hasTables = psql(RESET_SEED_DATABASE, `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL;`).trim() === "t";
  if (!hasTables) return null;
  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const out = path.join("backups", `dev-before-reset-${stamp}.sql`);
  const c = containerId();
  const tmp = `/tmp/reset-seed-${Date.now()}.sql`;
  docker(["exec", c, "pg_dump", "-U", dbUser(), "-d", RESET_SEED_DATABASE, "--no-owner", "-f", tmp]);
  try {
    docker(["cp", `${c}:${tmp}`, out]); // a relative path: no drive letter for docker cp to misread
  } finally {
    docker(["exec", c, "rm", "-f", tmp]);
  }
  return out;
}

async function main() {
  const why = resetSeedRefusal() ?? kitRefusal();
  if (why) {
    console.error(`Refused: ${why}`);
    process.exitCode = 1;
    return;
  }
  if (!(await confirmed())) {
    process.exitCode = 1;
    return;
  }

  const file = backup();
  done(file ? `Backed up ${RESET_SEED_DATABASE} to ${file} (${(statSync(file).size / 1024).toFixed(0)} KB).` : `${RESET_SEED_DATABASE} had no tables; nothing to back up.`);

  const env: NodeJS.ProcessEnv = { ...process.env, SEED_TEST_USERS: "false" };
  blankGraph(env);
  runBin("tsx", ["scripts/migrate-check.ts", "--folders-only"], env); // a stray migration folder stops here, before anything is emptied
  terminateConnections(RESET_SEED_DATABASE);
  psql(RESET_SEED_DATABASE, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
  done(`Emptied ${RESET_SEED_DATABASE}.`);
  runBin("tsx", ["scripts/migrate-check.ts"], env);
  runBin("prisma", ["migrate", "deploy"], env, true);
  runBin("tsx", ["scripts/migrate-check.ts"], env); // the loan-search indexes exist after deploy
  done("Applied every migration.");
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "prisma/seed.ts"], env, true);
  done("Seeded the settings and reference data.");
  say("Building the sample accounts and loans (about a minute)...");
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "scripts/kit-build.ts", "--with-scenarios"], env);

  const { prisma } = await import("@/lib/db");
  try {
    const f = await import("@/lib/seed/foundation");
    await f.applyFoundationSeed(done);
    psql(RESET_SEED_DATABASE, `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('email.active', 'false'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, "updatedAt" = now();`);
    say("");
    say("Users per decided role (active):");
    for (const r of await f.decidedRoleCounts()) say(`  ${r.decided.padEnd(20)} ${r.key.padEnd(11)} ${r.users}`);
    const loans = await prisma.loan.count();
    const pending = await prisma.openItem.count({ where: { status: "PENDING" } });
    say(`Loan files: ${loans}. Pending myloans changes: ${pending}.`);
  } finally {
    await prisma.$disconnect();
  }
  say(`Done: ${RESET_SEED_DATABASE} holds fresh fake data. The dev server reconnects by itself; refresh the page. Sign in at /login (test sign-in).`);
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
