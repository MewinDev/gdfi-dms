import { describe, expect, it } from "vitest";
import { buildJourney, withRole, undoubleRole, type AssignmentRec, type EventRec, type HoldRec, type JourneyInput, type ProblemRec, type TxnRec } from "./build-journey";
import { buildJourneyStory, dayHeading, dayLabel, listWords, spanText, storyDays, storyLines, timeText } from "./journey-story";

/** An instant in Philippine time: at("2026-11-09 23:54"). */
const at = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const tats = new Map([
  ["P3_CHECKLIST", 1], ["P3_ASSIGN", 2], ["P3_EDST", 1], ["P4_ACCEPT", 0], ["P4_NOTARY", 3], ["P4_PPSR", 3], ["P4_MORTGAGE", 5], ["P4_FORWARD", 1], ["P5_ACCEPT", 2],
].map(([k, d]) => [k as string, { businessDays: d as number, note: "", label: k as string }]));
const none = new Set<string>();
const LA1 = { id: "u-la", name: "LA 1" };
const DP1 = { id: "u-dp", name: "DP 1" };

const NAMES: Record<string, string> = { NOTARY: "Notary", EDST: "EDST", PPSR: "Entry of PPSR", MORTGAGE: "Mortgage" };
function txn(code: string, p: Partial<TxnRec> = {}): TxnRec {
  return {
    id: `t-${code}`, code, name: NAMES[code], requiresDp: code !== "EDST", ownerRole: code === "EDST" ? "LA" : "DP", status: "FOR_CHECKLIST",
    statusSince: at("2026-11-09 23:54"), createdAt: at("2026-11-09 23:54"), completedAt: null, cancelledAt: null, readyAt: null,
    fundsNeeded: "UNANSWERED", fundsStatus: "Not needed", assignments: [], attempts: [], problems: [], holds: [], advances: [], ...p,
  };
}
function assignment(p: Partial<AssignmentRec> = {}): AssignmentRec {
  return {
    id: "a1", status: "ACCEPTED", endorsedAt: at("2026-11-10 09:00"), decidedAt: at("2026-11-10 09:30"), returnedAt: null, processedAt: null,
    forwardedAt: null, closedAt: null, dp: DP1, second: null, receivingLa: null, assignedBy: LA1, ...p,
  };
}
const ev = (id: string, action: string, when: string, text: string, p: Partial<EventRec> = {}): EventRec => ({
  id, at: at(when), action, by: "LA 1", text, simulated: false, journeyStep: null, txnId: null, phase: 3, ...p,
});
const hold = (p: Partial<HoldRec> = {}): HoldRec => ({
  id: "h1", reason: "Waiting for the client's papers", note: "Borrower to sign", raisedAt: at("2026-11-10 10:00"), raisedBy: "DP 1",
  resumedAt: null, resumedBy: null, resumeNote: "", simulated: false, ...p,
});
const problem = (p: Partial<ProblemRec> = {}): ProblemRec => ({
  id: "p1", reason: "LTO system down", note: "", raisedAt: at("2026-11-10 11:00"), raisedBy: "DP 1",
  resolvedAt: null, resolvedBy: null, resolutionNote: "", outsideControl: false, simulated: false, ...p,
});
function input(transactions: TxnRec[], events: EventRec[] = []): JourneyInput {
  return {
    loan: {
      pn: "GD1012026900001", stage: "Checklist", stageSince: at("2026-11-09 23:54"), classification: "FINANCING", mortgageResult: "MORTGAGE", overridden: false,
      openedAt: at("2026-11-09 23:54"), openedBy: LA1, branchName: "Antipolo", openSourceChange: false, transmittalDispatched: false, transmittalReceived: false,
    },
    transactions, documents: [], advances: [], events,
  };
}
const ALL4 = () => ["NOTARY", "EDST", "PPSR", "MORTGAGE"].map((c) => txn(c));
const story = (i: JourneyInput, now = at("2026-11-10 07:24")) => buildJourneyStory(i, buildJourney(i, tats, none, now));

