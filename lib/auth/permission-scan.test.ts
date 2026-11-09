import { describe, expect, it } from "vitest";
import { ALLOW_LIST, scanServerEntries } from "./permission-scan";

/**
 * Keeps "the server is the real check" true: a new server action or route handler without a permission
 * check fails here. Add a check (requirePermission / requireAnyPermission / can), or, only for sign-in,
 * health, cron or the person's own settings, an ALLOW_LIST entry with the reason.
 */
describe("every server action and route handler checks a permission", () => {
  const results = scanServerEntries();

  it("finds the actions and routes", () => {
    expect(results.length).toBeGreaterThan(80);
    expect(results.some((r) => r.file === "app/actions/loan.ts" && r.name === "refreshLoanAction")).toBe(true);
    expect(results.some((r) => r.file === "app/api/loans/export/route.ts" && r.name === "GET")).toBe(true);
  });

  it("none is missing a check", () => {
    expect(results.filter((r) => !r.ok).map((r) => `${r.file} ${r.name}: ${r.how}`)).toEqual([]);
  });

  it("the allow-list is short and every entry still exists", () => {
    expect(ALLOW_LIST.length).toBeLessThanOrEqual(8);
    for (const a of ALLOW_LIST) expect(results.find((r) => r.file === a.file && r.name === a.name), `${a.file} ${a.name}`).toBeTruthy();
  });

  it("the scan would catch a handler without a check (Refresh is checked)", () => {
    expect(results.find((r) => r.name === "refreshLoanAction")?.how).toBe("check");
    expect(results.find((r) => r.file === "app/actions/kit.ts" && r.name === "kitResetAction")?.how).toBe("via kitUser()");
  });
});
