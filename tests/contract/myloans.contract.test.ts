// @vitest-environment node
/**
 * myloans contract tests (piece 6, D-047, D-048). The same checks run against:
 *   - the mock, in-process (the default; part of npm test);
 *   - a running app's mock over HTTP:  npm run test:contract -- --target=local
 *   - myloans staging, BY HAND, read-only GETs with small limits:  npm run test:contract -- --target=staging
 *     with MYLOANS_CONTRACT_URL and MYLOANS_CONTRACT_KEY in the shell (never in the repo), and optional known PNs:
 *     MYLOANS_CONTRACT_PN_OK, MYLOANS_CONTRACT_PN_CANCELLED, MYLOANS_CONTRACT_PN_REDONE, MYLOANS_CONTRACT_PN_MULTI.
 * A check that needs a case only the mock can make is skipped on staging unless its PN is given.
 * This file becomes the "Real API verification" item once staging access (C5) arrives. Never in CI until then.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryBreakerStore } from "@/lib/myloans/resilience";
import { MyLoansClientV1 } from "@/lib/myloans/v1/client";
import type { FeedPageV1 } from "@/lib/myloans/v1/schema";

const target = (process.env.MYLOANS_CONTRACT_TARGET ?? "mock") as "mock" | "local" | "staging";
const onMock = target === "mock";
const env = (k: string) => process.env[k]?.trim() || undefined;
const PN = { ok: env("MYLOANS_CONTRACT_PN_OK"), cancelled: env("MYLOANS_CONTRACT_PN_CANCELLED"), redone: env("MYLOANS_CONTRACT_PN_REDONE"), multi: env("MYLOANS_CONTRACT_PN_MULTI") };
const LIMIT = Number(env("MYLOANS_CONTRACT_LIMIT") ?? (onMock ? 500 : 50));
const SINCE = env("MYLOANS_CONTRACT_SINCE") ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

let client: MyLoansClientV1;
let wrongKey: MyLoansClientV1;

beforeAll(async () => {
  const base = { sleep: async () => {}, breaker: new MemoryBreakerStore(), ceiling: false as const, retries: 1, timeoutMs: 15_000 };
  if (target === "staging") {
    const url = env("MYLOANS_CONTRACT_URL"), key = env("MYLOANS_CONTRACT_KEY");
    if (!url || !key) throw new Error("Set MYLOANS_CONTRACT_URL and MYLOANS_CONTRACT_KEY in the shell (never in a file in the repo).");
    client = new MyLoansClientV1({ ...base, baseUrl: url, apiKey: key });
    wrongKey = new MyLoansClientV1({ ...base, baseUrl: url, apiKey: "not-the-key" });
    return;
  }
  const { mockKey, MOCK_BASE_PATH, inProcessFetch } = await import("@/lib/myloans/v1/mock-handler");
  process.env.MYLOANS_MODE = "mock";
  const url = target === "local" ? env("MYLOANS_MOCK_URL") ?? `http://localhost:3000${MOCK_BASE_PATH}` : `http://mock.local${MOCK_BASE_PATH}`;
  const f = target === "local" ? fetch : inProcessFetch;
  client = new MyLoansClientV1({ ...base, baseUrl: url, apiKey: mockKey(), fetchImpl: f });
  wrongKey = new MyLoansClientV1({ ...base, baseUrl: url, apiKey: "not-the-key", fetchImpl: f });
  if (onMock) {
    // The mock makes the cases staging can only point at: a sample loan, a cancel-then-redo, two records for one PN.
    const { prisma } = await import("@/lib/db");
    const { setSetting } = await import("@/lib/settings");
    const { resetMockData } = await import("@/lib/myloans/v1/mock-store");
    const { addMockScenario } = await import("@/lib/myloans/v1/mock-scenarios");
    await setSetting("myloans.mockFailures", []);
    await resetMockData();
    await addMockScenario("cancelRedo");
    await addMockScenario("api1Conflict");
    await addMockScenario("duplicate");
    PN.ok = (await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "samples", statusId: 12, replacedById: null }, orderBy: { id: "asc" } })).pnNo!;
    PN.cancelled = (await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "scenario", statusId: 14, replacedById: { not: null } } })).pnNo!;
    PN.multi = (await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "scenario", pnNo: { startsWith: "GD99920269990" } } })).pnNo!;
  }
});

const must = <T,>(r: { ok: true; data: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.data;
};

/** The paging rules every API 2 / pool page must keep (D-036 item 2, D-040). */
function checkPage(p: FeedPageV1, afterId: number, limit: number) {
  const ids = p.items.map((r) => r.externalLoanId);
  expect(ids.every((id) => id > afterId), "every loan is after afterId").toBe(true);
  expect([...ids].sort((a, b) => a - b), "ordered by ExternalLoanId").toEqual(ids);
  expect(new Set(p.items.map((r) => r.runStartedAt)).size <= 1, "one RunStartedAt on the page").toBe(true);
  const loans = [...new Set(ids)];
  for (const id of loans) {
    const rows = p.items.filter((r) => r.externalLoanId === id);
    expect(rows.every((r) => r.rowsForThisLoan === rows.length), `loan ${id}: RowsForThisLoan matches its rows on the page (cut by loan)`).toBe(true);
  }
  expect(loans.length <= limit, "at most limit loans").toBe(true);
  if (loans.length < limit) expect(p.nextAfterId, "a short page is the last").toBeNull();
  else expect(p.nextAfterId, "a full page gives the last loan's id").toBe(loans.at(-1));
}

