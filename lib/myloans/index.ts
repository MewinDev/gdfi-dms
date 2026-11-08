import { getSetting } from "@/lib/settings";
import { HttpMyLoansAdapter } from "./http-adapter";
import { MockMyLoansAdapter } from "./mock-adapter";
import { ResilientAdapter } from "./resilience";
import type { MyLoansAdapter } from "./types";

export type { MyLoansAdapter, MyLoansLookup, MyLoansRecord, MyLoansHit, SourceCapabilities } from "./types";

export const myLoansMode = (): "mock" | "live" => ((process.env.MYLOANS_MODE ?? "mock").toLowerCase() === "live" ? "live" : "mock");

// One per server process, so the circuit breaker remembers recent failures.
let cached: { mode: string; adapter: ResilientAdapter } | null = null;

/** MYLOANS_MODE=mock (default) or live, wrapped with retries, Retry-After and the circuit breaker. */
export function getMyLoansAdapter(): MyLoansAdapter & { breakerState(): { failures: number; open: boolean } } {
  const mode = myLoansMode();
  if (cached?.mode === mode) return cached.adapter;
  const inner: MyLoansAdapter = mode === "live"
    ? new HttpMyLoansAdapter()
    : new MockMyLoansAdapter({
        isUnavailable: () => getSetting("myloans.simulateUnavailable"),
        overrides: () => getSetting("myloans.mockOverrides"),
        extra: () => getSetting("myloans.mockExtra"),
      });
  // The mock answers at once: no waiting between retries.
  cached = { mode, adapter: new ResilientAdapter(inner, mode === "mock" ? { retries: 0, breakAfter: 1_000_000 } : {}) };
  return cached.adapter;
}

export function normalizePn(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** Accepts "PN-0001001" and also bare digits ("0001001" -> "PN-0001001"). */
export function looksLikePn(input: string): string | null {
  const v = normalizePn(input);
  if (/^PN-\d{4,}$/.test(v)) return v;
  if (/^\d{7}$/.test(v)) return `PN-${v}`;
  return null;
}
