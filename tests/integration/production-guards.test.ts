/**
 * APP_ENV=production: the test helpers refuse on the server, even for Admin (not only hidden buttons).
 * Simulator, Reset test data, Simulate a MyLoans change, the mock MyLoans and its overrides, the
 * test switches, and the seed with test users. Also GET /api/health against the real database.
 * LOCAL database.
 */
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { simulate } from "@/lib/services/simulator";
import { resetTestData } from "@/lib/services/test-data";
import { simulateSourceChange } from "@/lib/services/source-sync";
import { setMockOverride, setToggle } from "@/lib/services/admin";
import { MockMyLoansAdapter } from "@/lib/myloans/mock-adapter";
import { isTestMode } from "@/lib/test-mode";
import { GET as healthGet } from "@/app/api/health/route";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const PN = "GD1652026901003";
const REFUSED = /is not available in production\./;
const saved = { ...process.env };
let loanId = "";

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.APP_ENV = "local";
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("simulator.enabled", true);
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  loanId = (await prisma.loan.findUniqueOrThrow({ where: { pn: PN } })).id;
  process.env.APP_ENV = "production"; // TEST_MODE stays "true" on purpose: the guards must not rely on it
});
afterEach(() => {
  process.env = { ...saved };
});
afterAll(async () => {
  await setSetting("simulator.enabled", false);
  await cleanLoans();
});

describe("APP_ENV=production: test helpers refuse on the server, even for Admin", () => {
  it("the test simulator", async () => {
    const before = await prisma.auditLog.count();
    await expect(simulate(admin, { loanId, action: "TRANSMIT" })).rejects.toThrow("The test simulator is not available in production.");
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it("Reset test data (the loan file is still there)", async () => {
    await expect(resetTestData(admin)).rejects.toThrow("Reset test data is not available in production.");
    expect(await prisma.loan.count({ where: { pn: PN } })).toBe(1);
  });

  it("Simulate a MyLoans change", async () => {
    await expect(simulateSourceChange(admin, loanId, "amount")).rejects.toThrow("Simulate a MyLoans change is not available in production.");
  });

  it("the mock MyLoans: its overrides and the adapter itself", async () => {
    const before = await getSetting("myloans.mockOverrides");
    await expect(setMockOverride(admin, PN, 1)).rejects.toThrow(REFUSED);
    expect(await getSetting("myloans.mockOverrides")).toEqual(before);
    expect(() => new MockMyLoansAdapter()).toThrow("The sample MyLoans (mock) is not available in production.");
  });

  it("the test switches (simulator, MyLoans unavailable, sample loans)", async () => {
    await setSetting("simulator.enabled", false);
    await expect(setToggle(admin, "simulator.enabled", true)).rejects.toThrow(REFUSED);
    await expect(setToggle(admin, "myloans.simulateUnavailable", true)).rejects.toThrow(REFUSED);
    await expect(setToggle(admin, "samples.showDataCheck", true)).rejects.toThrow(REFUSED);
    expect(await getSetting("simulator.enabled")).toBe(false);
  });

  it("test mode reads as off (no sample loans, no email redirection or [TEST])", () => {
    expect(process.env.TEST_MODE).toBe("true");
    expect(isTestMode()).toBe(false);
    process.env.APP_ENV = "staging";
    expect(isTestMode()).toBe(true);
  });

  it("the seed refuses test users", () => {
    const users = spawnSync("npx tsx prisma/seed.ts", { shell: true, encoding: "utf8", env: { ...process.env, APP_ENV: "production", SEED_TEST_USERS: "" }, timeout: 60_000 });
    expect(users.status).toBe(1);
    expect(users.stderr).toContain("Seeding test users is not available in production.");
  });

  it("the same helpers still work outside production", async () => {
    process.env.APP_ENV = "local";
    await expect(simulateSourceChange(admin, loanId, "amount")).resolves.toBeTypeOf("string");
    expect(() => new MockMyLoansAdapter()).not.toThrow();
  });
});

describe("GET /api/health", () => {
  it("answers ok with the database up, and no variable names or values", async () => {
    process.env.APP_ENV = "staging";
    const res = await healthGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, environment: "staging", database: "up" });
    const text = JSON.stringify(body);
    for (const [name, value] of Object.entries(process.env)) {
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(name)) expect(text.includes(name), name).toBe(false);
      if (value && value.length >= 8) expect(text.includes(value), `value of ${name}`).toBe(false);
    }
  });
});
