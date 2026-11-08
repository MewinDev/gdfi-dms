import { describe, expect, it } from "vitest";
import { checklistStatus, stillNeededText, type CheckLine } from "./checklist";

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