describe("Words", () => {
  it("lists, spans and times", () => {
    expect(listWords(["Notary"])).toBe("Notary");
    expect(listWords(["Notary", "EDST"])).toBe("Notary and EDST");
    expect(listWords(["Notary", "EDST", "Entry of PPSR", "Mortgage"])).toBe("Notary, EDST, Entry of PPSR and Mortgage");
    expect(spanText(7.5 * 3_600_000)).toBe("7 h 30 min");
    expect(spanText(4 * 60_000)).toBe("4 min");
    expect(spanText(20_000)).toBe("under 1 min");
    expect(timeText(at("2026-11-09 23:54"))).toBe("11:54 PM");
  });
  it("day headings: Today, Yesterday, then the date (Philippine days)", () => {
    const now = at("2026-11-10 07:24");
    expect(dayLabel("2026-11-10", now)).toBe("Today");
    expect(dayLabel("2026-11-09", now)).toBe("Yesterday");
    expect(dayLabel("2026-11-07", now)).toBe("Nov 7");
    // The date row: the word with the full date, or the full date alone.
    expect(dayHeading("2026-11-10", now)).toBe("Today · Tue, Nov 10, 2026");
    expect(dayHeading("2026-11-09", now)).toBe("Yesterday · Mon, Nov 9, 2026");
    expect(dayHeading("2026-11-07", now)).toBe("Sat, Nov 7, 2026");
  });
  it("a role word and a name are said once: With LA 1, not With LA LA 1", () => {
    expect(withRole("LA", "LA 1")).toBe("LA 1");
    expect(withRole("DP", "DP 2")).toBe("DP 2");
    expect(withRole("LA", "Ana Cruz")).toBe("LA Ana Cruz");
    expect(undoubleRole("With DP DP 1")).toBe("With DP 1");
    expect(undoubleRole("With DP Grace Tan")).toBe("With DP Grace Tan");
  });
});

