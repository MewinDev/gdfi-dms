import { describe, expect, it } from "vitest";
import { authMode, newUsersAreTestUsers, safeNext, testSignInAllowed } from "./mode";

describe("authMode", () => {
  it.each([
    [{ AUTH_MODE: "entra", APP_ENV: "local" }, "entra"],
    [{ AUTH_MODE: "test", APP_ENV: "production" }, "test"],
    [{ APP_ENV: "local" }, "test"],
    [{}, "test"], // APP_ENV not set counts as local
    [{ APP_ENV: "staging" }, "entra"],
    [{ APP_ENV: "production" }, "entra"],
    [{ APP_ENV: "prod" }, "entra"], // an unknown APP_ENV is never local
  ] as const)("%o -> %s", (env, mode) => {
    expect(authMode(env)).toBe(mode);
  });
});

describe("testSignInAllowed (test sign-in is local only)", () => {
  it("allows local with test mode", () => {
    expect(testSignInAllowed({ APP_ENV: "local", AUTH_MODE: "test" })).toBe(true);
    expect(testSignInAllowed({ APP_ENV: "local" })).toBe(true);
  });
  it.each(["staging", "production", "prod"])("refuses APP_ENV=%s even with AUTH_MODE=test", (appEnv) => {
    expect(testSignInAllowed({ APP_ENV: appEnv, AUTH_MODE: "test" })).toBe(false);
  });
  it("refuses local with AUTH_MODE=entra", () => {
    expect(testSignInAllowed({ APP_ENV: "local", AUTH_MODE: "entra" })).toBe(false);
  });
});

describe("newUsersAreTestUsers", () => {
  it("is true only where test sign-in is allowed", () => {
    expect(newUsersAreTestUsers({ APP_ENV: "local" })).toBe(true);
    expect(newUsersAreTestUsers({ APP_ENV: "production", AUTH_MODE: "test" })).toBe(false);
    expect(newUsersAreTestUsers({ APP_ENV: "staging" })).toBe(false);
  });
});

describe("safeNext", () => {
  it.each([
    ["/loans/GD1", "/loans/GD1"],
    ["/dashboard?tab=x", "/dashboard?tab=x"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/\\/evil.example", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["/login", "/dashboard"],
    ["/login?next=/x", "/dashboard"],
    ["", "/dashboard"],
    [null, "/dashboard"],
    [42, "/dashboard"],
  ])("%s -> %s", (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});
