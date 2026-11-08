import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnv, refusalMessage, type Env } from "./check";
import { appEnv, assertEnvAtStartup, isProduction, myLoansBaseUrl, refuseInProduction, resetEnvWarnings } from "./index";

// Values that must never appear in a message. Built at run time (the repo scan stays clean).
const V = {
  db: ["postgresql://app:", "Pw9", "Kx2", "Lm7", "@db.abcd.supabase.co:6543/postgres"].join(""),
  direct: ["postgresql://app:", "Pw9", "Kx2", "Lm7", "@db.abcd.supabase.co:5432/postgres"].join(""),
  cron: ["Cr0n", "Q7w", "E9r", "T1y", "U3i", "O5p", "A2s", "D4f"].join(""),
  session: "S".repeat(20) + ["Kd8", "Jf6", "Hg4", "Lz2", "Mx9"].join(""),
  myloansUrl: ["https://", "myloans-api", ".internal.gdfi.ph"].join(""),
  myloansKey: ["Mk", "77", "Lq", "88", "Zp", "99", "Wv"].join(""),
};

/** A complete, valid production environment. Each test breaks one thing. */
const PROD: Env = {
  APP_ENV: "production", TEST_MODE: "false", MYLOANS_MODE: "live", DATABASE_URL: V.db, DIRECT_URL: V.direct,
  APP_BASE_URL: "https://dms.gdfi.ph", CRON_SECRET: V.cron, SESSION_SECRET: V.session, MYLOANS_BASE_URL: V.myloansUrl, MYLOANS_API_KEY: V.myloansKey,
  GRAPH_CLIENT_ID: "cid", GRAPH_CLIENT_SECRET: "gsec", GRAPH_TENANT_ID: "tid", GRAPH_SENDER_EMAIL: "no-reply@gdfi.ph", AUTH_MODE: "entra",
};
const secretsIn = (s: string) => Object.values(V).filter((v) => s.includes(v));

/** One production refusal: exactly one error, naming the variable, never a value. */
function refuses(over: Env, name: string) {
  const r = checkEnv({ ...PROD, ...over });
  expect(r.errors, JSON.stringify(r.errors)).toHaveLength(1);
  expect(r.errors[0]).toContain(name);
  const msg = refusalMessage(r);
  expect(msg).toContain("GDFI DMS will not start (Production)");
  expect(secretsIn(msg)).toEqual([]);
  for (const v of Object.values(over)) if (v && v.length > 5) expect(msg).not.toContain(v);
  return r.errors[0];
}