describe("Story", () => {
  it("newest first, grouped by day; the automatic steps are one line at the bottom of their day", () => {
    const i = input(ALL4(), [
      ev("e1", "loan_file_opened", "2026-11-09 23:54", "LA 1 opened the loan file.", { journeyStep: "1.4" }),
      ev("e2", "classification_applied", "2026-11-09 23:54", "The system marked this as a Financing loan.", { by: "System", journeyStep: "2.1" }),
      ev("e3", "mortgage_determined", "2026-11-09 23:54", "The system checked the amount: a mortgage is needed.", { by: "System", journeyStep: "2.4" }),
      ev("e4", "transactions_generated", "2026-11-09 23:54", "The system listed the work to do: Notary, EDST.", { by: "System", journeyStep: "2.5" }),
      ev("e5", "labels_printed", "2026-11-10 07:10", "LA 1 printed 5 labels."),
    ]);
    const lines = storyLines(i);
    expect(lines.map((l) => l.sentence)).toEqual([
      "LA 1 printed 5 labels",
      "4 transactions created: Notary, EDST, Entry of PPSR and Mortgage",
      "LA 1 opened the loan file",
      "Loan opened and checked automatically",
    ]);
    const sys = lines.find((l) => l.system)!;
    expect(sys.system).toEqual({ count: 2 });
    const days = storyDays(lines, at("2026-11-10 07:24"));
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday"]);
    // The automatic-steps line is last of its day, even though it is not the oldest event.
    expect(days[1].lines.at(-1)!.system).toBeTruthy();
  });

  it("the same action by the same person in the same minute on several transactions is one line, with the pills", () => {
    const i = input(ALL4(), ["NOTARY", "EDST", "PPSR", "MORTGAGE"].map((c, n) =>
      ev(`c${n}`, "checklist_saved", "2026-11-10 07:00", `LA 1 checked all the ${NAMES[c]} papers.`, { txnId: `t-${c}` })));
    const lines = storyLines(i);
    expect(lines).toHaveLength(1);
    expect(lines[0].sentence).toBe("LA 1 checked the papers for Notary, EDST, Entry of PPSR and Mortgage");
    expect(lines[0].txns.map((t) => t.code)).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
  });

  it("a part-save of the papers is not a Story line (it stays in the Full log); a different minute is a new line", () => {
    const i = input(ALL4(), [
      ev("c1", "checklist_saved", "2026-11-10 07:00", "LA 1 updated the Notary papers.", { txnId: "t-NOTARY" }),
      ev("c2", "checklist_saved", "2026-11-10 07:00", "LA 1 checked all the Notary papers.", { txnId: "t-NOTARY" }),
      ev("c3", "checklist_saved", "2026-11-10 07:05", "LA 1 checked all the EDST papers.", { txnId: "t-EDST" }),
    ]);
    expect(storyLines(i).map((l) => l.sentence)).toEqual(["LA 1 checked the papers for EDST", "LA 1 checked the papers for Notary"]);
  });

  it("no sentence twice: the same record and its audit row say it once", () => {
    const t = txn("NOTARY", { status: "ASSIGNED", assignments: [assignment({ status: "PENDING_ACCEPTANCE", decidedAt: null })] });
    const i = input([t], [
      ev("s1", "assigned_to_dp", "2026-11-10 09:00", "LA 1 sent the Notary to DP 1.", { txnId: t.id }),
      ev("x1", "labels_printed", "2026-11-10 09:01", "LA 1 printed 5 labels."),
      ev("x2", "labels_printed", "2026-11-10 09:01", "LA 1 printed 5 labels."),
    ]);
    const s = storyLines(i).map((l) => l.sentence);
    expect(s).toEqual(["LA 1 printed 5 labels", "LA 1 sent Notary to DP 1"]);
    expect(new Set(s).size).toBe(s.length);
  });

  it("returns, holds and problems are flagged, with the reason once and the Round", () => {
    const back = assignment({ id: "a1", status: "WITHDRAWN", returnedAt: at("2026-11-10 12:00"), closedAt: at("2026-11-10 12:00"), findings: "Missing paper: Promissory Note. The ID copy is unreadable", papersHandedAt: at("2026-11-10 12:00"), papersReceivedAt: at("2026-11-10 13:00"), papersReceivedBy: "LA 1" });
    const t = txn("NOTARY", {
      status: "RETURNED", statusSince: at("2026-11-10 12:00"), assignments: [back],
      holds: [hold({ resumedAt: at("2026-11-10 10:30"), resumedBy: "DP 1", resumeNote: "Signed" })], problems: [problem({ resolvedAt: at("2026-11-10 11:30"), resolvedBy: "DP 1" })],
    });
    const st = story(input([t]), at("2026-11-10 14:00"));
    const s = st.lines.map((l) => [l.flag, l.sentence]);
    expect(s).toEqual([
      [null, "LA 1 received the Notary papers back from DP 1"],
      // Same instant as the return: the hand-over was recorded with it, so it reads after it (newest first).
      [null, "DP 1 handed the Notary papers back to LA 1"],
      ["return", "DP 1 returned Notary: Missing paper: Promissory Note. The ID copy is unreadable (Round 1)"],
      [null, "DP 1 solved the problem on Notary: LTO system down"],
      ["problem", "DP 1 raised a problem on Notary: LTO system down"],
      [null, "DP 1 resumed Notary: Signed"],
      ["hold", "DP 1 put Notary on hold: Waiting for the client's papers (Borrower to sign)"],
      [null, "DP 1 accepted Notary"],
      [null, "LA 1 sent Notary to DP 1"],
    ]);
    expect(st.counts).toMatchObject({ return: 1, hold: 1, problem: 1, decline: 0 });
    // The reason is said once in the Story.
    expect(st.lines.filter((l) => l.sentence.includes("The ID copy is unreadable"))).toHaveLength(1);
  });

  it("a decline is flagged; the next send is Round 2", () => {
    const t = txn("NOTARY", {
      status: "ASSIGNED",
      assignments: [
        assignment({ id: "a1", status: "DECLINED", decidedAt: at("2026-11-10 09:10"), findings: "No capacity: Full this week" }),
        assignment({ id: "a2", status: "PENDING_ACCEPTANCE", endorsedAt: at("2026-11-10 10:00"), decidedAt: null, dp: { id: "u-g", name: "Grace Tan" } }),
      ],
    });
    const s = storyLines(input([t])).map((l) => [l.flag, l.sentence]);
    expect(s).toEqual([
      [null, "LA 1 sent Notary to Grace Tan again (Round 2)"],
      ["decline", "DP 1 declined Notary: No capacity: Full this week (Round 1)"],
      [null, "LA 1 sent Notary to DP 1"],
    ]);
  });

  it("missing paper asked and received", () => {
    const i = input(ALL4(), [
      ev("m1", "exception_raised", "2026-11-10 08:00", "LA 1 asked for a missing paper for Notary: Promissory Note.", { txnId: "t-NOTARY" }),
      ev("m2", "exception_resolved", "2026-11-10 09:00", "The missing paper was ticked, so the reminder closed.", { by: "System", txnId: "t-NOTARY" }),
    ]);
    expect(storyLines(i).map((l) => [l.flag, l.sentence])).toEqual([
      [null, "Missing paper received for Notary"],
      ["missing", "LA 1 asked for a missing paper for Notary: Promissory Note"],
    ]);
  });

  it("nothing recorded: no lines", () => {
    expect(storyLines(input([]))).toEqual([]);
  });
});

