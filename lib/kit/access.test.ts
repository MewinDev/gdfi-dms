import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visibleSettingsGroups } from "@/lib/ui/settings-groups";
import { assertKitAction, kitPageOrNotFound, kitScreensAvailable } from "./access";
import { kitBackupAction, kitResetAction, kitRestoreAction } from "@/app/actions/kit";
import TestKitPage from "@/app/(app)/admin/test-kit/page";
import TestSheetPage from "@/app/(app)/admin/test-kit/sheet/page";

/**
 * Settings > Test kit on staging, production and with TEST_MODE off: the card is absent, the pages
 * are "not found", and the server actions refuse, even when called directly. Checked on the server
 * from the environment; nothing the browser sends can turn it on.
 */
const saved = { ...process.env };
const local = () => Object.assign(process.env, {
  APP_ENV: "local", TEST_MODE: "true", MYLOANS_MODE: "mock",
  DATABASE_URL: "postgresql://u:p@localhost:5434/gdfi_dms", DIRECT_URL: "postgresql://u:p@localhost:5434/gdfi_dms",
});
beforeEach(local);
afterEach(() => { process.env = { ...saved }; });

const notFound = (e: unknown) => String((e as { digest?: string }).digest ?? "").includes("404");
async function expectNotFound(p: () => unknown) {
  let err: unknown = null;
  try { await p(); } catch (e) { err = e; }
  expect(err, "expected a not-found").not.toBeNull();
  expect(notFound(err)).toBe(true);
}
const form = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

describe.each([
  ["APP_ENV=production", { APP_ENV: "production" }, /not production/],
  ["APP_ENV=staging", { APP_ENV: "staging" }, /not staging/],
  ["TEST_MODE off", { TEST_MODE: "false" }, /needs test mode/],
])("Test kit with %s", (_label, env, message) => {
  beforeEach(() => { Object.assign(process.env, env); });

  it("the Settings card is absent", () => {
    expect(kitScreensAvailable()).toBe(false);
    const cards = visibleSettingsGroups(process.env.TEST_MODE === "true", undefined, kitScreensAvailable()).flatMap((g) => g.cards);
    expect(cards).not.toContain("test-kit");
  });

  it("the pages are not found (Test kit and the test sheet), before any sign-in check", async () => {
    await expectNotFound(() => kitPageOrNotFound());
    await expectNotFound(() => TestKitPage());
    await expectNotFound(() => TestSheetPage());
  });

  it("the server actions refuse, even with the right typed word", async () => {
    expect(() => assertKitAction()).toThrow(message);
    for (const r of [
      await kitResetAction(null, form({ confirm: "RESET" })),
      await kitRestoreAction(null, form({ confirm: "RESET", name: "anything" })),
      await kitBackupAction(null, form({ name: "anything" })),
    ]) {
      expect(r).toMatchObject({ ok: false });
      expect(r!.error).toMatch(message);
    }
  });
});

describe("Test kit on a local test setup", () => {
  it("is available on gdfi_dms only", () => {
    expect(kitScreensAvailable()).toBe(true);
    process.env.DATABASE_URL = process.env.DIRECT_URL = "postgresql://u:p@localhost:5434/gdfi_dms_test";
    expect(kitScreensAvailable()).toBe(false);
  });
});
