import { getSetting } from "@/lib/settings";
import { HttpMyLoansAdapter } from "./http-adapter";
import { MockMyLoansAdapter } from "./mock-adapter";
import { DbBreakerStore, ResilientAdapter } from "./resilience";
import { sampleBranchRows } from "@/lib/branches/kit-file";
import type { MyLoansAdapter } from "./types";

export type { MyLoansAdapter, MyLoansLookup, MyLoansRecord, MyLoansHit, SourceCapabilities } from "./types";

export const myLoansMode = (): "mock" | "live" => ((process.env.MYLOANS_MODE ?? "mock").toLowerCase() === "live" ? "live" : "mock");

// One per server process, so the circuit breaker remembers recent failures.
let cached: { mode: string; adapter: ResilientAdapter } | null = null;

/** MYLOANS_MODE=mock (default) or live, wrapped with retries, Retry-After and the circuit breaker. */
export function getMyLoansAdapter(): MyLoansAdapter & { breakerState(): Promise<{ failures: number; open: boolean }> } {
  const mode = myLoansMode();
  if (cached?.mode === mode) return cached.adapter;
  const inner: MyLoansAdapter = mode === "live"
    ? new HttpMyLoansAdapter()
    : new MockMyLoansAdapter({
        isUnavailable: () => getSetting("myloans.simulateUnavailable"),
        overrides: () => getSetting("myloans.mockOverrides"),
        extra: () => getSetting("myloans.mockExtra"),
        branches: () => sampleBranchRows(),
        branchChanges: () => getSetting("myloans.mockBranches"),
      });
  // The mock answers at once: no waiting between retries.
  // The breaker is shared by every instance (database), like the hourly count (lib/myloans/client.ts).
  cached = { mode, adapter: new ResilientAdapter(inner, { ...(mode === "mock" ? { retries: 0, breakAfter: 1_000_000 } : {}), breaker: new DbBreakerStore() }) };
  return cached.adapter;
}

/** Trim, upper case, remove spaces, dashes and dots (the shared PN cleaning, lib/pn/format.ts). */
export { cleanPn as normalizePn } from "@/lib/pn/format";
