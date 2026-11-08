import { describe, expect, it } from "vitest";
import { databaseName, databaseUrlMismatch, loadEnvFiles } from "./load-files";
import { destructiveRefusal } from "./destructive";

/** Fake files, no disk and no database. */
const files: Record<string, string> = {
  ".env.local": "DATABASE_URL=postgresql://u:p@localhost:5434/from_local\nONLY_LOCAL=local\nBOTH=local\n",
  ".env": "DATABASE_URL=postgresql://u:p@localhost:5434/from_env\nONLY_ENV=env\nBOTH=env\n",
};
const read = (f: string) => files[f] ?? null;

describe("env files: the shell wins, then .env.local, then .env", () => {
  it("keeps a value set in the shell", () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: "postgresql://u:p@localhost:5434/from_shell" };
    const from = loadEnvFiles([".env.local", ".env"], env, read);
    expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5434/from_shell");
    expect(from.DATABASE_URL).toBe("shell");
  });

  it(".env.local wins over .env; .env fills the rest", () => {
    const env: Record<string, string | undefined> = {};
    const from = loadEnvFiles([".env.local", ".env"], env, read);
    expect(env).toMatchObject({ DATABASE_URL: "postgresql://u:p@localhost:5434/from_local", BOTH: "local", ONLY_LOCAL: "local", ONLY_ENV: "env" });
    expect(from).toMatchObject({ DATABASE_URL: ".env.local", BOTH: ".env.local", ONLY_ENV: ".env" });
  });

  it("a missing file is skipped", () => {
    const env: Record<string, string | undefined> = {};
    loadEnvFiles([".env.missing", ".env"], env, read);
    expect(env.BOTH).toBe("env");
  });
});

describe("DATABASE_URL and DIRECT_URL must name the same database", () => {
  it("reads the database name", () => {
    expect(databaseName("postgresql://u:p@localhost:5434/gdfi_dms?schema=public")).toBe("gdfi_dms");
    expect(databaseName("not a url")).toBeNull();
    expect(databaseName(undefined)).toBeNull();
  });

  it("refuses when only one of them was pointed elsewhere", () => {
    expect(databaseUrlMismatch({ DATABASE_URL: "postgresql://u:p@localhost:5434/scratch", DIRECT_URL: "postgresql://u:p@localhost:5434/gdfi_dms" }))
      .toBe('DATABASE_URL and DIRECT_URL name different databases ("scratch" and "gdfi_dms"). Set both to the same database.');
    // Production: pooled and direct connections to the same database are fine.
    expect(databaseUrlMismatch({ DATABASE_URL: "postgresql://u:p@pool:6543/postgres?pgbouncer=true", DIRECT_URL: "postgresql://u:p@db:5432/postgres" })).toBeNull();
    expect(databaseUrlMismatch({ DATABASE_URL: "postgresql://u:p@localhost:5434/gdfi_dms" })).toBeNull();
  });
});

describe("destructive commands: a test database, or ALLOW_DESTRUCTIVE=1; never on staging or production", () => {
  const main = "postgresql://u:p@localhost:5434/gdfi_dms";
  const test = "postgresql://u:p@localhost:5434/gdfi_dms_test";
  it("refuses the main database unless ALLOW_DESTRUCTIVE=1", () => {
    expect(destructiveRefusal("npm run db:reset", { DATABASE_URL: main })).toBe('npm run db:reset would change the database "gdfi_dms". Use a database with "test" in its name, or set ALLOW_DESTRUCTIVE=1 if you mean it.');
    expect(destructiveRefusal("npm run db:reset", { DATABASE_URL: main, ALLOW_DESTRUCTIVE: "1" })).toBeNull();
    expect(destructiveRefusal("npm run db:reset", { DATABASE_URL: main, ALLOW_DESTRUCTIVE: "yes" })).not.toBeNull();
  });

  it("allows a database with test in its name (both URLs)", () => {
    expect(destructiveRefusal("npm run db:reset", { DATABASE_URL: test, DIRECT_URL: test })).toBeNull();
    expect(destructiveRefusal("npm run db:reset", { DATABASE_URL: test, DIRECT_URL: main })).not.toBeNull();
  });

  it("never on staging or production, even with ALLOW_DESTRUCTIVE=1 and a test database", () => {
    for (const APP_ENV of ["staging", "production", " Production "]) {
      expect(destructiveRefusal("npm run db:reset", { APP_ENV, DATABASE_URL: test, ALLOW_DESTRUCTIVE: "1" })).toMatch(/never runs when APP_ENV is (staging|production)\./);
    }
  });

  it("refuses when no database is set, and never shows the password", () => {
    expect(destructiveRefusal("x", {})).toBe("x: DATABASE_URL is not set.");
    expect(destructiveRefusal("x", { DATABASE_URL: "postgresql://u:secret@localhost/gdfi_dms" })).not.toContain("secret");
  });
});
