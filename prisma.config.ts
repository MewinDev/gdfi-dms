import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI (generate, migrate dev, migrate deploy, studio, db seed). With this file present Prisma
 * no longer reads .env by itself, so load the files here in the same order as Next.js: .env.local
 * first, then .env. A variable already set (shell, CI, hosting provider) always wins; in production
 * there are no files and the host's variables are used.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.resolve(file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // The variables are already loaded above and passed on to the seed.
    seed: "tsx --require=./scripts/server-only-stub.cjs prisma/seed.ts",
  },
});
