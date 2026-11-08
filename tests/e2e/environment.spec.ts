import { expect, test, type Page } from "@playwright/test";

/**
 * Settings > System shows the environment and test mode (never a value); Staging shows a banner;
 * GET /api/health answers without sign-in and without variable names. Works against a server
 * started with APP_ENV=local or APP_ENV=staging (read from /api/health).
 */
async function signInAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as Admin" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: false });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const LABEL = { local: "Local", staging: "Staging", production: "Production" } as const;

test("Health, the environment line in Settings, and the Staging banner", async ({ page, request }) => {
  await page.context().clearCookies();
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["build", "database", "environment", "ok", "version"]);
  expect(body).toMatchObject({ ok: true, database: "up" });
  expect(JSON.stringify(body)).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/); // no variable names
  const env = body.environment as keyof typeof LABEL;

  await signInAsAdmin(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: /^System and test mode/ }).filter({ visible: true }).first()).toContainText(LABEL[env]);
  await page.goto("/admin/settings?open=system");
  const d = page.locator("dialog#settings-modal");
  const line = d.locator("[data-env-line]");
  await expect(line.locator("[data-env]")).toHaveText(LABEL[env]);
  await expect(line.locator("[data-test-mode]")).toHaveText(/^(On|Off)$/);
  if ((await line.locator("[data-test-mode]").textContent()) === "On") await expect(d.locator("[data-test-mode-note]")).toBeVisible();
  await expect(line).not.toContainText(/postgres|https?:\/\/|=/i); // names and labels only, no values
  if (env === "staging") await expect(page.locator("[data-staging-banner]").filter({ visible: true })).toHaveText(/^Staging/);
  else await expect(page.locator("[data-staging-banner]")).toHaveCount(0);
  await shot(page, `settings-environment-${env}`);
  await noSideways(page);
});