describe("Where it is now", () => {
  it("four transactions in the same place are one line; the name is said once (With LA 1)", () => {
    const st = story(input(ALL4()), at("2026-11-10 07:24"));
    expect(st.where).toHaveLength(1);
    expect(st.where[0]).toMatchObject({ label: "All 4 transactions", kind: "now", text: "With LA 1", forText: "7 h 30 min" });
    expect(st.where[0].codes).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
  });
  it("a transaction in another place or state gets its own line", () => {
    const ts = ALL4();
    ts[0] = txn("NOTARY", { status: "IN_PROCESS", statusSince: at("2026-11-10 09:30"), readyAt: at("2026-11-10 08:00"), assignments: [assignment()], holds: [hold()] });
    const st = story(input(ts), at("2026-11-10 12:00"));
    expect(st.where.map((w) => [w.label, w.kind, w.text])).toEqual([
      ["Notary", "hold", "With DP 1 · On hold: waiting for the client's papers"],
      ["EDST, Entry of PPSR and Mortgage", "now", "With LA 1"],
    ]);
  });
});

describe("By document: milestones", () => {
  const states = (c: { milestones: { key: string; state: string }[] }) => c.milestones.map((m) => `${m.key}:${m.state}`);

  it("in process: opened and papers checked are done, with the processor is now, the rest later", () => {
    const t = txn("NOTARY", { status: "IN_PROCESS", statusSince: at("2026-11-10 09:30"), readyAt: at("2026-11-10 08:00"), assignments: [assignment()] });
    const [c] = story(input([t]), at("2026-11-10 12:00")).columns;
    expect(states(c)).toEqual(["opened:done", "checked:done", "processor:now", "back:later", "done:later"]);
    expect(c.milestones[1]).toMatchObject({ at: at("2026-11-10 08:00"), who: "LA 1" });
    expect(c.milestones[1].durationMs).toBe(at("2026-11-10 08:00").getTime() - at("2026-11-09 23:54").getTime());
    expect(c.milestones[2]).toMatchObject({ label: "With the processor (DP 1)", since: at("2026-11-10 09:30"), forText: "2 h 30 min" });
  });

  it("with stages: In process is its own milestone, with the stage now", () => {
    const stages = [
      { id: "s1", name: "Check and verify", status: "DONE" as const, startedAt: at("2026-11-10 09:40"), finishedAt: at("2026-11-10 10:00"), by: "DP 1", summary: "", migrated: false },
      { id: "s2", name: "Send to the notary", status: "STARTED" as const, startedAt: at("2026-11-10 10:00"), finishedAt: null, by: "DP 1", summary: "", migrated: false },
    ];
    const t = txn("NOTARY", { status: "IN_PROCESS", statusSince: at("2026-11-10 09:30"), readyAt: at("2026-11-10 08:00"), assignments: [assignment({ stages })] });
    const [c] = story(input([t]), at("2026-11-10 12:00")).columns;
    expect(states(c)).toEqual(["opened:done", "checked:done", "processor:done", "process:now", "back:later", "done:later"]);
    expect(c.milestones[3].sub).toBe("Stage 2 of 2: Send to the notary");
  });

  it("a return marks the processor milestone (with its Round) and makes it the one to do now; a hold marks where it happened", () => {
    const t = txn("NOTARY", {
      status: "RETURNED", statusSince: at("2026-11-10 12:00"), readyAt: at("2026-11-10 08:00"),
      assignments: [assignment({ status: "WITHDRAWN", returnedAt: at("2026-11-10 12:00"), closedAt: at("2026-11-10 12:00"), findings: "Missing paper: Promissory Note" })],
      holds: [hold({ raisedAt: at("2026-11-10 10:00"), resumedAt: at("2026-11-10 10:30"), resumedBy: "DP 1" })],
    });
    const [c] = story(input([t]), at("2026-11-10 13:00")).columns;
    expect(states(c)).toEqual(["opened:done", "checked:done", "processor:now", "back:later", "done:later"]);
    expect(c.milestones[2].markers.map((m) => [m.kind, m.text, m.round])).toEqual([
      ["return", "Missing paper: Promissory Note", 1],
      ["hold", "Waiting for the client's papers", null],
    ]);
    expect(c).toMatchObject({ kind: "returned", attention: true });
  });

  it("finished: every milestone is done; the processor sends it back to a named LA", () => {
    const t = txn("NOTARY", {
      status: "COMPLETED", statusSince: at("2026-11-11 09:00"), completedAt: at("2026-11-11 09:00"), readyAt: at("2026-11-10 08:00"),
      assignments: [assignment({ status: "CLOSED", processedAt: at("2026-11-10 15:00"), forwardedAt: at("2026-11-10 16:00"), closedAt: at("2026-11-11 09:00"), receivingLa: { id: "u2", name: "LA 2" } })],
    });
    const [c] = story(input([t]), at("2026-11-11 10:00")).columns;
    expect(c.milestones.every((m) => m.state === "done")).toBe(true);
    expect(c.milestones.find((m) => m.key === "back")).toMatchObject({ at: at("2026-11-10 16:00"), who: "DP 1", sub: "To LA 2" });
    expect(c.milestones.find((m) => m.key === "done")).toMatchObject({ at: at("2026-11-11 09:00"), who: "LA 2" });
    expect(c.attention).toBe(false);
  });

  it("EDST (no processor): opened, papers checked, done", () => {
    const t = txn("EDST", { status: "READY", statusSince: at("2026-11-10 08:00"), readyAt: at("2026-11-10 08:00") });
    const [c] = story(input([t]), at("2026-11-10 09:00")).columns;
    expect(states(c)).toEqual(["opened:done", "checked:done", "done:now"]);
    expect(c.milestones[2].sub).toBe("Entered in EDST");
  });

  it("a cancelled transaction has no column", () => {
    expect(story(input([txn("NOTARY", { status: "CANCELLED" })])).columns).toEqual([]);
  });
});
