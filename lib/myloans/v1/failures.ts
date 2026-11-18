/**
 * Piece 6 (D-048): failure simulation for the myloans mock. Each switch makes one endpoint (or all of them) fail in a
 * chosen way, for the next call only or until it is switched off. Refused and hidden in production.
 */
export const MOCK_ENDPOINTS = ["api1", "changes", "pool", "branches", "products"] as const;
export type MockEndpoint = (typeof MOCK_ENDPOINTS)[number];
export const MOCK_FAILURES = ["unavailable", "slow", "busy", "error", "unauthorized", "malformed", "pageFails"] as const;
export type MockFailureKind = (typeof MOCK_FAILURES)[number];

export interface MockFailure {
  endpoint: MockEndpoint | "all";
  kind: MockFailureKind;
  /** true: only the next matching call fails, then the switch turns itself off. */
  once: boolean;
  /** pageFails: the page (1, 2, ...) of a run that fails; earlier pages answer normally. */
  page?: number;
  setBy?: string;
  setAt?: string;
}

export const ENDPOINT_WORDS: Record<MockEndpoint | "all", string> = {
  all: "Every call", api1: "API 1 (PN #)", changes: "API 2 (changes)", pool: "Pool (first load)", branches: "API 4 (branches)", products: "API 5 (products)",
};
export const FAILURE_WORDS: Record<MockFailureKind, string> = {
  unavailable: "Unavailable (503)",
  slow: "Slow (longer than the timeout)",
  busy: "Busy (429 with Retry-After)",
  error: "Server error (500)",
  unauthorized: "Wrong key (401)",
  malformed: "Malformed answer (a field missing)",
  pageFails: "Page N of a run fails (503)",
};

/** The switch that applies to this call, if any (the most specific first). */
export function failureFor(list: readonly MockFailure[], endpoint: MockEndpoint, page: number): MockFailure | null {
  const fits = (f: MockFailure) => (f.endpoint === endpoint || f.endpoint === "all") && (f.kind !== "pageFails" || (f.page ?? 1) === page);
  return list.find((f) => f.endpoint === endpoint && fits(f)) ?? list.find(fits) ?? null;
}
