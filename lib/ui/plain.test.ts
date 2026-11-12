import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS, deadlineChip, historySentence, initials, listStage, plainMessage, progressStep, stageWords, stepState, txnChip } from "./plain";
import { STAGES } from "@/lib/workflow/stage";

describe("plain words", () => {
  it("maps stages", () => {
    expect(stageWords("For checklist")).toBe("Check documents");
    expect(stageWords("Assigned to DP")).toBe("Waiting on processor");
    expect(stageWords("Awaiting LA acceptance")).toBe("Check the returned package");
    expect(stageWords("In Safekeeping")).toBe("Safe in vault");
  });
  it("deadline chips", () => {
    const now = new Date("2026-11-06T03:00:00Z"); // Friday
    expect(deadlineChip({ badge: "DUE_TODAY", deadline: "2026-11-06" }, new Set(), now)?.text).toBe("Due today");
    expect(deadlineChip({ badge: "ON_TIME", deadline: "2026-11-10" }, new Set(), now)?.text).toBe("2 days left");
    expect(deadlineChip({ badge: "OVERDUE", deadline: "2026-11-05" }, new Set(), now)?.text).toBe("Late by 1 day");
  });
  it("progress step: 10 steps from the stage", () => {
    expect(JOURNEY_STEPS.map((x) => x.name)).toEqual(["Loan opened", "Classified", "Check documents", "Processing", "Your acceptance", "Vault", "DigiCur", "Pull-out", "QA review", "Closure"]);
    for (const [stage, n] of [["Opened", 3], ["For checklist", 3], ["No DP assignment required", 3], ["Assigned to DP", 4], ["In process", 4], ["Awaiting LA acceptance", 5], ["For Vault Transmittal", 6], ["In transit to Vault", 6], ["In Safekeeping", 7], ["Closed", 10], ["Archived", 11], ["Disposed", 11]] as const) {
      expect([stage, progressStep(stage)]).toEqual([stage, n]);
    }
    expect([stepState(2, 3), stepState(3, 3), stepState(4, 3)]).toEqual(["Done", "Now", "Later"]);
  });
  it("list stage: every stage on the stepper's own steps (same names, neutral where viewer-specific), or a plain word", () => {
    const want: Record<string, [number, string] | string> = {
      Opened: [3, "Check documents"], "For checklist": [3, "Check documents"], "No DP assignment required": [3, "Check documents"],
      "Assigned to DP": [4, "Processing"], "In process": [4, "Processing"], "Awaiting LA acceptance": [5, "Acceptance"],
      "For Vault Transmittal": [6, "Vault"], "In transit to Vault": [6, "Vault"], "In Safekeeping": [7, "DigiCur"], Closed: [10, "Closure"],
      "Cancelled in MyLoans": "Cancelled in MyLoans", Archived: "Archived", Disposed: "Disposed",
    };
    for (const stage of STAGES) {
      const s = listStage(stage);
      const w = want[stage];
      expect(w, `${stage} is mapped`).toBeDefined();
      if (typeof w === "string") expect(s).toEqual({ step: null, word: w });
      else {
        expect(s).toEqual({ step: w[0], total: 10, name: w[1] });
        // The same step number as the loan-file stepper, and its name (only "Your acceptance" is made neutral).
        expect(progressStep(stage)).toBe(w[0]);
        expect(JOURNEY_STEPS[w[0] - 1].name.replace(/^Your acceptance$/, "Acceptance")).toBe(w[1]);
      }
    }
    expect(Object.values(want).some((w) => Array.isArray(w) && w[1].startsWith("Your"))).toBe(false);
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
