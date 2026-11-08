import { isProduction } from "@/lib/env";

/**
 * TEST_MODE=true turns on test-only helpers: the sample loan cards, the TEST MODE box in the
 * sidebar, the "Show data-check test PNs" setting, "Reset test data", and emails redirected to the
 * test address with "[TEST]". Never in production: APP_ENV=production refuses to start with it, and
 * reads it as off here too.
 */
export function isTestMode(): boolean {
  return process.env.TEST_MODE === "true" && !isProduction();
}
