import { defineConfig, devices } from "@playwright/test";
import { loadEnvFiles } from "./lib/env/load-files";
import { testDatabaseUrl } from "./lib/env/test-db";

// The e2e tests use the test database (gdfi_dms_test), never the person's own gdfi_dms. Playwright starts
// its own `next dev` on port 3100 with DATABASE_URL pointed at the test database and its own build folder
// (.next-e2e), so it runs beside the person's server on port 3000. Create the database once with
// `npm run db:create-test`. The global setup checks the server really reads the test database, so an
// E2E_BASE_URL pointing at the person's own server is refused.
const fromFiles: Record<string, string | undefined> = {};
loadEnvFiles([".env.local", ".env"], fromFiles);
const testDb = testDatabaseUrl({ ...fromFiles, ...process.env }) ?? "";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const E2E_DEV = process.env.E2E_SERVER === "dev";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // tests share one database
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-820", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  // A production build (next build, then next start) by default: much less memory than next dev, and no
  // compiling during a test. E2E_SERVER=dev uses next dev as before. E2E_SKIP_BUILD=1 starts the build
  // already made (npm run e2e:groups builds once, then starts it for each group). Own build folders, so
  // it never touches the person's .next.
  webServer: {
    command: E2E_DEV
      ? "npx next dev --port 3100"
      : process.env.E2E_SKIP_BUILD === "1" ? "npx next start --port 3100" : "npx next build && npx next start --port 3100",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 600_000,
    env: { DATABASE_URL: testDb, DIRECT_URL: testDb, NEXT_DIST_DIR: E2E_DEV ? ".next-e2e" : ".next-e2e-prod", APP_BASE_URL: "http://localhost:3100" },
  },
});
