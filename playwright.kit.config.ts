import { defineConfig, devices } from "@playwright/test";

// The Manual Test Kit screens, against the person's own server on gdfi_dms in the starting state
// (npm run kit:start first). Not part of npm run test:e2e: it signs in (which adds sign-in rows to the
// audit log), so run npm run kit:reset afterwards. It changes nothing else and refuses unless the
// server shows the kit's sample accounts.
//   npm run test:kit-screens        (KIT_BASE_URL defaults to http://localhost:3000)
export default defineConfig({
  testDir: "./tests/e2e-kit",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.KIT_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-820", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
