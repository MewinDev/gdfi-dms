/**
 * npm run db:create-test: creates the automated tests' database (gdfi_dms_test) in the local Docker
 * container, applies every migration and seeds it (reference data and the test users). Safe to run
 * again: an existing database is kept and only brought up to date. The person's own gdfi_dms is never
 * touched. A Docker init script would only run on a new volume, so this uses CREATE DATABASE.
 */
import { loadEnvFiles } from "../lib/env/load-files";
import { appEnv } from "../lib/env";
import { assertTestDatabase, testDatabaseUrl, TEST_DATABASE_NAME } from "../lib/env/test-db";
import { databaseExists, ident, psql, runBin } from "../lib/kit/docker";

loadEnvFiles([".env.local", ".env"]);
if (appEnv() !== "local") {
  console.error(`Refused: npm run db:create-test is for a developer PC (APP_ENV=local), not ${appEnv()}.`);
  process.exit(1);
}
const url = testDatabaseUrl();
if (!url) {
  console.error("Refused: DATABASE_URL is not set (see docs/ENVIRONMENT.md).");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, SEED_TEST_USERS: "true" };
assertTestDatabase("npm run db:create-test", env);
const name = new URL(url).pathname.slice(1) || TEST_DATABASE_NAME;

console.log(`Will: create the database ${name} if it is missing, apply the migrations, seed the reference data and test users.`);
if (databaseExists(name)) {
  console.log(`- ${name} already exists: kept.`);
} else {
  psql("postgres", `CREATE DATABASE ${ident(name)};`);
  console.log(`- Created ${name}.`);
}
runBin("prisma", ["migrate", "deploy"], env);
console.log("- Migrations applied.");
runBin("tsx", ["--require=./scripts/server-only-stub.cjs", "prisma/seed.ts"], env);
console.log(`Done: ${name} is ready for npm test and npm run test:e2e.`);
