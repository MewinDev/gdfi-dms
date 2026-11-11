import { describe, expect, it } from "vitest";
import { focusTargetOf, OPEN_GROUPS, OPEN_WORD, openItemsOf, titleChipOf, type OpenTxnInput } from "./open-items";
import { holdSchema, resumeSchema } from "@/lib/services/holds";
import { requestedCheckIds } from "@/lib/services/workflow";

const at = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const none = new Set<string>();
const txn = (p: Partial<OpenTxnInput> = {}): OpenTxnInput => ({ id: "t1", code: "NOTARY", name: "Notary", problems: [], holds: [], request: null, stillMissing: [], ...p });
const problem = { id: "p1", raisedAt: at("2026-11-03 09:00"), resolvedAt: null, raisedByLabel: "Joy", note: "", outsideControl: false, reason: { name: "LTO system down" } };
const hold = { id: "h1", raisedAt: at("2026-11-02 09:00"), resumedAt: null, raisedByLabel: "Ana", note: "Signed page", reason: { name: "Waiting on borrower" } };
const request = (p: Partial<NonNullable<OpenTxnInput["request"]>> = {}) => ({ id: "x1", raisedAt: at("2026-11-01 09:00"), raisedByLabel: "Ana", askedFrom: null, rows: null, papers: [], ...p });

describe("Open items", () => {
  it("lists problems, holds and missing papers, most urgent first", () => {
    const items = openItemsOf([
      txn({ id: "t2", code: "PPSR", name: "Entry of PPSR", request: request({ rows: [{ id: "l1", label: "OR/CR" }], askedFrom: "Borrower" }) }),
      txn({ holds: [hold], problems: [problem] }),
    ], none, at("2026-11-04 09:00"));
    expect(items.map((i) => [i.kind, i.txnCode, i.reason])).toEqual([
      ["problem", "NOTARY", "LTO system down"], ["hold", "NOTARY", "Waiting on borrower"], ["missing", "PPSR", "OR/CR"],
    ]);
    expect(items[1].days).toBe(2);
    expect(items[2]).toMatchObject({ lineIds: ["l1"], askedFrom: "Borrower", papers: ["OR/CR"] });
  });

  it("closed items are gone: resolved problem, resumed hold, no open request", () => {
    expect(openItemsOf([txn({ problems: [{ ...problem, resolvedAt: at("2026-11-03 10:00") }], holds: [{ ...hold, resumedAt: at("2026-11-02 10:00") }] })], none)).toEqual([]);
  });

  it("missing paper: only the requested rows still unticked; never every unticked paper", () => {
    const [m] = openItemsOf([txn({ request: request({ rows: [{ id: "l2", label: "Insurance" }] }), stillMissing: [{ name: "Insurance", lineIds: ["l2"] }, { name: "Deed of Sale", lineIds: ["l3"] }] })], none);
    expect(m.papers).toEqual(["Insurance"]);
    expect(m.lineIds).toEqual(["l2"]);
    expect(focusTargetOf(m)).toBe("line-l2");
    expect(focusTargetOf({ kind: "hold", id: "h1", lineIds: [] })).toBe("open-h1");
    // Older requests stored names only: matched by name, not "every unticked paper".
    const [old] = openItemsOf([txn({ request: request({ papers: ["Insurance"] }), stillMissing: [{ name: "Insurance", lineIds: ["l2"] }, { name: "Deed of Sale", lineIds: ["l3"] }] })], none);
    expect(old.lineIds).toEqual(["l2"]);
  });

  it("title chips and card groups use exactly Missing paper, On hold and Problem", () => {
    expect(titleChipOf({ kind: "hold", days: 1, papers: [] })).toEqual({ text: "On hold · 1 day", tone: "hold" });
    expect(titleChipOf({ kind: "problem", days: 2, papers: [] })).toEqual({ text: "Problem · 2 days", tone: "bad" });
    expect(titleChipOf({ kind: "missing", days: 0, papers: ["OR/CR"] })).toEqual({ text: "1 paper requested", tone: "bad" });
    expect(Object.values(OPEN_WORD)).toEqual(["Problem", "On hold", "Missing paper"]);
    expect(OPEN_GROUPS.map((g) => g.title)).toEqual(["Waiting for papers", "On hold", "Problems"]);
    expect(JSON.stringify([OPEN_WORD, OPEN_GROUPS])).not.toMatch(/pending/i);
  });
});

describe("Server rules for the pop-ups", () => {
  it("hold: a reason is required; there is no expected date", () => {
    expect(holdSchema.safeParse({ transactionId: "t", reasonId: "" }).error?.issues[0].message).toBe("Pick a reason.");
    expect(Object.keys(holdSchema.shape)).toEqual(["transactionId", "reasonId", "note"]);
  });
  it("resume remarks are required, at least 3 characters", () => {
    expect(resumeSchema.safeParse({ note: "  ok " }).success).toBe(false);
    expect(resumeSchema.safeParse({ note: "Borrower signed" }).success).toBe(true);
  });
  it("missing-paper requests (the processor's return) name their papers by row", () => {
    expect(requestedCheckIds({ checkIds: ["c1"] })).toEqual(["c1"]);
    expect(requestedCheckIds({ missing: ["OR/CR"] })).toBeNull();
  });
});
