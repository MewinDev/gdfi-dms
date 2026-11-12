import { buildPn } from "@/lib/pn/format";
import { describe, expect, it, vi } from "vitest";
import { changeText, detectChanges, hashTracked, proposeEffect, trackedOf, type Tracked, type TxnNow } from "./changes";
import { MockMyLoansAdapter } from "./mock-adapter";
import { HttpMyLoansAdapter } from "./http-adapter";
import { ResilientAdapter } from "./resilience";
import { checkContract } from "./contract";
import type { MyLoansAdapter, MyLoansLookup, MyLoansRecord } from "./types";

const rec = (over: Partial<MyLoansRecord> = {}): MyLoansRecord => ({
  pn: "GD1012026901001", cin: "CIN-1", cif: "CIF-1", sourceLoanId: "ML-1", borrowerName: "Maria Santos", branchName: "Antipolo", branchCode: "101",
  status: "RELEASED", loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 450_000, releaseDate: "2026-11-02", address: "1 Rizal Ave", ...over,
});
const t = (over: Partial<MyLoansRecord> = {}): Tracked => trackedOf(rec(over));

describe("detectChanges", () => {
  it("no change; the hash is stable", () => {
    expect(detectChanges(t(), t())).toEqual({ category: "NONE", changes: [] });
    expect(hashTracked(t())).toBe(hashTracked(t()));
    expect(hashTracked(t({ totalReleasedAmount: "450000.00" }))).toBe(hashTracked(t())); // same amount, other spelling
    expect(detectChanges(null, t()).category).toBe("NONE"); // first copy
  });
  it("borrower details: name spelling and address (a review of their own, not minor)", () => {
    const d = detectChanges(t(), t({ borrowerName: "Maria  Santos-Cruz", address: "2 Rizal Ave" }));
    expect(d.category).toBe("BORROWER");
    expect(d.changes.map((c) => c.label)).toEqual(["Name", "Address"]);
    expect(detectChanges(t(), t({ areaName: "Somewhere" } as never)).category).toBe("MINOR");
  });
  it("material: amount (in centavos), product, loan type; several at once keep the minor ones too", () => {
    const d = detectChanges(t(), t({ totalReleasedAmount: 520_000, productName: "Auto Financing", loanType: "Renewal", address: "3 Mabini St" }));
    expect(d.category).toBe("MATERIAL");
    expect(d.changes.find((c) => c.field === "amount")).toMatchObject({ was: 45_000_000, now: 52_000_000, kind: "material" });
    expect(d.changes.map((c) => c.kind).sort()).toEqual(["borrower", "material", "material", "material"]);
  });
  it("status wins over material; replacement wins over status", () => {
    expect(detectChanges(t(), t({ status: "CANCELLED", totalReleasedAmount: 1 })).category).toBe("STATUS");
    expect(detectChanges(t(), t({ status: "REPLACED", previousPn: "GD1012026900999" })).category).toBe("REPLACEMENT");
  });
});

