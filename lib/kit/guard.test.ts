import { describe, expect, it } from "vitest";
import { backupNameRefusal, blankGraph, confirmRefusal, kitRefusal, migrationsDiffer, OUT_OF_DATE } from "./guard";

const url = (db: string, host = "localhost:5434") => `postgresql://u:secret@${host}/${db}?schema=public`;
const ok = { APP_ENV: "local", TEST_MODE: "true", MYLOANS_MODE: "mock", DATABASE_URL: url("gdfi_dms"), DIRECT_URL: url("gdfi_dms") };

describe("Manual Test Kit guard", () => {
  it("allows a local test setup on gdfi_dms", () => {
    expect(kitRefusal(ok)).toBeNull();
    expect(kitRefusal({ ...ok, MYLOANS_MODE: undefined })).toBeNull(); // mock is the default
  });

  it("APP_ENV: only exactly local; never staging or production; not unset", () => {
    expect(kitRefusal({ ...ok, APP_ENV: "production" })).toBe("The Manual Test Kit runs only on a developer PC (APP_ENV=local), not production.");
    expect(kitRefusal({ ...ok, APP_ENV: "staging" })).toMatch(/not staging/);
    expect(kitRefusal({ ...ok, APP_ENV: undefined })).toMatch(/APP_ENV=local/);
    expect(kitRefusal({ ...ok, APP_ENV: " Local " })).toBeNull();
  });

  it("TEST_MODE must be true", () => {
    expect(kitRefusal({ ...ok, TEST_MODE: "" })).toBe("The Manual Test Kit needs test mode (TEST_MODE=true).");
    expect(kitRefusal({ ...ok, TEST_MODE: "false" })).not.toBeNull();
  });

  it("the sample MyLoans, not the live one", () => {
    expect(kitRefusal({ ...ok, MYLOANS_MODE: "live" })).toMatch(/MYLOANS_MODE=mock/);
  });

  it("allow-list: gdfi_dms only; never the automated tests' gdfi_dms_test; both URLs; this PC only", () => {
    expect(kitRefusal({ ...ok, DATABASE_URL: url("gdfi_dms_test"), DIRECT_URL: url("gdfi_dms_test") })).toBe('The Manual Test Kit works only on gdfi_dms, not "gdfi_dms_test".');
    expect(kitRefusal({ ...ok, DIRECT_URL: url("other") })).toMatch(/not "other"/);
    expect(kitRefusal({ ...ok, DATABASE_URL: url("gdfi_dms", "db.example.com:5432"), DIRECT_URL: url("gdfi_dms", "db.example.com:5432") })).toMatch(/this PC/);
    expect(kitRefusal({ ...ok, DATABASE_URL: undefined, DIRECT_URL: undefined })).toMatch(/DATABASE_URL is not set/);
    expect(kitRefusal({ ...ok, DATABASE_URL: url("gdfi_dms_test"), DIRECT_URL: url("gdfi_dms_test") })).not.toContain("secret");
  });

  it("email: the scripts blank the Microsoft Graph values for their run", () => {
    const env: Record<string, string | undefined> = { ...ok, GRAPH_CLIENT_ID: "id", GRAPH_CLIENT_SECRET: "s", GRAPH_TENANT_ID: "", GRAPH_SENDER_EMAIL: "dms@gdfi.ph" };
    expect(blankGraph(env)).toEqual(["GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_SENDER_EMAIL"]);
    expect([env.GRAPH_CLIENT_ID, env.GRAPH_CLIENT_SECRET, env.GRAPH_TENANT_ID, env.GRAPH_SENDER_EMAIL]).toEqual(["", "", "", ""]);
  });

  it("typed confirmation: exactly RESET", () => {
    expect(confirmRefusal("RESET")).toBeNull();
    expect(confirmRefusal(" RESET ")).toBeNull();
    for (const typed of ["reset", "Reset", "", null, undefined, "RESET!"]) expect(confirmRefusal(typed)).toBe("Type RESET to confirm.");
  });

  it("out-of-date baseline: any difference in the migration list", () => {
    const now = ["20261106060100_init", "20261119090000_hold_transfer_and_papers_back"];
    expect(migrationsDiffer(now, [...now])).toBe(false);
    expect(migrationsDiffer(now.slice(0, 1), now)).toBe(true);
    expect(migrationsDiffer([now[1], now[0]], now)).toBe(true);
    expect(OUT_OF_DATE).toBe("The baseline is out of date. Run `npm run kit:rebuild`.");
  });

  it("backup names", () => {
    expect(backupNameRefusal("after-funds_1")).toBeNull();
    expect(backupNameRefusal("")).toBe("Give the backup a name.");
    expect(backupNameRefusal("../x")).toMatch(/letters, digits/);
    expect(backupNameRefusal("a b")).toMatch(/letters, digits/);
    expect(backupNameRefusal("baseline")).toMatch(/used by the kit/);
    expect(backupNameRefusal("pre-reset-1")).toMatch(/used by the kit/);
    expect(backupNameRefusal("x".repeat(61))).toMatch(/up to 60/);
  });
});
