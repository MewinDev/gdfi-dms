import { describe, expect, it } from "vitest";
import { resetSeedRefusal } from "./reset-seed-guard";

const DEV = "postgresql://u:p@localhost:5434/gdfi_dms?schema=public";
const ok = { APP_ENV: "local", DATABASE_URL: DEV, DIRECT_URL: DEV, ALLOW_DESTRUCTIVE: "1" };

describe("resetSeedRefusal (npm run db:reset-seed)", () => {
  it("allows the local dev database with APP_ENV=local and ALLOW_DESTRUCTIVE=1", () => {
    expect(resetSeedRefusal(ok)).toBeNull();
  });

  it.each(["production", "staging", "", undefined, "Local-ish"])("refuses APP_ENV %s", (appEnv) => {
    expect(resetSeedRefusal({ ...ok, APP_ENV: appEnv })).toMatch(/only when APP_ENV is local/);
  });

  it("refuses without ALLOW_DESTRUCTIVE=1", () => {
    expect(resetSeedRefusal({ ...ok, ALLOW_DESTRUCTIVE: undefined })).toMatch(/ALLOW_DESTRUCTIVE=1/);
  });

  it("never touches the test database, even with ALLOW_DESTRUCTIVE=1", () => {
    const t = "postgresql://u:p@localhost:5434/gdfi_dms_test";
    expect(resetSeedRefusal({ ...ok, DATABASE_URL: t, DIRECT_URL: t })).toMatch(/only the local development database gdfi_dms/);
  });

  it("refuses when DIRECT_URL points elsewhere", () => {
    expect(resetSeedRefusal({ ...ok, DIRECT_URL: "postgresql://u:p@localhost:5434/other" })).toMatch(/"other"/);
  });

  it("refuses a database that is not on this computer", () => {
    const remote = "postgresql://u:p@db.example.com:5432/gdfi_dms";
    expect(resetSeedRefusal({ ...ok, DATABASE_URL: remote, DIRECT_URL: remote })).toMatch(/localhost/);
  });

  it("refuses when DATABASE_URL is missing", () => {
    expect(resetSeedRefusal({ APP_ENV: "local", ALLOW_DESTRUCTIVE: "1" })).toMatch(/not set/);
  });

  it("never shows the password", () => {
    const remote = "postgresql://u:secretpw@db.example.com:5432/gdfi_dms";
    expect(resetSeedRefusal({ ...ok, DATABASE_URL: remote, DIRECT_URL: remote })).not.toContain("secretpw");
  });
});
