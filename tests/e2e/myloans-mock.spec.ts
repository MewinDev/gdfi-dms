import { expect, test } from "@playwright/test";
import { db } from "./db";
import { signIn } from "./helpers";

/**
 * Piece 6 (D-048): the myloans mock over real HTTP (through the proxy), the "MOCK myloans data" banner on every page,
 * and the Settings, System "myloans mock" panel (failure switches, scenarios). The e2e server runs MYLOANS_MODE=mock.
 */
const BASE = "/api/dev/myloans/api/dms/v1";
const KEY = process.env.MYLOANS_API_KEY?.trim() || "local-mock-key";

test.beforeEach(async () => {
  await db.setting.upsert({ where: { key: "myloans.mockFailures" }, create: { key: "myloans.mockFailures", value: [] }, update: { value: [] } });
});
test.afterAll(async () => {
  await db.setting.upsert({ where: { key: "myloans.mockFailures" }, create: { key: "myloans.mockFailures", value: [] }, update: { value: [] } });
});

test("the mock answers over HTTP with the agreed shapes; without the key it is 401; no session needed", async ({ request }) => {
  const products = await request.get(`${BASE}/products`, { headers: { authorization: `Bearer ${KEY}` } });
  expect(products.status()).toBe(200);
  expect((await products.json()).items.length).toBeGreaterThan(0);
  const page = await request.get(`${BASE}/loans/changes?since=${encodeURIComponent("2020-01-01T00:00:00+08:00")}&afterId=0&limit=5`, { headers: { authorization: `Bearer ${KEY}` } });
  expect(page.status()).toBe(200);
  const body = await page.json();
  expect(body).toHaveProperty("runStartedAt");
  expect(body.items.length).toBeLessThanOrEqual(10);
  expect((await request.get(`${BASE}/products`)).status()).toBe(401);
  expect((await request.get(`${BASE}/loans/GD000000000000`, { headers: { authorization: `Bearer ${KEY}` } })).status()).toBe(404);
});

test("the MOCK banner is on every page; the panel switches a failure on and off and adds a scenario", async ({ page, request }) => {
  await signIn(page, "admin");
  for (const path of ["/dashboard", "/loans", "/admin/settings"]) {
    await page.goto(path);
    await expect(page.locator("[data-mock-banner]")).toContainText("MOCK myloans data");
  }
  await page.goto("/admin/settings?open=system");
  const panel = page.locator("[data-myloans-mock]");
  await expect(panel).toContainText("None: every call answers normally.");
  await panel.getByLabel("Which call").selectOption({ label: "API 5 (products)" });
  await panel.getByLabel("How it fails").selectOption({ label: "Unavailable (503)" });
  await panel.getByLabel("Next call only").uncheck();
  await panel.getByRole("button", { name: "Switch on" }).click();
  await expect(panel.locator("[data-mock-failure='products:unavailable']")).toBeVisible();
  await expect.poll(async () => (await request.get(`${BASE}/products`, { headers: { authorization: `Bearer ${KEY}` } })).status()).toBe(503);
  await panel.getByRole("button", { name: "Switch every failure off" }).click();
  await expect(panel).toContainText("None: every call answers normally.");
  expect((await request.get(`${BASE}/products`, { headers: { authorization: `Bearer ${KEY}` } })).status()).toBe(200);
  await panel.getByLabel("Add a scenario").selectOption({ label: "Two records for one PN # (API 1 answers 409)" });
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel.getByText(/has two records \(API 1 answers 409\)/)).toBeVisible();
  expect(await db.auditLog.count({ where: { action: { in: ["myloans_mock_failure_on", "myloans_mock_scenario"] } } })).toBeGreaterThanOrEqual(2);
});