describe("APP_ENV=production refuses to start", () => {
  it("passes with a complete, safe set", () => {
    const r = checkEnv(PROD);
    expect(r).toEqual({ appEnv: "production", errors: [], warnings: [] });
  });
  it("TEST_MODE is true", () => expect(refuses({ TEST_MODE: "true" }, "TEST_MODE")).toBe("TEST_MODE must be false in production."));
  it("MYLOANS_MODE is not live", () => expect(refuses({ MYLOANS_MODE: "mock" }, "MYLOANS_MODE")).toBe("MYLOANS_MODE must be live in production."));
  it("MYLOANS_MODE is missing (mock by default)", () => refuses({ MYLOANS_MODE: "" }, "MYLOANS_MODE"));
  it("DATABASE_URL is missing", () => refuses({ DATABASE_URL: "" }, "DATABASE_URL"));
  it("DATABASE_URL points to localhost", () => refuses({ DATABASE_URL: "postgresql://gdfi:fake-pw-9@localhost:5434/gdfi_dms" }, "DATABASE_URL"));
  it("DIRECT_URL is missing", () => refuses({ DIRECT_URL: undefined }, "DIRECT_URL"));
  it("DIRECT_URL points to 127.0.0.1", () => refuses({ DIRECT_URL: "postgresql://gdfi:fake-pw-9@127.0.0.1:5432/x" }, "DIRECT_URL"));
  it("DIRECT_URL points to localhost written another way", () => {
    refuses({ DIRECT_URL: "postgresql://gdfi:fake-pw-9@localhost.:5432/x" }, "DIRECT_URL");
    refuses({ DIRECT_URL: "postgresql://gdfi:fake-pw-9@[::1]:5432/x" }, "DIRECT_URL");
  });
  it("APP_BASE_URL is missing", () => refuses({ APP_BASE_URL: "" }, "APP_BASE_URL"));
  it("APP_BASE_URL is not https", () => refuses({ APP_BASE_URL: "http://dms.gdfi.ph" }, "APP_BASE_URL"));
  it("APP_BASE_URL is localhost", () => refuses({ APP_BASE_URL: "https://localhost:3001" }, "APP_BASE_URL"));
  it("CRON_SECRET is missing", () => refuses({ CRON_SECRET: "" }, "CRON_SECRET"));
  it("CRON_SECRET is shorter than 24 characters", () => refuses({ CRON_SECRET: "fake-cron-short-18" }, "CRON_SECRET"));
  it("MYLOANS_BASE_URL is missing", () => refuses({ MYLOANS_BASE_URL: "" }, "MYLOANS_BASE_URL"));
  it("MYLOANS_API_KEY is missing", () => refuses({ MYLOANS_API_KEY: "  " }, "MYLOANS_API_KEY"));
  it("SESSION_SECRET is missing or short", () => {
    refuses({ SESSION_SECRET: "" }, "SESSION_SECRET");
    refuses({ SESSION_SECRET: "Ab12Cd34Ef56" }, "SESSION_SECRET");
  });
  it("lists every problem at once (TEST_MODE true on a PC's settings)", () => {
    const r = checkEnv({ APP_ENV: "production", TEST_MODE: "true", DATABASE_URL: "postgresql://gdfi:fake-pw-9@localhost:5434/gdfi_dms" });
    const names = r.errors.map((e) => e.split(" ")[0]);
    expect(names).toEqual(expect.arrayContaining(["TEST_MODE", "MYLOANS_MODE", "DATABASE_URL", "DIRECT_URL", "APP_BASE_URL", "CRON_SECRET", "SESSION_SECRET", "MYLOANS_BASE_URL", "MYLOANS_API_KEY"]));
    expect(refusalMessage(r)).not.toContain("fake-pw-9");
  });
});

