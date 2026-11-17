import "server-only";
import { myLoansMode } from "@/lib/myloans";
import { myLoansBaseUrl } from "@/lib/env";
import { DbBreakerStore } from "@/lib/myloans/resilience";
import { MyLoansClientV1, type ClientOptions } from "./client";
import { inProcessFetch, mockKey, MOCK_BASE_PATH } from "./mock-handler";

/**
 * The one way to reach myloans (piece 6). MYLOANS_MODE=mock: the app's own mock, in-process (no network) unless
 * MYLOANS_MOCK_URL points at a running app (then over HTTP, e.g. http://localhost:3000/api/dev/myloans/api/dms/v1).
 * Mock mode never calls a real address, whatever MYLOANS_BASE_URL says. MYLOANS_MODE=live: MYLOANS_BASE_URL with
 * MYLOANS_API_KEY. The code path after the fetch is the same in both modes.
 */

export function myLoansClientV1(extra: Partial<ClientOptions> = {}): MyLoansClientV1 {
  if (myLoansMode() === "mock") {
    const url = process.env.MYLOANS_MOCK_URL?.trim();
    return new MyLoansClientV1({ baseUrl: url || `http://mock.local${MOCK_BASE_PATH}`, apiKey: mockKey(), fetchImpl: url ? fetch : inProcessFetch, timeoutMs: Number(process.env.MYLOANS_TIMEOUT_MS ?? 8000), ...extra });
  }
  return new MyLoansClientV1({
    baseUrl: myLoansBaseUrl() ?? "", apiKey: process.env.MYLOANS_API_KEY?.trim() ?? "", timeoutMs: Number(process.env.MYLOANS_TIMEOUT_MS ?? 8000), breaker: new DbBreakerStore(), ...extra,
  });
}

export { MyLoansClientV1 };
