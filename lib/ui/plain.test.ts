import { describe, expect, it } from "vitest";
import { deadlineChip, historySentence, initials, plainMessage, stepState, txnChip } from "./plain";

describe("plain words", () => {
  it("history: a stage change reads with the stage map's name", () => {
    expect(historySentence({ actorLabel: "System", action: "stage_changed", mode: "AUTOMATIC", summary: "", after: { stage: "Awaiting LA acceptance" } })).toBe("The loan moved to “Forwarding to LA branch”.");
  });
  it("deadline chips", () => {
    const now = new Date("2026-11-06T03:00:00Z"); // Friday
    expect(deadlineChip({ badge: "DUE_TODAY", deadline: "2026-11-06" }, new Set(), now)?.text).toBe("Due today");
    expect(deadlineChip({ badge: "ON_TIME", deadline: "2026-11-10" }, new Set(), now)?.text).toBe("2 days left");
    expect(deadlineChip({ badge: "OVERDUE", deadline: "2026-11-05" }, new Set(), now)?.text).toBe("Late by 1 day");
  });
  it("step state", () => {
    expect([stepState(2, 3), stepState(3, 3), stepState(4, 3)]).toEqual(["Done", "Now", "Later"]);
  });
  it("txn chips", () => {
    expect(txnChip({ code: "NOTARY", requiresDp: true, status: "FOR_CHECKLIST", checkedCount: 0 }).text).toBe("Not started");
    expect(txnChip({ code: "NOTARY", requiresDp: true, status: "FOR_CHECKLIST", checkedCount: 2 }).text).toBe("In progress");
    expect(txnChip({ code: "NOTARY", requiresDp: true, status: "READY", checkedCount: 5 }).text).toBe("Ready");
  });
  it("initials", () => {
    expect(initials("Ana Villanueva")).toBe("AV");
    expect(initials("Test Loan Associate")).toBe("TL");
    expect(initials("Cher")).toBe("C");
  });
  it("rewords server messages without jargon", () => {
    expect(plainMessage("Checklist incomplete: Deed of Sale.")).toBe("Some papers are still missing: Deed of Sale.");
    expect(plainMessage("This is past the Day 2 TAT (2026-11-09). Enter a Beyond-TAT reason.")).not.toMatch(/TAT reason/);
  });
  it("history sentence", () => {
    expect(historySentence({ actorLabel: "Test Loan Associate", action: "assigned_to_dp", mode: "MANUAL", summary: "Assigned Notary to DP Grace Tan", after: { dp: "Grace Tan" } }))
      .toBe("Test Loan Associate sent the Notary to Grace Tan.");
  });
});
