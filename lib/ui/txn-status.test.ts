import { describe, expect, it } from "vitest";
import { clockText, txnStatus, type TxnStatusInput } from "./txn-status";

const base: TxnStatusInput = {
  code: "NOTARY", requiresDp: true, status: "FOR_CHECKLIST", requiredDone: 0, requiredTotal: 5, tickedAny: false,
  tat: { state: "due", text: "Due today · Day 1 of 1" }, problem: null, hold: null, missingPapers: 0,
};
const s = (p: Partial<TxnStatusInput>) => txnStatus({ ...base, ...p });
/** The plain words (the "Do this now" card says what to do). */
const WORDS = ["Returned", "Needs papers", "Missing paper", "On hold", "Problem", "Not started", "In progress", "Sent to DP", "Done", "Ready to send", "Coming back", "Cancelled"];

describe("One status word for a transaction: one soft pill, the day count as text", () => {
  it("not started, checking, ready", () => {
    expect(s({})).toMatchObject({ pill: { text: "Not started", kind: "status" }, line: "Not started" });
    expect(s({ requiredDone: 4, tickedAny: true })).toMatchObject({ pill: { text: "Needs papers" }, line: "Checking papers" });
    expect(s({ status: "READY", requiredDone: 5, tickedAny: true })).toMatchObject({ pill: { text: "Ready to send", tone: "ok" }, line: "Choose a processor" });
    expect(s({ code: "EDST", requiresDp: false, status: "READY", requiredDone: 2, requiredTotal: 2, tickedAny: true }).pill.text).toBe("In progress");
  });

  it("no papers count in the word", () => {
    expect(JSON.stringify(s({ status: "READY", requiredDone: 5, tickedAny: true }))).not.toMatch(/5 of 5/);
    expect(s({ requiredDone: 1, tickedAny: true }).pill.text).not.toMatch(/\d/);
  });

  it("sent: Sent to DP and one short line (who and the LTO office are in the detail)", () => {
    expect(s({ status: "ASSIGNED" })).toMatchObject({ pill: { text: "Sent to DP", tone: "wait" }, line: "Waiting for the DP to accept", clock: { text: "Due today", late: false } });
  });

  it("in progress, coming back, done", () => {
    expect(s({ status: "IN_PROCESS", tat: { state: "processing", text: "Processing · Day 1 of 2" } })).toMatchObject({
      pill: { text: "In progress", tone: "wait" }, line: "The DP is working on it", clock: { text: "Day 1 of 2" },
    });
    expect(s({ status: "FORWARDED" }).line).toBe("Check the package when it arrives");
    expect(s({ status: "COMPLETED", requiredDone: 5 })).toMatchObject({ pill: { text: "Done", tone: "ok" }, line: "The package came back complete", clock: null });
    expect(s({ code: "EDST", requiresDp: false, status: "COMPLETED", edstReference: "E-1" }).line).toBe("EDST reference E-1");
  });

  it("sent back by the processor: Returned, also once the papers are ticked again", () => {
    expect(s({ status: "RETURNED", requiredDone: 5 })).toMatchObject({ pill: { text: "Returned", kind: "returned" }, line: "Fix and send again" });
    expect(s({ status: "RETURNED", sentBack: "declined" }).pill.text).toBe("Returned");
  });

  it("a held transaction shows exactly one pill (On hold), the reason line, and the day count as plain text", () => {
    const held = s({ status: "READY", requiredDone: 5, tickedAny: true, hold: { reason: "Other", days: 1 }, tat: { state: "hold", text: "On hold 1 day · Other · Day 1 of 2" } });
    expect(held.pill).toEqual({ text: "On hold", tone: "hold", kind: "hold" });
    expect(held.line).toBe("On hold: Other · 1 day");
    expect(held.clock).toEqual({ text: "Day 1 of 2", late: false });
    expect(JSON.stringify(held)).not.toMatch(/Ready to send|Processing/);
    expect(s({ hold: { reason: "Waiting on borrower", days: 2 }, missingPapers: 1 }).pill.kind).toBe("hold");
  });

  it("the word is what blocks it first, in the same order as Do this now: On hold, Problem, Returned, Missing paper", () => {
    expect(s({ problem: { reason: "LTO down", days: 2 }, hold: { reason: "Other", days: 1 }, missingPapers: 1 }).pill).toMatchObject({ text: "On hold" });
    expect(s({ problem: { reason: "LTO down", days: 2 }, missingPapers: 1 })).toMatchObject({ pill: { text: "Problem", tone: "bad" }, line: "Problem: LTO down · 2 days" });
    expect(s({ status: "RETURNED", missingPapers: 1, requiredDone: 4 }).pill.text).toBe("Returned");
    expect(s({ missingPapers: 1, requiredDone: 4, tickedAny: true })).toMatchObject({ pill: { text: "Missing paper", kind: "missing" }, line: "Checking papers" });
    const all = ["FOR_CHECKLIST", "READY", "RETURNED", "ASSIGNED", "IN_PROCESS", "FORWARDED", "COMPLETED", "CANCELLED"].flatMap((status) => [s({ status }), s({ status, missingPapers: 1 })]);
    for (const x of all) expect(WORDS).toContain(x.pill.text);
    expect(JSON.stringify(all)).not.toMatch(/pending/i);
  });

  it("the clock as text: day count, due today, late (never a second pill)", () => {
    expect(clockText({ state: "hold", text: "On hold 1 day · Other · Day 1 of 2" })).toEqual({ text: "Day 1 of 2", late: false });
    expect(clockText({ state: "problem", text: "Problem 3 days · LTO down · Day 2 of 2", lateText: "+1 day late" })).toEqual({ text: "+1 day late", late: true });
    expect(clockText({ state: "overdue", text: "+2 days late" })).toEqual({ text: "+2 days late", late: true });
    expect(clockText({ state: "due", text: "Due today · Day 2 of 2" })).toEqual({ text: "Due today", late: false });
    expect(clockText({ state: "done", text: "Done on time" })).toBeNull();
  });
});

describe("Returned by DP: papers needed", () => {
  it("is a status, not a Problem; the Loan File line says why", () => {
    const r = s({ status: "RETURNED", returnedForPapers: "Missing paper", requiredDone: 4, tickedAny: true });
    expect(r.pill).toEqual({ text: "Returned", tone: "act", kind: "returned" });
    expect(r.line).toBe("Returned: Missing paper");
    expect(JSON.stringify(r)).not.toMatch(/pending|rejected/i);
  });
});