describe("warnings only", () => {
  it("EMAIL_AUTO_DRAIN=false warns, does not refuse", () => {
    const r = checkEnv({ ...PROD, EMAIL_AUTO_DRAIN: "false" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("EMAIL_AUTO_DRAIN");
  });
  it("missing Graph values warn (emails stay Not set up)", () => {
    const r = checkEnv({ ...PROD, GRAPH_CLIENT_SECRET: "", GRAPH_TENANT_ID: undefined });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(["GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID are not set: emails stay Not set up."]);
  });
  it("AUTH_MODE=test in production warns", () => {
    expect(checkEnv({ ...PROD, AUTH_MODE: "test" }).warnings.join(" ")).toContain("AUTH_MODE");
  });
});

describe("staging and local", () => {
  it("staging allows MYLOANS_MODE=mock (no MyLoans address needed) and TEST_MODE=true", () => {
    const r = checkEnv({ ...PROD, APP_ENV: "staging", MYLOANS_MODE: "mock", TEST_MODE: "true", MYLOANS_BASE_URL: "", MYLOANS_API_KEY: "", EMAIL_TEST_RECIPIENT: "qa@gdfi.ph" });
    expect(r).toEqual({ appEnv: "staging", errors: [], warnings: [] });
  });
  it("staging still refuses localhost and a short CRON_SECRET", () => {
    const r = checkEnv({ ...PROD, APP_ENV: "staging", DATABASE_URL: "postgresql://a:fake-pw-2@localhost/x", CRON_SECRET: "fake-short-Kq8" });
    expect(r.errors.map((e) => e.split(" ")[0])).toEqual(["DATABASE_URL", "CRON_SECRET"]);
    expect(refusalMessage(r)).toContain("(Staging)");
  });
  it("staging with MYLOANS_MODE=live needs the MyLoans address and key", () => {
    const r = checkEnv({ ...PROD, APP_ENV: "staging", MYLOANS_BASE_URL: "", MYLOANS_API_KEY: "" });
    expect(r.errors.map((e) => e.split(" ")[0])).toEqual(["MYLOANS_BASE_URL", "MYLOANS_API_KEY"]);
  });
  it("local: this PC's settings pass; missing optional values are warnings", () => {
    const r = checkEnv({ DATABASE_URL: "postgresql://gdfi:fake-pw-9@localhost:5434/gdfi_dms", DIRECT_URL: "postgresql://gdfi:fake-pw-9@localhost:5434/gdfi_dms", APP_BASE_URL: "http://localhost:3001", SESSION_SECRET: V.session, TEST_MODE: "true", MYLOANS_MODE: "mock" });
    expect(r.appEnv).toBe("local");
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("CRON_SECRET");
    expect(r.warnings.join(" ")).toContain("GRAPH_CLIENT_ID");
  });
  it("APP_ENV defaults to local", () => expect(checkEnv({}).appEnv).toBe("local"));
});

describe("unknown values are rejected, without echoing them", () => {
  it.each([
    ["APP_ENV", "prod-ish"], ["TEST_MODE", "yes"], ["MYLOANS_MODE", "sandbox"], ["EMAIL_AUTO_DRAIN", "maybe"],
    ["AUTH_MODE", "google"], ["STORAGE_DRIVER", "s3bucket"], ["MYLOANS_TIMEOUT_MS", "soon"],
  ])("%s", (name, value) => {
    const r = checkEnv({ ...PROD, [name]: value });
    const e = r.errors.find((x) => x.startsWith(name));
    expect(e, JSON.stringify(r.errors)).toBeTruthy();
    expect(refusalMessage(r)).not.toContain(value);
  });
  it("an unknown APP_ENV is checked as strictly as production", () => {
    expect(checkEnv({ APP_ENV: "prod-ish", TEST_MODE: "true" }).errors).toContain("TEST_MODE must be false in production.");
  });
  it("case does not matter for APP_ENV and MYLOANS_MODE", () => {
    expect(checkEnv({ ...PROD, APP_ENV: "Production", MYLOANS_MODE: "LIVE" }).errors).toEqual([]);
  });
});

describe("server helpers", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvWarnings();
    vi.restoreAllMocks();
  });

  it("MYLOANS_API_BASE_URL still works, with one warning only", () => {
    delete process.env.MYLOANS_BASE_URL;
    process.env.MYLOANS_API_BASE_URL = V.myloansUrl;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(myLoansBaseUrl()).toBe(V.myloansUrl);
    expect(myLoansBaseUrl()).toBe(V.myloansUrl);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe("[env] MYLOANS_API_BASE_URL is the old name: rename it to MYLOANS_BASE_URL in your env files.");
  });
  it("the new name wins when both are set (no warning)", () => {
    process.env.MYLOANS_BASE_URL = "https://new.example.ph";
    process.env.MYLOANS_API_BASE_URL = "https://old.example.ph";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(myLoansBaseUrl()).toBe("https://new.example.ph");
    expect(warn).not.toHaveBeenCalled();
  });
  it("the old name satisfies the production check", () => {
    expect(checkEnv({ ...PROD, MYLOANS_BASE_URL: "", MYLOANS_API_BASE_URL: V.myloansUrl }).errors).toEqual([]);
  });

  it("assertEnvAtStartup throws in production with names only; local only warns", () => {
    process.env = { ...PROD, TEST_MODE: "true" } as unknown as NodeJS.ProcessEnv;
    const log = { warn: vi.fn() };
    expect(() => assertEnvAtStartup(log)).toThrow(/TEST_MODE must be false in production/);
    try { assertEnvAtStartup(log); } catch (e) { expect(secretsIn(String(e))).toEqual([]); }
    process.env = { APP_ENV: "local", TEST_MODE: "true" } as unknown as NodeJS.ProcessEnv;
    expect(() => assertEnvAtStartup(log)).not.toThrow();
    expect(log.warn).toHaveBeenCalled();
  });

  it("appEnv, isProduction and refuseInProduction", () => {
    process.env.APP_ENV = "";
    expect(appEnv()).toBe("local");
    expect(() => refuseInProduction("Reset test data")).not.toThrow();
    process.env.APP_ENV = "staging";
    expect(isProduction()).toBe(false);
    process.env.APP_ENV = "production";
    expect(() => refuseInProduction("Reset test data")).toThrow("Reset test data is not available in production.");
    process.env.APP_ENV = "nonsense";
    expect(isProduction()).toBe(true); // the safe side
  });
});
