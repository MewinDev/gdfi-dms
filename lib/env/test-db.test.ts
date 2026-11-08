import { describe, expect, it } from "vitest";
import { databaseName } from "./load-files";
import { testDatabaseRefusal, testDatabaseUrl, pointAtTestDatabase, withDatabaseName } from "./test-db";

const url = (db: string) => `postgresql://gdfi:secret@localhost:5434/${db}?schema=public`;

describe("The automated tests' database", () => {
  it("is gdfi_dms_test: DATABASE_URL with the name swapped, or TEST_DATABASE_URL", () => {
    expect(databaseName(testDatabaseUrl({ DATABASE_URL: url("gdfi_dms") })!)).toBe("gdfi_dms_test");
    expect(testDatabaseUrl({ DATABASE_URL: url("gdfi_dms") })).toBe(url("gdfi_dms_test"));
    expect(testDatabaseUrl({ DATABASE_URL: url("gdfi_dms"), TEST_DATABASE_URL: url("my_test") })).toBe(url("my_test"));
    expect(testDatabaseUrl({})).toBeNull();
    expect(withDatabaseName(url("a"), "b")).toBe(url("b"));
  });

  it("pointAtTestDatabase points both URLs at it", () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: url("gdfi_dms"), DIRECT_URL: url("gdfi_dms") };
    expect(pointAtTestDatabase(env)).toBe("gdfi_dms_test");
    expect([databaseName(env.DATABASE_URL), databaseName(env.DIRECT_URL)]).toEqual(["gdfi_dms_test", "gdfi_dms_test"]);
  });

  it("the test setup refuses gdfi_dms, even with ALLOW_DESTRUCTIVE=1", () => {
    const main = { DATABASE_URL: url("gdfi_dms"), DIRECT_URL: url("gdfi_dms") };
    expect(testDatabaseRefusal("The integration tests", main)).toBe('The integration tests only run on a test database. "gdfi_dms" is not one (expected gdfi_dms_test).');
    expect(testDatabaseRefusal("The integration tests", { ...main, ALLOW_DESTRUCTIVE: "1" })).not.toBeNull();
    expect(testDatabaseRefusal("x", { DATABASE_URL: url("gdfi_dms_test"), DIRECT_URL: url("gdfi_dms") })).toMatch(/"gdfi_dms" is not one/);
    expect(testDatabaseRefusal("x", { DATABASE_URL: url("gdfi_dms_test"), DIRECT_URL: url("gdfi_dms_test") })).toBeNull();
    expect(testDatabaseRefusal("x", { DATABASE_URL: "postgresql://u:p@db.example.com:5432/gdfi_dms_test" })).toMatch(/on this PC/);
    expect(testDatabaseRefusal("x", { DATABASE_URL: url("gdfi_dms") })).not.toContain("secret");
  });

  it("this test run itself is on the test database (Vitest config), never on gdfi_dms", () => {
    expect(databaseName(process.env.DATABASE_URL)).toBe("gdfi_dms_test");
    expect(databaseName(process.env.DIRECT_URL)).toBe("gdfi_dms_test");
    expect(testDatabaseRefusal("This run")).toBeNull();
  });
});
