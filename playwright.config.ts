import { defineConfig, devices } from "@playwright/test";

// Run against an already running dev server with:  $env:E2E_BASE_URL="http://localhost:3001"; npm run test:e2e
// The tests reset the loan files: they refuse unless the database is a "test" one or ALLOW_DESTRUCTIVE=1 is set.
// Otherwise Playwright starts `next dev` on port 3100. Tests reset the LOCAL database before each test.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

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
  webServer: {
    command: "npx next dev --port 3100",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
