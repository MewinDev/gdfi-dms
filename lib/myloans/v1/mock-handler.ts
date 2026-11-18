import "server-only";
import { prisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { failureFor, type MockEndpoint, type MockFailure } from "./failures";
import { api1Of, branchesOf, feedPageOf, pht, productsOf } from "./mock-rows";
import { loadMockData, mockAllowed } from "./mock-store";

/**
 * Piece 6: the myloans mock over HTTP, with the contract's paths under /api/dev/myloans/api/dms/v1:
 *   GET /loans/{pn}                                     API 1
 *   GET /loans/changes?since=&afterId=&limit=           API 2 (change mode)
 *   GET /loans/changes?releasedSince=&afterId=&limit=   Pool mode (first load; URL "proposed")
 *   GET /branches                                       API 4
 *   GET /products                                       API 5
 * It answers only while MYLOANS_MODE=mock outside production (404 otherwise), checks the Bearer key, and applies the
 * failure switches (Settings, Test data). The same function serves the route and the in-process client used in tests.
 */
export const MOCK_BASE_PATH = "/api/dev/myloans/api/dms/v1";
/** The key the mock accepts: MYLOANS_API_KEY when set, else this fixed local value. Never a real key. */
export const mockKey = () => process.env.MYLOANS_API_KEY?.trim() || "local-mock-key";
const MAX_LIMIT = 500;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-mock": "myloans", ...headers } });

/** Pages of the current run per mode (page 1 when afterId is 0), so "page N fails" can hit the right page. */
const pages = new Map<string, number>();

async function applyFailure(endpoint: MockEndpoint, page: number): Promise<{ resp?: Response; malformed?: boolean }> {
  const list = await getSetting("myloans.mockFailures");
  const f = failureFor(list, endpoint, page);
  if (!f) return {};
  if (f.once) await setSetting("myloans.mockFailures", list.filter((x: MockFailure) => x !== f && !(x.endpoint === f.endpoint && x.kind === f.kind && x.page === f.page)));
  switch (f.kind) {
    case "unavailable": case "pageFails": return { resp: json(503, { error: "Service unavailable (simulated)" }) };
    case "busy": return { resp: json(429, { error: "Too many requests (simulated)" }, { "retry-after": "2" }) };
    case "error": return { resp: json(500, { error: "Server error (simulated)" }) };
    case "unauthorized": return { resp: json(401, { error: "Unauthorized (simulated)" }) };
    case "slow": {
      await new Promise((r) => setTimeout(r, Number(process.env.MYLOANS_TIMEOUT_MS ?? 8000) + 500));
      return {};
    }
    case "malformed": return { malformed: true };
  }
}

/** Drops one required field so the answer no longer matches the contract (a simulated drift). */
function breakBody(body: unknown): unknown {
  const b = structuredClone(body) as Record<string, unknown>;
  const first = Array.isArray(b.items) ? (b.items as Record<string, unknown>[])[0] : b;
  if (first && typeof first === "object") delete (first as Record<string, unknown>)[Array.isArray(b.items) && "productCode" in first ? "productCode" : "contentHash"];
  if (Array.isArray(b.items) && !b.items.length) delete b.runStartedAt;
  return b;
}

/** The mock without a network (tests, and mock mode without MYLOANS_MOCK_URL). Honours the abort signal like fetch. */
export const inProcessFetch: typeof fetch = (input, init) => new Promise<Response>((resolve, reject) => {
  const signal = init?.signal;
  const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
  if (signal?.aborted) return abort();
  signal?.addEventListener("abort", abort, { once: true });
  handleMockRequest(new Request(typeof input === "string" || input instanceof URL ? input : input.url, { ...init, signal: undefined })).then(resolve, reject);
});

export async function handleMockRequest(req: Request, now: Date = new Date()): Promise<Response> {
  if (!mockAllowed()) return new Response("Not found", { status: 404 });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  const url = new URL(req.url);
  const path = url.pathname.slice(url.pathname.indexOf(MOCK_BASE_PATH) + MOCK_BASE_PATH.length) || "/";
  const endpoint: MockEndpoint | null =
    path === "/branches" ? "branches" : path === "/products" ? "products"
    : path === "/loans/changes" ? (url.searchParams.has("since") ? "changes" : url.searchParams.has("releasedSince") ? "pool" : null)
    : /^\/loans\/[^/]+$/.test(path) ? "api1" : null;
  if (!endpoint) return json(404, { error: "Not found" });
  if (req.headers.get("authorization") !== `Bearer ${mockKey()}`) return json(401, { error: "Unauthorized" });

  const afterId = Number(url.searchParams.get("afterId") ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit") ?? MAX_LIMIT)));
  if ((endpoint === "changes" || endpoint === "pool") && (!Number.isInteger(afterId) || afterId < 0 || !Number.isInteger(limit))) return json(400, { error: "Bad afterId or limit" });
  const runKey = `${endpoint}|${url.searchParams.get("since") ?? url.searchParams.get("releasedSince")}`;
  const page = endpoint === "changes" || endpoint === "pool" ? (afterId === 0 ? 1 : (pages.get(runKey) ?? 1) + 1) : 1;
  if (endpoint === "changes" || endpoint === "pool") pages.set(runKey, page);

  const fail = await applyFailure(endpoint, page);
  if (fail.resp) return fail.resp;

  const data = await loadMockData(prisma);
  const runStartedAt = pht(now);
  let status = 200;
  let body: unknown;
  if (endpoint === "api1") {
    const a = api1Of(data, decodeURIComponent(path.slice("/loans/".length)), runStartedAt);
    status = a.status;
    body = a.body;
  } else if (endpoint === "changes" || endpoint === "pool") {
    const since = url.searchParams.get(endpoint === "changes" ? "since" : "releasedSince");
    if (!since || Number.isNaN(new Date(since).getTime())) return json(400, { error: `Bad ${endpoint === "changes" ? "since" : "releasedSince"}` });
    body = feedPageOf(data, endpoint === "changes" ? { since, afterId, limit } : { releasedSince: since, afterId, limit }, runStartedAt);
  } else {
    body = endpoint === "branches" ? branchesOf(data) : productsOf(data);
  }
  return json(status, fail.malformed && status === 200 ? breakBody(body) : body);
}
