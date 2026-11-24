/**
 * Volume test (D-055): a SEPARATE database (gdfi_dms_volume_test; never gdfi_dms, never the automated tests' database)
 * with fake data at about production scale, and timings of the main screens' server work.
 *
 *   npm run volume -- create    drop and build gdfi_dms_volume_test: migrations, seed, then ~15,000 loans with their
 *                               transactions, inbox and pool items, released loans waiting in the pool, Open Items,
 *                               file access log rows and audit rows (fake borrowers only)
 *   npm run volume -- measure   times Inbox (my items), Branch pool, Open Items, Loans list, TAT report, File access
 *                               log and Find loan, as an LA (two branches), an LA Supervisor/Head and Admin (all
 *                               branches): the median of 3 runs each, in milliseconds
 *
 * Local developer PC only (APP_ENV=local, the Docker database).
 */
import { loadEnvFiles } from "../lib/env/load-files";
import { appEnv } from "../lib/env";
import { databaseExists, ident, psql, runBin } from "../lib/kit/docker";

loadEnvFiles([".env.local", ".env"]);
const NAME = "gdfi_dms_volume_test";
if (appEnv() !== "local") { console.error("Refused: the volume test runs on a developer PC (APP_ENV=local) only."); process.exit(1); }
const base = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!base) { console.error("Refused: DATABASE_URL is not set."); process.exit(1); }
const u = new URL(base);
u.pathname = `/${NAME}`;
const url = u.toString();
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, SEED_TEST_USERS: "true" };
const cmd = process.argv[2];

if (cmd === "create") {
  if (databaseExists(NAME)) psql("postgres", `DROP DATABASE ${ident(NAME)} WITH (FORCE);`);
  psql("postgres", `CREATE DATABASE ${ident(NAME)};`);
  console.log(`Created ${NAME}.`);
  runBin("prisma", ["migrate", "deploy"], env, true);
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "prisma/seed.ts"], env, true);
  console.log("Migrations and seed done. Filling...");
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "scripts/volume-fill.ts"], env);
} else if (cmd === "measure") {
  if (!databaseExists(NAME)) { console.error(`Run npm run volume -- create first.`); process.exit(1); }
  runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "scripts/volume-measure.ts"], env);
} else {
  console.error("Usage: npm run volume -- create | measure");
  process.exit(1);
}
