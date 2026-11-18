import { describe, expect, it } from "vitest";
import { api1Of, branchesOf, feedPageOf, pht, productsOf, type MockData, type MockTxnRow } from "./mock-rows";
import { api1ManySchema, api1NotSelectableSchema, branchesSchema, driftMessage, feedPageSchema, feedRowSchema, productsSchema } from "./schema";
import { failureFor, type MockFailure } from "./failures";

/** Piece 6: the mock's answers match the agreed contract, column for column (fake data). */
const T0 = new Date("2026-11-17T00:00:00Z"); // 08:00 PHT
const LATER = new Date("2026-11-17T01:00:00Z");
const NOW = pht(new Date("2026-11-17T01:30:00Z"));
const txn = (id: number, extra: Partial<MockTxnRow> = {}): MockTxnRow => ({
  id, cin: `CIN-FAKE-${id}`, pnNo: `GD99920269${String(id).padStart(5, "0")}`, statusId: 12, isActive: true, code: `TXN-FAKE-${String(id).padStart(11, "0")}`,
  updatedAt: LATER, createdAt: LATER, replacedById: null, duplicate: false, releaseDate: new Date("2026-11-02T02:30:00Z"), amount: "250000.00",
  cifNo: `CIF-${id}`, firstName: "Ana", middleName: null, lastName: "Cruz", suffix: null, loanId: String(id), loanTypeId: "1", loanType: "New", borrowerCompanyName: null, productId: 1, branchId: 165, ...extra,
});
const data = (txns: MockTxnRow[]): MockData => ({
  txns,
  products: [{ productId: 1, productCode: "01-AUTO", name: "Auto Refinancing", active: true }],
  branches: [{ branchId: 165, branchCode: "165", branchName: "Angono", areaId: 1, areaName: "RIZAL", divisionId: 1, divisionName: "NGMA", companyId: 1, companyName: "GDFI", isActive: true, updatedAt: null }],
});

describe("the mock's rows (piece 6)", () => {
  it("every column of the agreed query, valid against the contract; amount a string; dates in +08:00; a 64-hex hash", () => {
    const a = api1Of(data([txn(1)]), "GD999202690000" + "1", NOW);
    expect(a.status).toBe(200);
    const row = feedRowSchema.parse((a as { body: unknown }).body);
    expect(row).toMatchObject({ externalLoanId: 1, feedState: "Released", isSelectable: 1, totalLoanAmount: "250000.00", branchName: "Angono", productName: "Auto Refinancing", runStartedAt: NOW });
    expect(row.releaseDate).toMatch(/\+08:00$/);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("API 1: 404 none, 422 not selectable (with Replaced by), 409 several rows whatever their states", () => {
    expect(api1Of(data([]), "GD999202690009", NOW).status).toBe(404);
    const redo = data([txn(1, { statusId: 14, replacedById: 2 }), txn(2, { cin: "CIN-FAKE-1" })]);
    const r = api1Of(redo, txn(1).pnNo!, NOW);
    expect(r.status).toBe(422);
    expect(api1NotSelectableSchema.parse((r as { body: unknown }).body)).toEqual({ transactionStatusId: 14, feedState: "Cancelled", replacedByPnNo: txn(2).pnNo });
    const two = data([txn(1), txn(2, { pnNo: txn(1).pnNo, statusId: 14 })]);
    const m = api1Of(two, txn(1).pnNo!, NOW);
    expect(m.status).toBe(409);
    expect(api1ManySchema.parse((m as { body: unknown }).body).rows).toHaveLength(2);
  });

  it("API 2: cut by loan after afterId; a full page has nextAfterId, the next one is empty; a duplicate stays on one page", () => {
    const d = data([txn(1), txn(2, { duplicate: true }), txn(3)]);
    const since = pht(T0);
    const p1 = feedPageSchema.parse(feedPageOf(d, { since, afterId: 0, limit: 2 }, NOW));
    expect(p1.items.map((x) => x.externalLoanId)).toEqual([1, 2, 2]);
    expect(p1.items[1].rowsForThisLoan).toBe(2);
    expect(p1.nextAfterId).toBe(2);
    const p2 = feedPageOf(d, { since, afterId: 2, limit: 2 }, NOW);
    expect(p2.items.map((x) => x.externalLoanId)).toEqual([3]);
    expect(p2.nextAfterId).toBeNull();
    const exact = feedPageOf(data([txn(1), txn(2)]), { since, afterId: 0, limit: 2 }, NOW);
    expect(exact.nextAfterId).toBe(2);
    expect(feedPageOf(data([txn(1), txn(2)]), { since, afterId: 2, limit: 2 }, NOW)).toEqual({ runStartedAt: NOW, items: [], nextAfterId: null });
    // Not changed since: not sent.
    expect(feedPageOf(d, { since: pht(new Date("2026-11-18T00:00:00Z")), afterId: 0, limit: 10 }, NOW).items).toHaveLength(0);
  });

  it("pool mode: only Released loans released on or after the cutoff", () => {
    const d = data([txn(1), txn(2, { statusId: 14 }), txn(3, { releaseDate: new Date("2026-10-01T02:00:00Z") })]);
    expect(feedPageOf(d, { releasedSince: "2026-11-01T00:00:00+08:00", afterId: 0, limit: 500 }, NOW).items.map((x) => x.externalLoanId)).toEqual([1]);
  });

  it("a hashed field changes the hash; a timestamp-only change does not", () => {
    const h = (t: MockTxnRow) => (api1Of(data([t]), t.pnNo!, NOW) as { body: { contentHash: string } }).body.contentHash;
    expect(h(txn(1, { amount: "250001.00" }))).not.toBe(h(txn(1)));
    expect(h(txn(1, { updatedAt: new Date("2026-11-17T05:00:00Z") }))).toBe(h(txn(1)));
  });

  it("API 4 and API 5 match their schemas", () => {
    expect(branchesSchema.parse(branchesOf(data([]))).items[0]).toMatchObject({ branchId: 165, branchName: "Angono" });
    expect(productsSchema.parse(productsOf(data([]))).items[0]).toEqual({ productId: 1, productCode: "01-AUTO", name: "Auto Refinancing", active: true });
  });

  it("a drift is one plain line naming the field", () => {
    const bad = feedPageSchema.safeParse({ runStartedAt: NOW, items: [{ externalLoanId: 1 }], nextAfterId: null });
    expect(bad.success).toBe(false);
    expect(driftMessage(bad.error!)).toMatch(/^myloans sent something we did not expect: items\.0\./);
  });
});

describe("failure switches (D-048)", () => {
  it("the most specific switch applies; page N fails only on that page", () => {
    const list: MockFailure[] = [{ endpoint: "all", kind: "slow", once: false }, { endpoint: "api1", kind: "busy", once: true }, { endpoint: "changes", kind: "pageFails", page: 2, once: false }];
    expect(failureFor(list, "api1", 1)?.kind).toBe("busy");
    expect(failureFor(list, "products", 1)?.kind).toBe("slow");
    expect(failureFor([list[2]], "changes", 1)).toBeNull();
    expect(failureFor([list[2]], "changes", 2)?.kind).toBe("pageFails");
  });
});