describe(`myloans contract (${target})`, () => {
  it("API 5 products: the full list, every field as agreed", async () => {
    const p = must(await client.products());
    expect(new Set(p.items.map((x) => x.productId)).size).toBe(p.items.length);
  });

  it("API 4 branches: every field as agreed", async () => {
    const b = must(await client.branches());
    expect(new Set(b.items.map((x) => x.branchId)).size).toBe(b.items.length);
  });

  it("API 2 change mode: since fixed for the run, pages cut by loan, nextAfterId, one RunStartedAt per page (up to 3 pages)", async () => {
    let afterId = 0;
    for (let page = 0; page < 3; page++) {
      const p = must(await client.changesPage({ since: SINCE, afterId, limit: LIMIT }));
      checkPage(p, afterId, LIMIT);
      if (p.nextAfterId === null) return;
      afterId = p.nextAfterId;
    }
  });

  it("pool mode: only selectable (Released) loans released on or after the cutoff", async () => {
    const p = must(await client.poolPage({ releasedSince: SINCE, afterId: 0, limit: LIMIT }));
    checkPage(p, 0, LIMIT);
    expect(p.items.every((r) => r.feedState === "Released" && r.isSelectable === 1)).toBe(true);
    expect(p.items.every((r) => r.releaseDate !== null && new Date(r.releaseDate).getTime() >= new Date(SINCE).getTime())).toBe(true);
  });

  it("API 1: a PN that does not exist is 404", async () => {
    expect(must(await client.api1(env("MYLOANS_CONTRACT_PN_MISSING") ?? "GD000000000000"))).toEqual({ status: 404 });
  });

  it.skipIf(!onMock && !PN.ok)("API 1: a released loan is 200 with one selectable row", async () => {
    const a = must(await client.api1(PN.ok!));
    expect(a.status).toBe(200);
    if (a.status === 200) expect(a.row).toMatchObject({ pnNo: PN.ok, isSelectable: 1, feedState: "Released" });
  });

  it.skipIf(!onMock && !PN.cancelled)("API 1: a cancelled loan is 422 with its FeedState (and Replaced by, after a redo)", async () => {
    const a = must(await client.api1(PN.cancelled!));
    expect(a.status).toBe(422);
    if (a.status === 422) expect(a.feedState).toBe("Cancelled");
  });

  it.skipIf(!onMock && !PN.redone)("API 1: a redone copy is 422 naming the PN that replaced it", async () => {
    const pn = PN.redone ?? PN.cancelled!;
    const a = must(await client.api1(pn));
    expect(a.status).toBe(422);
    if (a.status === 422) expect(a.replacedByPnNo).toMatch(/\S/);
  });

  it.skipIf(!onMock && !PN.multi)("API 1: several records for one PN are 409 with every row", async () => {
    const a = must(await client.api1(PN.multi!));
    expect(a.status).toBe(409);
    if (a.status === 409) expect(a.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("a wrong key is refused (401), in plain words", async () => {
    expect(await wrongKey.products()).toMatchObject({ ok: false, kind: "unauthorized" });
  });
});
