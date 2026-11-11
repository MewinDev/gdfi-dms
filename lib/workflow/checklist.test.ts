import { describe, expect, it } from "vitest";
import { addRemarksText, blockText, checklistStatus, remarksProblem, stillNeededText, type CheckLine } from "./checklist";

const line = (id: string, over: Partial<CheckLine> = {}): CheckLine => ({ id, label: id, checked: false, required: true, group: null, active: true, ...over });

describe("checklistStatus", () => {
  const notary = (ticked: string[]) =>
    [
      line("Promissory Note"),
      line("Disclosure Statement"),
      line("Valid IDs of borrower (2)"),
      line("Deed of Sale", { group: "Proof of sale" }),
      line("Sales Invoice", { group: "Proof of sale" }),
      line("Valid ID of co-maker", { required: false }),
    ].map((l) => ({ ...l, checked: ticked.includes(l.id) }));

  it("lists every missing required paper and the unsatisfied pick-one group", () => {
    const s = checklistStatus(notary([]));
    expect(s.complete).toBe(false);
    expect(s.missing.map((m) => m.name)).toEqual([
      "Promissory Note", "Disclosure Statement", "Valid IDs of borrower (2)", "Proof of sale (Deed of Sale or Sales Invoice)",
    ]);
    expect(s.missing[3].lineIds).toEqual(["Deed of Sale", "Sales Invoice"]);
    expect(s.requiredTotal).toBe(4);
    expect(s.optionalTotal).toBe(1);
  });

  it("is complete with every required paper ticked and the optional one blank", () => {
    const s = checklistStatus(notary(["Promissory Note", "Disclosure Statement", "Valid IDs of borrower (2)", "Sales Invoice"]));
    expect(s.complete).toBe(true);
    expect(s.requiredDone).toBe(4);
    expect(s.optionalDone).toBe(0);
  });

  it("names exactly the one missing paper", () => {
    const s = checklistStatus(notary(["Promissory Note", "Disclosure Statement", "Deed of Sale", "Valid ID of co-maker"]));
    expect(s.missing.map((m) => m.name)).toEqual(["Valid IDs of borrower (2)"]);
    expect(s.optionalDone).toBe(1);
    expect(stillNeededText(s.missing)).toBe("Still needed: Valid IDs of borrower (2).");
  });

  it("never blocks on optional lines, and ignores switched-off lines", () => {
    expect(checklistStatus([line("a", { required: false })]).complete).toBe(true);
    expect(checklistStatus([line("a", { active: false })]).complete).toBe(true);
  });

  it("a pick-one group whose lines are optional is optional", () => {
    const s = checklistStatus([line("x", { group: "G", required: false }), line("y", { group: "G", required: false })]);
    expect(s.complete).toBe(true);
    expect(s.optionalTotal).toBe(2);
  });
});

describe("missing papers with reasons", () => {
  const base = () => [
    line("Deed of Sale"),
    line("Valid ID"),
    line("Co-maker ID", { required: false }),
    line("OR/CR", { group: "Vehicle registration" }),
    line("CR only", { group: "Vehicle registration" }),
  ];

  it("a missing paper without remarks blocks and is named; with remarks it is an exception and the file goes on", () => {
    const lines = base().map((l) => ({ ...l, checked: ["OR/CR"].includes(l.id), missing: ["Deed of Sale", "Valid ID"].includes(l.id) ? "MISSING" as const : null }));
    let s = checklistStatus(lines);
    expect(s.complete).toBe(false);
    expect(s.missing).toEqual([]);
    expect(addRemarksText(s.needsRemarks)).toBe("Add remarks for: Deed of Sale, Valid ID");
    expect(blockText(s)).toBe("Add remarks for: Deed of Sale, Valid ID.");
    s = checklistStatus(lines.map((l) => ({ ...l, remarksSaved: true })));
    expect(s.complete).toBe(true);
    expect(s.exceptions.map((m) => m.name)).toEqual(["Deed of Sale", "Valid ID"]);
    expect([s.requiredDone, s.requiredTotal]).toEqual([3, 3]);
  });

  it("an optional paper not included is ignored; included it is expected like a required one", () => {
    const present = (l: CheckLine) => ({ ...l, checked: l.required });
    expect(checklistStatus(base().map(present)).complete).toBe(true);
    const included = base().map(present).map((l) => (l.id === "Co-maker ID" ? { ...l, included: true } : l));
    expect(checklistStatus(included).missing.map((m) => m.name)).toEqual(["Co-maker ID"]);
    expect(checklistStatus(included.map((l) => (l.id === "Co-maker ID" ? { ...l, missing: "MISSING" as const } : l))).needsRemarks.map((m) => m.name)).toEqual(["Co-maker ID"]);
    expect(checklistStatus(included.map((l) => (l.id === "Co-maker ID" ? { ...l, missing: "MISSING" as const, remarksSaved: true } : l))).complete).toBe(true);
  });

  it("a pick-one group is answered by one present line, or by a missing line with remarks", () => {
    const g = (over: Record<string, Partial<CheckLine>>) => checklistStatus(base().map((l) => ({ ...l, checked: ["Deed of Sale", "Valid ID"].includes(l.id), ...(over[l.id] ?? {}) })));
    expect(g({}).missing.map((m) => m.name)).toEqual(["Vehicle registration (OR/CR or CR only)"]);
    expect(g({ "CR only": { missing: "MISSING" } }).needsRemarks.map((m) => m.name)).toEqual(["CR only"]);
    expect(g({ "CR only": { missing: "MISSING", remarksSaved: true } }).complete).toBe(true);
  });

  it("received late counts as present", () => {
    const s = checklistStatus(base().map((l) => ({ ...l, checked: l.required || false, missing: l.id === "Valid ID" ? "RECEIVED_LATE" as const : null })));
    expect(s.complete).toBe(true);
    expect(s.exceptions).toEqual([]);
  });

  it("remarks are 5 to 500 characters", () => {
    expect(remarksProblem("abcd")).toMatch(/at least 5/);
    expect(remarksProblem("abcde")).toBeNull();
    expect(remarksProblem("x".repeat(500))).toBeNull();
    expect(remarksProblem("x".repeat(501))).toMatch(/500 characters or fewer/);
  });
});
