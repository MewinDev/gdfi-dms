// @vitest-environment node
/**
 * Piece 6 (D-047, D-048): the contract client against the myloans mock, through the same HTTP handler the route uses
 * (in-process: no server needed). The mock's own tables, the failure switches, retries, Retry-After, the breaker and a
 * run whose page 2 fails. LOCAL test database only.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { MemoryBreakerStore } from "@/lib/myloans/resilience";
import { MyLoansClientV1 } from "@/lib/myloans/v1/client";
import { handleMockRequest, inProcessFetch, MOCK_BASE_PATH, mockKey } from "@/lib/myloans/v1/mock-handler";
import { resetMockData } from "@/lib/myloans/v1/mock-store";
import { addMockScenario } from "@/lib/myloans/v1/mock-scenarios";
import { fetchRun } from "@/lib/myloans/r2/sync-plan";
import { readApi1 } from "@/lib/myloans/r2/contract";
import type { MockFailure } from "@/lib/myloans/v1/failures";
import { addMockFailure, addScenario, clearMockFailures, resetMock } from "@/lib/services/myloans-mock";
import { asUser } from "./helpers";

const client = (o: Partial<ConstructorParameters<typeof MyLoansClientV1>[0]> = {}) =>
  new MyLoansClientV1({ baseUrl: `http://mock.local${MOCK_BASE_PATH}`, apiKey: mockKey(), fetchImpl: inProcessFetch, sleep: async () => {}, breaker: new MemoryBreakerStore(), ceiling: false, timeoutMs: 2000, ...o });
const failures = (list: MockFailure[]) => setSetting("myloans.mockFailures", list);

beforeEach(async () => {
  process.env.MYLOANS_MODE = "mock";
  await failures([]);
  await resetMockData();
});
afterAll(async () => {
  await failures([]);
  await prisma.$disconnect();
});

describe("the mock's own data and API 1 (piece 6)", () => {
  it("filled from the sample loans; a sample PN is 200 with every column; an unknown PN is 404", async () => {
    const t = await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "samples", statusId: 12 }, orderBy: { id: "asc" } });
    const a = await client().api1(t.pnNo!);
    expect(a.ok && a.data.status).toBe(200);
    if (a.ok && a.data.status === 200) expect(a.data.row).toMatchObject({ pnNo: t.pnNo, feedState: "Released", isSelectable: 1 });
    const none = await client().api1("GD999202690999");
    expect(none).toEqual({ ok: true, data: { status: 404 } });
  });

  it("scenarios: cancel-then-redo is 422 with Replaced by; two records are 409 (the DMS reads them in plain words)", async () => {
    await addMockScenario("cancelRedo");
    const old = await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "scenario", statusId: 14 } });
    const a = await client().api1(old.pnNo!);
    expect(a.ok && a.data.status).toBe(422);
    if (a.ok && a.data.status === 422) {
      expect(a.data.feedState).toBe("Cancelled");
      expect(readApi1({ status: 422, body: { transactionStatusId: a.data.transactionStatusId, feedState: a.data.feedState, replacedByPnNo: a.data.replacedByPnNo } })).toMatchObject({ kind: "not-selectable", message: expect.stringContaining("Replaced by") });
    }
    await addMockScenario("api1Conflict");
    const pn = (await prisma.mockMyLoansTxn.findFirstOrThrow({ where: { source: "scenario", pnNo: { startsWith: "GD99920269990" } } })).pnNo!;
    const m = await client().api1(pn);
    expect(m.ok && m.data.status).toBe(409);
  });

  it("a wrong key is refused (401) in plain words, without the key", async () => {
    const r = await client({ apiKey: "wrong" }).api1("GD999202690999");
    expect(r).toEqual({ ok: false, kind: "unauthorized", message: expect.stringContaining("refused the DMS key") });
    expect(JSON.stringify(r)).not.toContain("wrong");
  });
});

describe("API 2 paging and the pool mode (piece 6)", () => {
  it("exactly 500 changed loans: a full page with nextAfterId, then an empty page; runStartedAt is the same on every row", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    await addMockScenario("exactly500");
    const c = client();
    const p1 = await c.changesPage({ since, afterId: 0, limit: 500 });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(new Set(p1.data.items.map((x) => x.externalLoanId)).size).toBe(500);
    expect(p1.data.nextAfterId).not.toBeNull();
    expect(new Set(p1.data.items.map((x) => x.runStartedAt))).toEqual(new Set([p1.data.runStartedAt]));
    const p2 = await c.changesPage({ since, afterId: p1.data.nextAfterId!, limit: 500 });
    expect(p2.ok && p2.data).toMatchObject({ items: [], nextAfterId: null });
  });

  it("pool mode: 501 released loans come in two pages", async () => {
    await addMockScenario("pool501");
    const c = client();
    const cutoff = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const run = await fetchRun(async (afterId) => {
      const p = await c.poolPage({ releasedSince: cutoff, afterId, limit: 500 });
      if (!p.ok) throw new Error(p.message);
      return p.data as never;
    });
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.pages).toBe(2);
  });
});

describe("failure simulation (D-048)", () => {
  it("unavailable: retried, then plain words; the breaker opens after repeated failures", async () => {
    await failures([{ endpoint: "api1", kind: "unavailable", once: false }]);
    const breaker = new MemoryBreakerStore();
    const c = client({ breaker, breakAfter: 2, retries: 1 });
    expect(await c.api1("GD999202690001")).toMatchObject({ ok: false, kind: "unavailable", message: "MyLoans did not answer. Try again in a moment." });
    await c.api1("GD999202690001");
    expect((await breaker.read()).openUntil).toBeGreaterThan(Date.now());
    await failures([]);
    expect(await c.api1("GD999202690001")).toMatchObject({ ok: false, kind: "unavailable", limited: true });
  });

  it("busy: Retry-After is honoured once, then the call succeeds (the switch was for the next call only)", async () => {
    await failures([{ endpoint: "api1", kind: "busy", once: true }]);
    const waits: number[] = [];
    const r = await client({ sleep: async (ms) => { waits.push(ms); } }).api1("GD999202690999");
    expect(r).toEqual({ ok: true, data: { status: 404 } });
    expect(waits).toEqual([2000]);
    expect(await prisma.setting.findUnique({ where: { key: "myloans.mockFailures" } }).then((s) => s?.value)).toEqual([]);
  });

  it("server error and wrong key switches; a malformed answer is a drift naming the field", async () => {
    await failures([{ endpoint: "products", kind: "error", once: false }]);
    expect(await client({ retries: 0 }).products()).toMatchObject({ ok: false, kind: "unavailable", status: 500 });
    await failures([{ endpoint: "branches", kind: "unauthorized", once: false }]);
    expect(await client().branches()).toMatchObject({ ok: false, kind: "unauthorized" });
    await failures([{ endpoint: "products", kind: "malformed", once: false }]);
    const p = await client().products();
    expect(p).toMatchObject({ ok: false, kind: "drift", message: expect.stringMatching(/^myloans sent something we did not expect: items\.0\.productCode/) });
  });

  it("slow: longer than the timeout counts as no answer", async () => {
    const was = process.env.MYLOANS_TIMEOUT_MS;
    process.env.MYLOANS_TIMEOUT_MS = "100";
    try {
      await failures([{ endpoint: "products", kind: "slow", once: false }]);
      expect(await client({ timeoutMs: 100, retries: 0 }).products()).toMatchObject({ ok: false, kind: "unavailable" });
    } finally {
      process.env.MYLOANS_TIMEOUT_MS = was;
    }
  });

  it("page 2 of a run fails: the run fails as a whole and gives no checkpoint", async () => {
    await addMockScenario("pool501");
    await failures([{ endpoint: "pool", kind: "pageFails", page: 2, once: false }]);
    const c = client({ retries: 0 });
    const cutoff = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const run = await fetchRun(async (afterId) => {
      const p = await c.poolPage({ releasedSince: cutoff, afterId, limit: 500 });
      if (!p.ok) throw new Error(p.message);
      return p.data as never;
    });
    expect(run).toMatchObject({ ok: false, checkpoint: null });
  });

  it("the mock answers 404 in production (it does not exist there)", async () => {
    const was = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const res = await handleMockRequest(new Request(`http://x${MOCK_BASE_PATH}/products`, { headers: { authorization: `Bearer ${mockKey()}` } }));
      expect(res.status).toBe(404);
    } finally {
      process.env.APP_ENV = was;
    }
  });
});

describe("Settings, System, myloans mock panel (D-048)", () => {
  it("needs Change system switches; validated; audited; refused in production", async () => {
    const admin = await asUser("test.admin@gdfi.ph");
    const la = await asUser("test.la@gdfi.ph");
    await expect(addMockFailure(la, { endpoint: "all", kind: "unavailable", once: true })).rejects.toThrow(/does not allow changing these switches/);
    await expect(addMockFailure(admin, { endpoint: "products", kind: "pageFails", once: false, page: "2" })).rejects.toThrow(/Only API 2 and the pool mode have pages/);
    await expect(addMockFailure(admin, { endpoint: "nope", kind: "unavailable", once: false })).rejects.toThrow(/Pick which call fails/);
    await expect(addMockFailure(admin, { endpoint: "changes", kind: "pageFails", once: false, page: "2" })).resolves.toMatch(/API 2 \(changes\): Page N of a run fails \(503\) \(page 2\)/);
    expect(await prisma.auditLog.count({ where: { action: "myloans_mock_failure_on" } })).toBeGreaterThan(0);
    await expect(clearMockFailures(admin)).resolves.toMatch(/off/);
    await expect(addScenario(admin, "notReleased")).resolves.toMatch(/now NotReleased/);
    await expect(resetMock(admin)).resolves.toMatch(/sample loans again/);
    expect(await prisma.mockMyLoansTxn.count({ where: { source: "scenario" } })).toBe(0);
    const was = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      await expect(addMockFailure(admin, { endpoint: "all", kind: "unavailable", once: true })).rejects.toThrow(/not available in production/);
    } finally {
      process.env.APP_ENV = was;
    }
  });
});

