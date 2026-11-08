import path from "node:path";
import { defineConfig } from "prisma/config";
import { databaseUrlMismatch, loadEnvFiles } from "./lib/env/load-files";

/**
 * Prisma CLI (generate, migrate dev, migrate deploy, studio, db seed). With this file present Prisma
 * no longer reads .env by itself, so load the files here in the same order as Next.js. A variable
 * already set (shell, CI, hosting provider) always wins, then .env.local, then .env; in production
 * there are no files and the host's variables are used (lib/env/load-files.ts, unit-tested).
 * Migrations connect through DIRECT_URL and the app through DATABASE_URL: if they name different
 * databases (for example only one was set in the shell), refuse rather than touch the wrong one.
 */
loadEnvFiles([path.resolve(".env.local"), path.resolve(".env")]);
const mismatch = databaseUrlMismatch();
if (mismatch) throw new Error(mismatch);

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // The variables are already loaded above and passed on to the seed.
    seed: "tsx --require=./scripts/server-only-stub.cjs prisma/seed.ts",
  },
});
