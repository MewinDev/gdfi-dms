import { afterEach, describe, expect, it } from "vitest";
import { isTestMode } from "./test-mode";

const saved = { APP_ENV: process.env.APP_ENV, TEST_MODE: process.env.TEST_MODE };
afterEach(() => { process.env.APP_ENV = saved.APP_ENV; process.env.TEST_MODE = saved.TEST_MODE; });

describe("D-058: the TEST MODE line in the sidebar never shows in production", () => {
  it.each([
    ["local", "true", true], ["staging", "true", true], ["local", "false", false],
    ["production", "true", false], ["prod-ish", "true", false],
  ])("APP_ENV=%s TEST_MODE=%s -> %s", (env, tm, want) => {
    process.env.APP_ENV = env;
    process.env.TEST_MODE = tm;
    expect(isTestMode()).toBe(want);
  });
});
