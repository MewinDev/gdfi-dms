import { describe, expect, it } from "vitest";
import { devTimerWanted } from "./dev-timer";

const SECRET = "a-long-enough-cron-secret";
describe("the development sync timer (D-052)", () => {
  it("is on only with the flag, APP_ENV=local and a CRON_SECRET", () => {
    expect(devTimerWanted({ MYLOANS_SYNC_DEV_TIMER: "true", APP_ENV: "local", CRON_SECRET: SECRET })).toBe(true);
    expect(devTimerWanted({ APP_ENV: "local", CRON_SECRET: SECRET })).toBe(false);
    expect(devTimerWanted({ MYLOANS_SYNC_DEV_TIMER: "true", APP_ENV: "staging", CRON_SECRET: SECRET })).toBe(false);
    expect(devTimerWanted({ MYLOANS_SYNC_DEV_TIMER: "true", APP_ENV: "production", CRON_SECRET: SECRET })).toBe(false);
    expect(devTimerWanted({ MYLOANS_SYNC_DEV_TIMER: "true", APP_ENV: "local" })).toBe(false);
  });
});
