import { describe, expect, it } from "vitest";
import { filterFunds, fundsListUrl, lineStatus, liquidationChip, parseFundsParams, shownFundsStatus, toggleFundsStatus, type FundsRowLike } from "./my-list";

const row = (p: Partial<FundsRowLike>): FundsRowLike => ({ status: "needs", borrower: "Ana Reyes", pn: "GD1652026901001", typeCode: null, txnCode: "NOTARY", dueDate: null, late: false, ...p });

describe("D-065 My funds: the address and the status choices", () => {
  it("reads and writes only what differs from the default", () => {
    const p = parseFundsParams({ status: "overdue,liquidated,nope", q: " ana ", type: "ft", txn: "EDST", late: "1", sort: "borrower", dir: "desc" });
    expect(p).toEqual({ status: ["overdue", "liquidated"], q: "ana", type: "FT", txn: "EDST", late: true, sort: "borrower", dir: "desc" });
    expect(fundsListUrl(p)).toBe("/my-funds?status=overdue%2Cliquidated&q=ana&type=FT&txn=EDST&late=1&sort=borrower&dir=desc");
    expect(fundsListUrl(parseFundsParams({}))).toBe("/my-funds");
  });
  it("All open by default; a status shows that one only; unticking the last one is All open again", () => {
    expect(shownFundsStatus([])).toEqual(["needs", "requested", "approved", "released", "liquidate", "overdue"]);
    expect(toggleFundsStatus([], "overdue")).toEqual(["overdue"]);
    expect(toggleFundsStatus(["overdue"], "needs")).toEqual(["needs", "overdue"]);
    expect(toggleFundsStatus(["overdue"], "overdue")).toEqual([]);
  });
});

describe("D-065 the status of an advance line", () => {
  const s = (advanceStatus: string, o: Partial<{ lineDenied: boolean; liquidationDue: boolean; overdue: boolean }> = {}) =>
    lineStatus({ advanceStatus, lineDenied: false, liquidationDue: false, overdue: false, ...o });
  it("requested, approved, released, to liquidate, overdue, liquidated, returned/cancelled", () => {
    expect(s("REQUESTED")).toBe("requested");
    expect(s("APPROVED")).toBe("approved");
    expect(s("RELEASED")).toBe("released");
    expect(s("RELEASED", { liquidationDue: true })).toBe("liquidate");
    expect(s("PARTIALLY_LIQUIDATED")).toBe("liquidate");
    expect(s("RELEASED", { liquidationDue: true, overdue: true })).toBe("overdue");
    expect(s("LIQUIDATED")).toBe("liquidated");
    expect(s("CLOSED")).toBe("liquidated");
    expect(s("DENIED")).toBe("closed");
    expect(s("CANCELLED")).toBe("closed");
    expect(s("RELEASED", { lineDenied: true })).toBe("closed");
  });
});

describe("D-065 the Liquidation due chip", () => {
  const c = (o: Partial<Parameters<typeof liquidationChip>[0]>) => liquidationChip({ status: "liquidate", mustLiquidate: true, daysLeft: null, waitingFor: null, daysLate: null, ...o });
  it("due in N days, due today, overdue by N days, waiting for the LTO pickup, liquidated", () => {
    expect(c({ daysLeft: 2 })).toEqual({ text: "Due in 2 days", tone: "ok", kind: "due" });
    expect(c({ daysLeft: 1 })?.tone).toBe("act");
    expect(c({ daysLeft: 0 })?.text).toBe("Due today");
    expect(c({ status: "overdue", daysLeft: -1 })).toEqual({ text: "Overdue by 1 day", tone: "bad", kind: "overdue" });
    expect(c({ status: "released", waitingFor: "LTO" })?.text).toBe("Waiting for LTO pickup");
    expect(c({ status: "liquidated", daysLate: 0 })?.text).toBe("Liquidated on time");
    expect(c({ status: "liquidated", daysLate: 2 })?.text).toBe("Liquidated 2 days late");
    expect(c({ mustLiquidate: false })?.text).toBe("No receipts needed");
    expect(c({ status: "requested" })).toBeNull();
  });
});

describe("D-065 filters, counts and order", () => {
  const all = [
    row({ borrower: "Fe Reyes" }),
    row({ borrower: "Ivan Lopez", status: "liquidate", typeCode: "CA", dueDate: "2026-11-30" }),
    row({ borrower: "Jun Santos", status: "overdue", typeCode: "CA", dueDate: "2026-11-23", late: true }),
    row({ borrower: "Lea Tan", status: "released", typeCode: "FT", txnCode: "PPSR" }),
    row({ borrower: "Kim Ramos", status: "liquidated", typeCode: "CA" }),
  ];
  const run = (sp: Record<string, string>) => filterFunds(all, parseFundsParams(sp));
  it("All open by default, overdue liquidation first, then the soonest due", () => {
    expect(run({}).rows.map((r) => r.borrower)).toEqual(["Jun Santos", "Ivan Lopez", "Fe Reyes", "Lea Tan"]);
    expect(run({}).counts.status).toMatchObject({ needs: 1, liquidate: 1, overdue: 1, released: 1, liquidated: 1, closed: 0 });
  });
  it("search, Type, Transaction, Late only", () => {
    expect(run({ q: "lea" }).rows.map((r) => r.borrower)).toEqual(["Lea Tan"]);
    expect(run({ type: "FT" }).rows.map((r) => r.borrower)).toEqual(["Lea Tan"]);
    expect(run({ txn: "PPSR" }).rows.map((r) => r.borrower)).toEqual(["Lea Tan"]);
    expect(run({ late: "1" }).rows.map((r) => r.borrower)).toEqual(["Jun Santos"]);
    expect(run({ status: "liquidated" }).rows.map((r) => r.borrower)).toEqual(["Kim Ramos"]);
    expect(run({}).counts.type).toEqual({ CA: 2, FT: 1 });
  });
});
