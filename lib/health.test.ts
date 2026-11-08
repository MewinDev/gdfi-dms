import { afterEach, describe, expect, it } from "vitest";
import { health } from "./health";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

/** Nothing in the answer may be a variable name or a variable's value. */
function noEnvInside(body: unknown) {
  const text = JSON.stringify(body);
  for (const [name, value] of Object.entries(process.env)) {
    if (/^[A-Z][A-Z0-9_]{3,}$/.test(name)) expect(text, "a variable name").not.toContain(name);
    if (value && value.length >= 8 && !["production", "staging"].includes(value)) expect(text.includes(value), `the value of ${name}`).toBe(false);
  }
}

describe("health", () => {
  it("database up: ok, the environment, the version; no variable names or values", async () => {
    process.env.APP_ENV = "staging";
    process.env.CRON_SECRET = ["Hq7Lp2", "Xw9Rt4", "Mz6Kd3", "Vb8Nc1"].join("");
    const h = await health(async () => 1);
    expect(h).toMatchObject({ ok: true, environment: "staging", database: "up" });
    expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(h).sort()).toEqual(["build", "database", "environment", "ok", "version"]);
    noEnvInside(h);
  });

  it("database down (error): ok false, no error text", async () => {
    const h = await health(async () => { throw new Error(`connect failed ${process.env.DATABASE_URL}`); });
    expect(h).toMatchObject({ ok: false, database: "down" });
    noEnvInside(h);
  });

  it("database not answering in time: down", async () => {
    const h = await health(() => new Promise(() => {}), 50);
    expect(h).toMatchObject({ ok: false, database: "down" });
  });
});
