import { describe, expect, it } from "vitest";
import { txnStatus, type TxnStatusInput } from "./txn-status";

const base: TxnStatusInput = {
  code: "NOTARY", requiresDp: true, status: "FOR_CHECKLIST", requiredDone: 0, requiredTotal: 5, tickedAny: false,
  tat: { state: "due", text: "Due today · Day 1 of 1" }, problemDays: null, holdDays: null, missingPapers: 0,
};
const s = (p: Partial<TxnStatusInput>) => txnStatus({ ...base, ...p });

describe("One status wording for a transaction", () => {
  it("not started, checking, ready", () => {
    expect(s({})).toMatchObject({ chip: { text: "Needs 5 required papers" }, line: "Not started", papers: "0 of 5 required papers" });
    expect(s({ requiredDone: 4, tickedAny: true })).toMatchObject({ chip: { text: "Needs 1 required paper" }, line: "Checking papers · then send to a processor", papers: "4 of 5 required papers" });
    expect(s({ status: "READY", requiredDone: 5, tickedAny: true })).toMatchObject({ chip: { text: "Ready to send", tone: "ok" }, line: "All required papers ticked · choose a processor" });
    expect(s({ code: "EDST", requiresDp: false, status: "READY", requiredDone: 2, requiredTotal: 2, tickedAny: true }).chip.text).toBe("Ready");
  });

  it("sent: always says it was sent and to whom, with the TAT chip as a second chip", () => {
    const sent = s({ status: "ASSIGNED", dpName: "Grace Tan" });
    expect(sent).toMatchObject({ chip: { text: "Sent" }, line: "Sent to Grace Tan · waiting to accept", papers: null });
    expect(sent.tat?.text).toBe("Due today · Day 1 of 1");
    expect(s({ status: "ASSIGNED", dpName: "Grace Tan", secondName: "Ben Ocampo" }).line).toBe("Sent to Grace Tan and Ben Ocampo · waiting to accept");
  });

  it("processing, coming back, done", () => {
    expect(s({ status: "IN_PROCESS", dpName: "Grace Tan", tat: { state: "processing", text: "Processing · Day 1 of 2" } })).toMatchObject({
      chip: { text: "Processing" }, line: "With Grace Tan · working on it", tat: { text: "Processing · Day 1 of 2" },
    });
    expect(s({ status: "FORWARDED", dpName: "Grace Tan", receivingLaName: "Ana Cruz" }).line).toBe("Grace Tan sent the package to Ana Cruz · check it when it arrives");
    const done = s({ status: "COMPLETED", requiredDone: 5 });
    expect(done).toMatchObject({ chip: { text: "Done", tone: "ok" }, line: "Done · the package came back complete", tat: null });
    expect(s({ code: "EDST", requiresDp: false, status: "COMPLETED", edstReference: "E-1" }).line).toBe("Done · EDST reference E-1");
  });

  it("sent back by the processor", () => {
    expect(s({ status: "RETURNED", dpName: "Grace Tan", requiredDone: 5 })).toMatchObject({ chip: { text: "Ready to send" }, line: "Sent back by Grace Tan · fix it and send it again" });
  });

  it("in a list the TAT chip shows only the clock; the marker says Problem or On hold (no repeat)", () => {
    const held = s({ status: "IN_PROCESS", dpName: "Grace Tan", holdDays: 1, tat: { state: "hold", text: "On hold 1 day · Waiting on borrower · Day 1 of 2" } });
    expect(held.tat).toEqual({ state: "processing", text: "Processing · Day 1 of 2" });
    expect(held.markers).toEqual([{ kind: "hold", text: "On hold 1 day" }]);
    const late = s({ status: "IN_PROCESS", problemDays: 3, tat: { state: "problem", text: "Problem 3 days · LTO down · Day 2 of 2", lateText: "+1 day late" } });
    expect(late.tat).toEqual({ state: "overdue", text: "+1 day late" });
  });

  it("markers: Problem, On hold, Missing paper (never 'Pending')", () => {
    const m = s({ problemDays: 2, holdDays: 1, missingPapers: 1 });
    expect(m.markers).toEqual([{ kind: "problem", text: "Problem 2 days" }, { kind: "hold", text: "On hold 1 day" }, { kind: "missing", text: "Missing paper" }]);
    const all = ["FOR_CHECKLIST", "READY", "RETURNED", "ASSIGNED", "IN_PROCESS", "FORWARDED", "COMPLETED"].map((status) => s({ status, problemDays: 1, holdDays: 1, missingPapers: 1 }));
    expect(JSON.stringify(all)).not.toMatch(/pending/i);
  });
});

describe("Returned by DP: papers needed", () => {
  it("is a status, not a Problem, and says who returned it and why", () => {
    const r = s({ status: "RETURNED", dpName: "Joy Navarro", returnedForPapers: "Missing paper", requiredDone: 4, tickedAny: true, missingPapers: 1 });
    expect(r.chip).toEqual({ text: "Returned by DP: papers needed", tone: "act" });
    expect(r.line).toBe("Joy Navarro returned it: Missing paper · tick the papers, then send again");
    expect(r.markers.map((m) => m.kind)).toEqual(["missing"]);
    expect(JSON.stringify(r)).not.toMatch(/pending|rejected/i);
  });
});