const txns = (sent: string[] = []): TxnNow[] => ["NOTARY", "EDST", "PPSR", "MORTGAGE"].map((code, i) => ({
  id: `t${i}`, code, name: { NOTARY: "Notary", EDST: "EDST", PPSR: "Entry of PPSR", MORTGAGE: "Mortgage" }[code]!, status: sent.includes(code) ? "ASSIGNED" : "FOR_CHECKLIST",
  stateLine: `${code}: ${sent.includes(code) ? "sent to Grace Tan, waiting to accept" : "checking papers"}`,
}));
const refiMortgage = { classification: "REFINANCING", financingType: null, orcrStatus: null, mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET" };

describe("proposeEffect", () => {
  it("Mortgage no longer needed: Mortgage and Entry of PPSR would be removed; sent ones are locked", () => {
    const p = proposeEffect({ category: "MATERIAL", loan: refiMortgage, txns: txns(["PPSR"]), next: t({ totalReleasedAmount: 520_000 }) });
    expect(p.removed).toEqual(["PPSR", "MORTGAGE"]);
    expect(p.sentences.join(" ")).toBe("Mortgage is not needed: this is a New loan above ₱500,000. Entry of PPSR and Mortgage would be removed. Notary and EDST stay.");
    expect(p.affected).toEqual([
      { code: "PPSR", name: "Entry of PPSR", stateLine: "PPSR: sent to Grace Tan, waiting to accept", locked: true },
      { code: "MORTGAGE", name: "Mortgage", stateLine: "MORTGAGE: checking papers", locked: false },
    ]);
  });
  it("Mortgage needed again (the other way); a loan type change crosses the threshold too", () => {
    const loan = { ...refiMortgage, mortgageResult: "NOT_MORTGAGE" };
    const two = txns().slice(0, 2);
    const up = proposeEffect({ category: "MATERIAL", loan, txns: two, next: t({ totalReleasedAmount: 480_000 }) });
    expect(up.added).toEqual(["PPSR", "MORTGAGE"]);
    expect(up.sentences[0]).toBe("Mortgage is needed: this is a New loan of ₱500,000 or below.");
    // New 600,000 is above the New limit; as Renewal it is at or below 1,000,000.
    const renewal = proposeEffect({ category: "MATERIAL", loan, txns: two, next: t({ totalReleasedAmount: 600_000, loanType: "Renewal" }) });
    expect(renewal.added).toEqual(["PPSR", "MORTGAGE"]);
    expect(proposeEffect({ category: "MATERIAL", loan, txns: two, next: t({ totalReleasedAmount: 610_000 }) }).sentences).toEqual(["Nothing changes in the transactions."]);
  });
  it("product name: Refinancing to Financing needs the picks; with them the rules run", () => {
    const loan = { ...refiMortgage, mortgageResult: "NOT_MORTGAGE" };
    const p = proposeEffect({ category: "MATERIAL", loan, txns: txns().slice(0, 2), next: t({ productName: "Auto Financing" }) });
    expect(p).toMatchObject({ needsPicks: true, ruleNext: null });
    const q = proposeEffect({ category: "MATERIAL", loan, txns: txns().slice(0, 2), next: t({ productName: "Auto Financing" }), picks: { financingType: "UNDERTAKING", orcrStatus: "UNTRANSFERRED" } });
    expect(q.classificationNext).toBe("FINANCING");
    expect(q.sentences[0]).toBe("The product name now means Financing (was Refinancing).");
    const back = proposeEffect({ category: "MATERIAL", loan: { ...loan, classification: "FINANCING", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }, txns: txns().slice(0, 2), next: t({ productName: "Auto Refinancing" }) });
    expect(back.classificationNext).toBe("REFINANCING");
  });
  it("status: every open transaction is affected", () => {
    const p = proposeEffect({ category: "STATUS", loan: refiMortgage, txns: txns(["NOTARY"]), next: t({ status: "CANCELLED" }) });
    expect(p.sentences[0]).toBe("MyLoans now says the loan is cancelled.");
    expect(p.affected.map((a) => [a.code, a.locked])).toEqual([["NOTARY", true], ["EDST", false], ["PPSR", false], ["MORTGAGE", false]]);
  });
  it("amounts are hidden from people without journey:view_amounts", () => {
    const c = { field: "amount" as const, was: 45_000_000, now: 52_000_000 };
    expect(changeText(c, true)).toEqual({ was: "₱450,000", now: "₱520,000" });
    expect(changeText(c, false)).toEqual({ was: "", now: "" });
  });
});

describe("Adapters: contract, scale, resilience", () => {
  it("the mock keeps the contract (with and without search and changed-since)", async () => {
    expect(await checkContract(new MockMyLoansAdapter(), "GD1012026901001", "GD1012026999999")).toEqual([]);
    expect(await checkContract(new MockMyLoansAdapter({ capabilities: { search: false, changedSince: false } }), "GD1012026901001", "GD1012026999999")).toEqual([]);
  });
  it("25,000 loans: lookups by the PN index; search stops at the limit", async () => {
    const many = Array.from({ length: 25_000 }, (_, i) => rec({ pn: buildPn("101", 2026, i), borrowerName: `Borrower ${i}` }));
    const a = new MockMyLoansAdapter({ records: many });
    const r = await a.getByPn("GD1012026924999");
    expect(r.ok && r.record.borrowerName).toBe("Borrower 24999");
    const s = await a.search("Borrower", 10);
    expect(s.ok && s.hits.length).toBe(10);
    expect(a.lastSearch.returned).toBe(10);
  });
  it("the live adapter (fake MyLoans) keeps the contract shape, maps 404 and 429, never leaks the address or key", async () => {
    const calls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/loans/GD1012026901001")) return new Response(JSON.stringify({ pnNumber: "GD1012026901001", borrowerName: "Maria", status: "RELEASED", loanType: "New", productName: "Auto", totalReleasedAmount: 1, releaseDate: "2026-11-02T00:00:00Z", branchName: "101" }), { status: 200 });
      if (u.endsWith("/loans/GD1012026907777")) return new Response("{}", { status: 429, headers: { "retry-after": "3" } });
      if (u.endsWith("/loans/GD1012026908888")) throw new TypeError(`fetch failed https://secret.myloans.example key=SEKRET`);
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const live = new HttpMyLoansAdapter("https://secret.myloans.example/api", "SEKRET", 8000, fake);
    expect(await checkContract(live, "GD1012026901001", "GD1012026999999")).toEqual([]);
    const limited = await live.getByPn("GD1012026907777");
    expect(limited).toMatchObject({ ok: false, reason: "UNAVAILABLE", retryAfterMs: 3000 });
    const down = await live.getByPn("GD1012026908888");
    expect(JSON.stringify([limited, down])).not.toMatch(/SEKRET|secret\.myloans/);
    const none = await new HttpMyLoansAdapter("", "", 8000, fake).getByPn("GD1012026901001");
    expect(none).toMatchObject({ ok: false, reason: "UNAVAILABLE", message: "MyLoans did not answer. Try again in a moment." });
  });
  it("retry with backoff, Retry-After, circuit breaker; Not found is an answer", async () => {
    let n = 0;
    const answers: MyLoansLookup[] = [];
    const inner: MyLoansAdapter = {
      name: "live", capabilities: { search: false, changedSince: false },
      getByPn: async () => { n++; return answers.shift() ?? { ok: false, reason: "UNAVAILABLE", message: "x" }; },
      search: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }), getChangedSince: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }),
    };
    const sleep = vi.fn(async () => {});
    let now = 1_000;
    const a = new ResilientAdapter(inner, { retries: 2, baseDelayMs: 100, breakAfter: 2, openMs: 60_000, sleep, now: () => now });
    answers.push({ ok: false, reason: "UNAVAILABLE", message: "busy", retryAfterMs: 2_000 }, { ok: true, record: rec(), raw: {}, adapter: "live", retrievedAt: new Date() });
    expect((await a.getByPn("GD1012026901001")).ok).toBe(true);
    expect(sleep).toHaveBeenLastCalledWith(2_000); // Retry-After honoured
    n = 0;
    answers.push({ ok: false, reason: "NOT_FOUND", message: "PN not found." });
    expect(await a.getByPn("PN-1")).toMatchObject({ reason: "NOT_FOUND" });
    expect(n).toBe(1); // no retry
    sleep.mockClear();
    await a.getByPn("PN-1"); // 3 tries, backoff 100, 200
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([100, 200]);
    await a.getByPn("PN-1"); // second failure: the breaker opens
    n = 0;
    expect(await a.getByPn("PN-1")).toMatchObject({ ok: false, message: expect.stringMatching(/several times/) });
    expect(n).toBe(0); // not called while open
    now += 61_000;
    answers.push({ ok: true, record: rec(), raw: {}, adapter: "live", retrievedAt: new Date() });
    expect((await a.getByPn("PN-1")).ok).toBe(true);
  });
});
