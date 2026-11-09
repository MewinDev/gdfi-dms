import { describe, expect, it } from "vitest";
import {
  buildJourney, currentOwner, custodyOf, dayCells, splitSegments, stateTotals,
  type AssignmentRec, type DocRec, type EventRec, type HoldRec, type JourneyInput, type ProblemRec, type TxnRec,
} from "./build-journey";
import { businessDate, fmtDateTime, fmtShort } from "@/lib/time";
import { holdDays, stepClock } from "./tat";

/** An instant given in Philippine time: at("2026-11-02 09:00"). */
const at = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const H = 3_600_000;
const tats = new Map([
  ["P3_CHECKLIST", 1], ["P3_LABELS", 0], ["P3_ASSIGN", 2], ["P3_EDST", 1], ["P4_ACCEPT", 0], ["P4_NOTARY", 3], ["P4_PPSR", 3], ["P4_MORTGAGE", 5],
  ["P4_FORWARD", 1], ["P5_ACCEPT", 2], ["P6_VAULTED", 3], ["P7_DIGICUR", 5],
].map(([k, d]) => [k as string, { businessDays: d as number, note: "", label: k as string }]));
const none = new Set<string>();
const LA = { id: "u-la", name: "Ana Cruz" };
const JOY = { id: "u-joy", name: "Joy Navarro" };
const GRACE = { id: "u-grace", name: "Grace Tan" };

