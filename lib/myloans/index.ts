import { getSetting } from "@/lib/settings";
import { HttpMyLoansAdapter } from "./http-adapter";
import { MockMyLoansAdapter } from "./mock-adapter";
import { DbBreakerStore, ResilientAdapter } from "./resilience";
import { sampleBranchRows } from "@/lib/branches/kit-file";
import type { MyLoansAdapter } from "./types";

export type { MyLoansAdapter, MyLoansLookup, MyLoansRecord, MyLoansHit, SourceCapabilities } from "./types";

import { myLoansMode } from "./mode";
import { ContractMyLoansAdapter } from "./v1/adapter";
import { myLoansClientV1 } from "./v1";
import { MemoryBreakerStore } from "./resilience";
export { myLoansMode };

// One per server process, so the circuit breaker remembers recent failures.
let cached: { mode: string; adapter: ResilientAdapter } | null = null;

/** MYLOANS_MODE=mock (default) or live, wrapped with retries, Retry-After and the circuit breaker. */
export function getMyLoansAdapter(): MyLoansAdapter & { breakerState(): Promise<{ failures: number; open: boolean }> } {
  const mode = myLoansMode();
  if (cached?.mode === mode) return cached.adapter;
  // Piece 10a (D-050): API 1 through the contract client, in both modes. The client makes one try per call (no
  // retries, no breaker, no count of its own): ResilientAdapter and lookupPn below do that, as before.
  const branchSource: MyLoansAdapter = mode === "live"
    ? new HttpMyLoansAdapter()
    : new MockMyLoansAdapter({
        isUnavailable: () => getSetting("myloans.simulateUnavailable"),
        overrides: () => getSetting("myloans.mockOverrides"),
        extra: () => getSetting("myloans.mockExtra"),
        branches: () => sampleBranchRows(),
        branchChanges: () => getSetting("myloans.mockBranches"),
      });
  const inner: MyLoansAdapter = new ContractMyLoansAdapter({
    name: mode,
    client: () => myLoansClientV1({ retries: 0, ceiling: false, breaker: new MemoryBreakerStore(), breakAfter: Number.MAX_SAFE_INTEGER }),
    isUnavailable: mode === "mock" ? () => getSetting("myloans.simulateUnavailable") : undefined,
    branchSource,
    onMultiple: async (pn, rows) => (await import("@/lib/services/myloans-alerts")).alertMultiple(pn, rows.length),
  });
  // The mock answers at once: no waiting between retries.
  // The breaker is shared by every instance (database), like the hourly count (lib/myloans/client.ts).
  cached = { mode, adapter: new ResilientAdapter(inner, { ...(mode === "mock" ? { retries: 0, breakAfter: 1_000_000 } : {}), breaker: new DbBreakerStore() }) };
  return cached.adapter;
}