function assignment(p: Partial<AssignmentRec> = {}): AssignmentRec {
  return {
    id: "a1", status: "ACCEPTED", endorsedAt: at("2026-11-02 11:00"), decidedAt: at("2026-11-03 09:00"), returnedAt: null, processedAt: null,
    forwardedAt: null, closedAt: null, dp: JOY, second: null, receivingLa: null, assignedBy: LA, ...p,
  };
}
function txn(p: Partial<TxnRec> = {}): TxnRec {
  return {
    id: "t1", code: "NOTARY", name: "Notary", requiresDp: true, ownerRole: "DP", status: "IN_PROCESS", statusSince: at("2026-11-03 09:00"),
    createdAt: at("2026-11-02 09:00"), completedAt: null, cancelledAt: null, readyAt: at("2026-11-02 10:00"), fundsNeeded: "NO", fundsStatus: "Not needed",
    assignments: [assignment()], attempts: [], problems: [], holds: [], advances: [], ...p,
  };
}
const hold = (p: Partial<HoldRec> = {}): HoldRec => ({
  id: "h1", reason: "Waiting on borrower", note: "", raisedAt: at("2026-11-03 13:00"), raisedBy: "Joy Navarro",
  resumedAt: null, resumedBy: null, resumeNote: "", simulated: false, ...p,
});
const problem = (p: Partial<ProblemRec> = {}): ProblemRec => ({
  id: "p1", reason: "LTO system down", note: "", raisedAt: at("2026-11-04 10:00"), raisedBy: "Joy Navarro",
  resolvedAt: null, resolvedBy: null, resolutionNote: "", outsideControl: false, simulated: false, ...p,
});
function input(transactions: TxnRec[], p: Partial<JourneyInput> = {}): JourneyInput {
  return {
    loan: {
      pn: "PN-1", stage: "In process", stageSince: at("2026-11-03 09:00"), classification: "FINANCING", mortgageResult: "NOT_MORTGAGE", overridden: false,
      openedAt: at("2026-11-02 09:00"), openedBy: LA, branchName: "Antipolo", openSourceChange: false, transmittalDispatched: false, transmittalReceived: false,
    },
    transactions, documents: [], advances: [], events: [], ...p,
  };
}
const steps = (j: ReturnType<typeof buildJourney>, code = "NOTARY") => j.phases.flatMap((p) => p.steps).filter((s) => s.txnCode === code);
const step = (j: ReturnType<typeof buildJourney>, id: string, code = "NOTARY") => steps(j, code).find((s) => s.stepId === id)!;
const sumMs = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("buildJourney: transaction steps", () => {
  it("normal flow: every step done in order, with owner, times and on-time TAT", () => {
    const t = txn({
      status: "COMPLETED", statusSince: at("2026-11-05 09:00"), completedAt: at("2026-11-05 09:00"),
      assignments: [assignment({ status: "CLOSED", processedAt: at("2026-11-04 09:00"), forwardedAt: at("2026-11-04 10:00"), closedAt: at("2026-11-05 09:00"), receivingLa: LA })],
    });
    const j = buildJourney(input([t]), tats, none, at("2026-11-06 09:00"));
    expect(steps(j).map((s) => s.stepId)).toEqual(["3.1", "3.6", "4.1", "4.2", "4.6", "5.1"]);
    expect(steps(j).every((s) => s.state === "done")).toBe(true);
    const p = step(j, "4.2");
    expect(p.ownerName).toBe("Joy Navarro");
    expect(p.start).toEqual(at("2026-11-03 09:00"));
    expect(p.end).toEqual(at("2026-11-04 09:00"));
    expect(p.tat.actualText).toBe("Done on time");
    expect(step(j, "5.1").ownerName).toBe("Ana Cruz");
    expect(j.txns[0]).toMatchObject({ state: "done", done: true, openSegment: null, tat: null });
  });

  it("hold only: the step is On hold, the open segment is the hold, and the time in each state adds up", () => {
    const now = at("2026-11-04 15:00");
    const j = buildJourney(input([txn({ holds: [hold()] })]), tats, none, now);
    const p = step(j, "4.2");
    expect(p.state).toBe("hold");
    expect(p.segments.map((s) => s.state)).toEqual(["processing", "hold"]);
    expect(p.segments.at(-1)!.end).toBeNull();
    expect(p.holds).toHaveLength(1);
    expect(sumMs(p.stateMs)).toBe(p.durationMs);
    expect(j.txns[0].tat?.state).toBe("hold");
    expect(j.txns[0].tat?.text).toMatch(/^On hold 1 day · Waiting on borrower · Day 1 of 3$/);
    expect(j.txns[0].openSegment?.state).toBe("hold");
  });

  it("problem only: red state and nested problem", () => {
    const j = buildJourney(input([txn({ problems: [problem()] })]), tats, none, at("2026-11-04 15:00"));
    expect(step(j, "4.2").state).toBe("problem");
    expect(step(j, "4.2").problems[0].reason).toBe("LTO system down");
    expect(j.txns[0].tat?.state).toBe("problem");
  });

  it("hold then problem (both resolved): processing, hold, processing, problem, processing", () => {
    const t = txn({
      holds: [hold({ resumedAt: at("2026-11-03 16:00") })],
      problems: [problem({ raisedAt: at("2026-11-04 10:00"), resolvedAt: at("2026-11-04 12:00") })],
    });
    const now = at("2026-11-04 15:00");
    const p = step(buildJourney(input([t]), tats, none, now), "4.2");
    expect(p.segments.map((s) => s.state)).toEqual(["processing", "hold", "processing", "problem", "processing"]);
    expect(p.stateMs.hold).toBe(3 * H);
    expect(p.stateMs.problem).toBe(2 * H);
    expect(sumMs(p.stateMs)).toBe(p.durationMs);
    expect(p.state).toBe("now");
  });

  it("overlapping hold and problem: the problem wins the colour while both are open", () => {
    const t = txn({ holds: [hold({ raisedAt: at("2026-11-03 13:00"), resumedAt: at("2026-11-04 17:00") })], problems: [problem({ raisedAt: at("2026-11-04 10:00"), resolvedAt: at("2026-11-04 12:00") })] });
    const p = step(buildJourney(input([t]), tats, none, at("2026-11-05 09:00")), "4.2");
    expect(p.segments.map((s) => s.state)).toEqual(["processing", "hold", "problem", "hold", "processing"]);
    // Both open now: the problem wins.
    const both = txn({ holds: [hold()], problems: [problem()] });
    const j2 = buildJourney(input([both]), tats, none, at("2026-11-04 15:00"));
    expect(step(j2, "4.2").state).toBe("problem");
    expect(j2.txns[0].tat?.state).toBe("problem");
  });

  it("several holds and problems, resolved and open: all nested, the open ones mark the step open", () => {
    const t = txn({
      holds: [hold({ id: "h1", resumedAt: at("2026-11-03 14:00") }), hold({ id: "h2", raisedAt: at("2026-11-05 09:00"), reason: "Waiting on another team" })],
      problems: [problem({ id: "p1", resolvedAt: at("2026-11-04 11:00") }), problem({ id: "p2", raisedAt: at("2026-11-04 13:00"), resolvedAt: at("2026-11-04 14:00") })],
    });
    const now = at("2026-11-05 11:00");
    const p = step(buildJourney(input([t]), tats, none, now), "4.2");
    expect(p.holds.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(p.problems.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(p.holds.find((h) => h.id === "h2")!.resumedAt).toBeNull();
    expect(p.open).toBe(true);
    expect(p.state).toBe("hold");
    expect(sumMs(p.stateMs)).toBe(p.durationMs);
  });

  it("Pasuyo: the second processor is an owner of the processor steps", () => {
    const t = txn({ assignments: [assignment({ second: GRACE })] });
    const j = buildJourney(input([t]), tats, none, at("2026-11-04 09:00"));
    expect(step(j, "4.2").ownerName).toBe("Joy Navarro and Grace Tan");
    expect(step(j, "4.2").ownerIds).toEqual(["u-joy", "u-grace"]);
  });

  it("DP attempts sit under the processing step, newest first", () => {
    const t = txn({ attempts: [
      { id: "x1", date: "2026-11-03", result: "NOT_PROCESSED", reason: "Long queue", note: "", by: "Joy Navarro", createdAt: at("2026-11-03 16:00"), simulated: false },
      { id: "x2", date: "2026-11-04", result: "DONE", reason: null, note: "", by: "Joy Navarro", createdAt: at("2026-11-04 16:00"), simulated: false },
    ] });
    const p = step(buildJourney(input([t]), tats, none, at("2026-11-05 09:00")), "4.2");
    expect(p.attempts.map((a) => a.id)).toEqual(["x2", "x1"]);
  });

  it("system events are the details of their step (newest first) and keep the Simulated label", () => {
    const ev = (id: string, action: string, when: string, simulated = false): EventRec => ({ id, at: at(when), action, by: simulated ? "Joy Navarro (Simulated)" : "Joy Navarro", text: `${action} text`, simulated, journeyStep: null, txnId: "t1", phase: 4 });
    const events = [ev("e1", "assigned_to_dp", "2026-11-02 11:00"), ev("e2", "dp_assignment_accepted", "2026-11-03 09:00", true), ev("e3", "attempt_logged", "2026-11-03 16:00"), ev("e4", "attempt_logged", "2026-11-04 16:00")];
    const j = buildJourney(input([txn()], { events }), tats, none, at("2026-11-05 09:00"));
    expect(step(j, "3.6").events.map((e) => e.text)).toEqual(["assigned_to_dp text"]);
    expect(step(j, "4.1").simulated).toBe(true);
    expect(step(j, "4.2").events.map((e) => e.at)).toEqual([at("2026-11-04 16:00"), at("2026-11-03 16:00")]);
  });

  it("later steps show owner and target only; phases 7 to 10 are later", () => {
    const j = buildJourney(input([txn()]), tats, none, at("2026-11-04 09:00"));
    const f = step(j, "4.6");
    expect(f.state).toBe("later");
    expect(f.start).toBeNull();
    expect(f.ownerRoles).toEqual(["DP"]);
    expect(f.tat.targetText).toBe("1 business day");
    const digi = j.phases[6];
    expect(digi.state).toBe("upcoming");
    expect(digi.steps.every((s) => s.state === "later" || s.state === "na")).toBe(true);
  });

  it("not applicable steps: Refinancing skips the financing questions; a cancelled transaction has no rows", () => {
    const inp = input([txn(), txn({ id: "t2", code: "PPSR", name: "Entry of PPSR", status: "CANCELLED", cancelledAt: at("2026-11-02 12:00") })]);
    inp.loan.classification = "REFINANCING";
    const j = buildJourney(inp, tats, none, at("2026-11-04 09:00"));
    expect(j.phases[1].steps.find((s) => s.stepId === "2.2")!.state).toBe("na");
    expect(steps(j, "PPSR")).toEqual([]);
    expect(j.txns.find((t) => t.code === "PPSR")!.state).toBe("na");
  });

  it("custom transaction types: an LA type gets its own work step, a DP type a processing row", () => {
    const la = txn({ id: "c1", code: "INSURE", name: "Insurance check", requiresDp: false, ownerRole: "LA", status: "READY", statusSince: at("2026-11-02 10:00"), assignments: [] });
    const dp = txn({ id: "c2", code: "COURIER", name: "Courier pickup" });
    const j = buildJourney(input([la, dp]), tats, none, at("2026-11-04 09:00"));
    expect(steps(j, "INSURE").map((s) => [s.stepId, s.title, s.state])).toEqual([["3.1", "Check the papers", "done"], ["3.3", "Do the Insurance check work", "now"]]);
    expect(step(j, "4.4", "COURIER").title).toBe("Courier pickup: processing");
    expect(step(j, "4.4", "COURIER").state).toBe("now");
  });

  it("EDST: the LA enters it; no processor steps", () => {
    const e = txn({ id: "e1", code: "EDST", name: "For EDST", requiresDp: false, ownerRole: "LA", status: "READY", statusSince: at("2026-11-02 10:00"), assignments: [] });
    const j = buildJourney(input([e]), tats, none, at("2026-11-03 09:00"));
    expect(steps(j, "EDST").map((s) => s.stepId)).toEqual(["3.1", "3.3"]);
    expect(step(j, "3.3", "EDST").title).toBe("Enter in EDST and record the reference");
  });
});

describe("Segments and time", () => {
  it("the time in each state sums to the elapsed time", () => {
    const now = at("2026-11-06 12:00");
    const segs = splitSegments(at("2026-11-02 09:00"), null, "processing",
      [{ raisedAt: at("2026-11-03 09:00"), resumedAt: at("2026-11-04 09:00") }, { raisedAt: at("2026-11-05 09:00"), resumedAt: null }],
      [{ raisedAt: at("2026-11-03 12:00"), resolvedAt: at("2026-11-05 12:00") }], now);
    expect(sumMs(stateTotals(segs, now))).toBe(now.getTime() - at("2026-11-02 09:00").getTime());
    expect(segs.at(-1)!.end).toBeNull();
  });

  it("the TAT clock is identical with and without holds", () => {
    const now = at("2026-11-06 10:00");
    const a = buildJourney(input([txn()]), tats, none, now);
    const b = buildJourney(input([txn({ holds: [hold({ resumedAt: at("2026-11-05 09:00") }), hold({ id: "h2", raisedAt: at("2026-11-05 10:00") })] })]), tats, none, now);
    expect(step(b, "4.2").tat.deadline).toBe(step(a, "4.2").tat.deadline);
    expect(step(b, "4.2").tat.actualText).toBe(step(a, "4.2").tat.actualText);
    expect(b.txns[0].tat!.text.match(/Day \d+ of \d+/)![0]).toBe(a.txns[0].tat!.text.match(/Day \d+ of \d+/)![0]);
    expect(b.txns[0].tat!.lateText).toBe(a.txns[0].tat!.lateText);
  });

  it("hold days count business days: weekends and holidays are skipped", () => {
    // Friday Nov 6 to Tuesday Nov 10, with Monday Nov 9 a holiday: 1 business day.
    expect(holdDays([{ raisedAt: at("2026-11-06 09:00"), resumedAt: at("2026-11-10 09:00") }], new Set(["2026-11-09"]))).toBe(1);
    expect(holdDays([{ raisedAt: at("2026-11-06 09:00"), resumedAt: at("2026-11-10 09:00") }], none)).toBe(2);
  });

  it("Manila boundaries: 11:30 PM PHT is still that Manila day; a UTC midnight does not shift the day", () => {
    const late = at("2026-11-02 23:30"); // 15:30 UTC on Nov 2
    expect(businessDate(late)).toBe("2026-11-02");
    const utcMidnight = new Date("2026-11-03T00:00:00Z"); // 8:00 AM PHT on Nov 3
    expect(businessDate(utcMidnight)).toBe("2026-11-03");
    const afterManilaMidnight = new Date("2026-11-02T16:30:00Z"); // 12:30 AM PHT Nov 3 (still Nov 2 in UTC)
    expect(businessDate(afterManilaMidnight)).toBe("2026-11-03");
    // A step started at 11:30 PM on Monday and checked at 12:30 AM Tuesday is on Day 1 of the Tuesday count.
    expect(stepClock({ targetDays: 1, start: late }, none, afterManilaMidnight)).toMatchObject({ used: 1, deadline: "2026-11-03", late: 0 });
    // Bars: the cell is the Manila day.
    const cells = dayCells({ segments: [{ state: "processing", start: late, end: afterManilaMidnight }], start: late, end: afterManilaMidnight, deadline: null, done: true }, none, afterManilaMidnight);
    expect(cells.map((c) => c.date)).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("formats in PHT: long and short", () => {
    expect(fmtDateTime(at("2026-11-07 09:12"))).toBe("Nov 7, 2026, 9:12 AM PHT");
    expect(fmtShort(at("2026-11-07 09:12"))).toBe("Nov 7, 9:12 AM");
    expect(fmtShort(new Date("2026-11-06T16:30:00Z"))).toBe("Nov 7, 12:30 AM");
  });

  it("bars: day cells by state, weekends and holidays dimmed, the deadline marked", () => {
    const now = at("2026-11-10 12:00");
    const cells = dayCells({
      segments: [
        { state: "processing", start: at("2026-11-05 09:00"), end: at("2026-11-06 09:00") },
        { state: "hold", start: at("2026-11-06 09:00"), end: at("2026-11-09 09:00") },
        { state: "problem", start: at("2026-11-09 09:00"), end: null },
      ],
      start: at("2026-11-05 09:00"), end: null, deadline: "2026-11-10", done: false,
    }, new Set(["2026-11-09"]), now);
    expect(cells.map((c) => `${c.date.slice(8)}:${c.state}${c.offDay ? "*" : ""}${c.deadline ? "|" : ""}`)).toEqual([
      "05:processing", "06:hold", "07:hold*", "08:hold*", "09:problem*", "10:problem|",
    ]);
  });
});

describe("currentOwner: who holds the ball", () => {
  const ctx = { loan: { stage: "In process", stageSince: at("2026-11-03 09:00"), openedBy: LA } };
  it("not sent: the LA", () => {
    expect(currentOwner(txn({ status: "READY", statusSince: at("2026-11-02 10:00"), assignments: [] }), ctx)).toMatchObject({ role: "LA", name: "Ana Cruz", text: "With LA Ana Cruz", since: at("2026-11-02 10:00") });
  });
  it("sent, not accepted: the processor and the second processor", () => {
    const o = currentOwner(txn({ status: "ASSIGNED", assignments: [assignment({ status: "PENDING_ACCEPTANCE", decidedAt: null, second: GRACE })] }), ctx);
    expect(o).toMatchObject({ role: "DP", text: "Waiting on DP Joy Navarro and Grace Tan", since: at("2026-11-02 11:00") });
  });
  it("accepted and in process: the processor", () => {
    expect(currentOwner(txn(), ctx)).toMatchObject({ role: "DP", text: "With DP Joy Navarro", since: at("2026-11-03 09:00") });
  });
  it("waiting for funds approval or release: Finance", () => {
    const adv = (status: string) => ({ id: "c", number: "CA-1", status, requestedAt: at("2026-11-03 10:00"), approvedAt: status === "APPROVED" ? at("2026-11-03 14:00") : null, releasedAt: null, requestedCents: null, releasedCents: null });
    expect(currentOwner(txn({ fundsNeeded: "YES", advances: [adv("REQUESTED")] }), ctx)).toMatchObject({ role: "FIN", text: "Waiting for Finance approval", since: at("2026-11-03 10:00") });
    expect(currentOwner(txn({ fundsNeeded: "YES", advances: [adv("APPROVED")] }), ctx)).toMatchObject({ role: "FIN", text: "Waiting for Finance to release the funds", since: at("2026-11-03 14:00") });
  });
  it("on hold: the holder plus the reason, since the hold started", () => {
    const o = currentOwner(txn({ holds: [hold()] }), ctx)!;
    expect(o.reason).toBe("On hold: waiting on borrower");
    expect(o.text).toBe("With DP Joy Navarro · On hold: waiting on borrower");
    expect(o.since).toEqual(at("2026-11-03 13:00"));
  });
  it("forwarded: the named receiving LA", () => {
    const o = currentOwner(txn({ status: "FORWARDED", assignments: [assignment({ processedAt: at("2026-11-04 09:00"), forwardedAt: at("2026-11-04 10:00"), receivingLa: { id: "u-ben", name: "Ben Ocampo" } })] }), ctx);
    expect(o).toMatchObject({ role: "LA", name: "Ben Ocampo", since: at("2026-11-04 10:00") });
  });
  it("done: transmittal is the branch LA; vault and later are their owner roles", () => {
    const done = txn({ status: "COMPLETED", completedAt: at("2026-11-05 09:00") });
    expect(currentOwner(done, { loan: { ...ctx.loan, stage: "For Vault Transmittal" } })).toMatchObject({ role: "LA", name: "Ana Cruz" });
    expect(currentOwner(done, { loan: { ...ctx.loan, stage: "In transit to Vault" } })).toMatchObject({ role: "VAULT" });
    expect(currentOwner(done, { loan: { ...ctx.loan, stage: "In Safekeeping" } })).toMatchObject({ role: "VAULT", name: "Vault Custodian" });
  });
});

describe("The open segment closes on the same record", () => {
  it("when the hold ends, the hold segment gets an end and no new hold appears", () => {
    const open = buildJourney(input([txn({ holds: [hold()] })]), tats, none, at("2026-11-04 09:00"));
    const ended = buildJourney(input([txn({ holds: [hold({ resumedAt: at("2026-11-04 09:30") })] })]), tats, none, at("2026-11-04 10:00"));
    expect(open.txns[0].openSegment?.state).toBe("hold");
    const segs = step(ended, "4.2").segments;
    expect(segs.map((s) => s.state)).toEqual(["processing", "hold", "processing"]);
    expect(segs[1].end).toEqual(at("2026-11-04 09:30"));
    expect(step(ended, "4.2").holds).toHaveLength(1);
    expect(ended.txns[0].openSegment?.state).toBe("processing");
  });
  it("when the next step starts, the step closes and the next one is open", () => {
    const j = buildJourney(input([txn({ assignments: [assignment({ processedAt: at("2026-11-04 09:00") })] })]), tats, none, at("2026-11-04 10:00"));
    expect(step(j, "4.2")).toMatchObject({ state: "done", end: at("2026-11-04 09:00") });
    expect(step(j, "4.6").state).toBe("now");
    expect(j.txns[0].openSegment?.start).toEqual(at("2026-11-04 09:00"));
  });
});

describe("Custody trail", () => {
  const doc = (moves: [string, string, string | null, boolean][]): DocRec => ({
    id: "d1", documentId: "PN-1-PN-001", label: "Promissory Note", originality: "ORIGINAL", txnId: "t1", stage: "AT_BRANCH",
    custodianLabel: "Ana Cruz (LA, Antipolo)", location: "Antipolo branch", since: at("2026-11-02 09:00"),
    movements: moves.map(([action, when, to, ack], i) => ({
      id: `m${i}`, action, at: at(when), from: null, to, location: null, by: to?.split(" (")[0] ?? "Ana Cruz", acknowledgedAt: ack ? at(when) : null, remarks: null, simulated: false,
    })),
  });
  it("time held by each holder; in transit stays with the sender until acknowledged", () => {
    const d = doc([
      ["RECEIVED_AT_BRANCH", "2026-11-02 09:00", "Ana Cruz (LA, Antipolo)", true],
      ["LABEL_PRINTED", "2026-11-02 09:30", "Ana Cruz (LA, Antipolo)", false],
      ["DISPATCHED_TO_DP", "2026-11-02 11:00", "Joy Navarro (DP)", false],
      ["ACKNOWLEDGED_BY_DP", "2026-11-03 09:00", "Joy Navarro (DP)", true],
      ["FORWARDED_TO_BRANCH", "2026-11-04 10:00", "In transit to Ana Cruz", false],
      ["ACCEPTED_AT_BRANCH", "2026-11-05 09:00", "Ana Cruz (LA, Antipolo)", true],
    ]);
    const c = custodyOf(d, at("2026-11-05 12:00"));
    expect(c.periods.map((p) => [p.holder, p.ms / H])).toEqual([
      ["Ana Cruz (LA, Antipolo)", 24], ["Joy Navarro (DP)", 48], ["Ana Cruz (LA, Antipolo)", 3],
    ]);
    expect(c.trail[0]).toMatchObject({ label: "Received by the LA", acknowledgedBy: "Ana Cruz" });
    expect(c.trail.map((x) => x.label)).toContain("Label printed");
  });
});

describe("Custody places", () => {
  it("a holder keeps the place they held it in; the next hand-over does not rename it", async () => {
    const { custodyOf } = await import("./build-journey");
    const mk = (action: string, when: string, to: string, loc: string, ack: boolean) => ({ id: when, action, at: new Date(`${when}:00+08:00`), from: null, to, location: loc, by: "x", acknowledgedAt: ack ? new Date(`${when}:00+08:00`) : null, remarks: null, simulated: false });
    const c = custodyOf({
      id: "d", documentId: null, label: "PN", originality: "ORIGINAL", txnId: null, stage: "WITH_DP", custodianLabel: "Joy (DP)", location: "With DP Joy", since: new Date(),
      movements: [mk("RECEIVED_AT_BRANCH", "2026-11-02T09:00", "Ana (LA)", "QC branch", true), mk("ACKNOWLEDGED_BY_DP", "2026-11-03T09:00", "Joy (DP)", "With DP Joy", true)],
    }, new Date("2026-11-04T00:00:00Z"));
    expect(c.periods.map((p) => p.place)).toEqual(["QC branch", "With DP Joy"]);
  });
});
