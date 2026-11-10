import { describe, expect, it } from "vitest";
import { blockerOf, blockerOfStep, coveredOpenKinds, getNextSteps, nowStep, type NextStepsInput } from "./next-steps";
import { txnStatus } from "@/lib/ui/txn-status";

const base: NextStepsInput = {
  status: "FOR_CHECKLIST", requiresDp: true, hold: false, problems: 0, sentBack: null, papersBack: null, missing: false,
  required: { done: 0, total: 5 },
};
const steps = (p: Partial<NextStepsInput>) => getNextSteps({ ...base, ...p });
const shape = (p: Partial<NextStepsInput>) => steps(p).map((s) => `${s.kind}:${s.state}`);
const returned = { kind: "returned" as const, papers: { lineIds: ["l1"], remaining: 1 } };

describe("getNextSteps: one ordered list of what to do on a transaction", () => {
  it("normal ticking: tick now, send next", () => {
    expect(shape({ required: { done: 4, total: 5 } })).toEqual(["tick:now", "send:next"]);
  });

  it("ready to send: the papers are done, Send is now", () => {
    expect(shape({ status: "READY", required: { done: 5, total: 5 } })).toEqual(["tick:done", "send:now"]);
  });

  it("missing paper only: the request comes before ticking", () => {
    expect(shape({ missing: true, required: { done: 4, total: 5 } })).toEqual(["missing:now", "tick:next", "send:next"]);
  });

  it("returned with papers handed back: confirm first, then fix, then tick and send", () => {
    const s = steps({ status: "RETURNED", sentBack: returned, papersBack: { waiting: 7, confirmed: false }, required: { done: 4, total: 5 } });
    expect(s.map((x) => `${x.kind}:${x.state}`)).toEqual(["confirm:now", "fix:next", "tick:next", "send:next"]);
    expect(s.map((x) => x.n)).toEqual([1, 2, 3, 4]);
  });

  it("after All received, step 2 (fix) is now and step 1 is done", () => {
    expect(shape({ status: "RETURNED", sentBack: returned, papersBack: { waiting: 0, confirmed: true }, required: { done: 4, total: 5 } }))
      .toEqual(["confirm:done", "fix:now", "tick:next", "send:next"]);
  });

  it("the returned paper ticked again: fix done, Send now", () => {
    expect(shape({ status: "RETURNED", sentBack: { kind: "returned", papers: { lineIds: ["l1"], remaining: 0 } }, papersBack: { waiting: 0, confirmed: true }, required: { done: 5, total: 5 } }))
      .toEqual(["confirm:done", "fix:done", "tick:done", "send:now"]);
  });

  it("declined (nothing named): one step Fix and send again, no separate Send", () => {
    expect(shape({ status: "RETURNED", sentBack: { kind: "declined", papers: null }, required: { done: 5, total: 5 } })).toEqual(["resend:now", "tick:done"]);
  });

  it("on hold + returned: the hold is now, everything else waits", () => {
    expect(shape({ status: "RETURNED", hold: true, sentBack: returned, papersBack: { waiting: 2, confirmed: false } }))
      .toEqual(["hold:now", "confirm:next", "fix:next", "tick:next", "send:next"]);
  });

  it("problem: after a hold, before everything else", () => {
    expect(shape({ problems: 1, missing: true })).toEqual(["problem:now", "missing:next", "tick:next", "send:next"]);
    expect(shape({ hold: true, problems: 2 }).slice(0, 2)).toEqual(["hold:now", "problem:next"]);
  });

  it("work without a processor ends with Finish (EDST or Mark as done), not Send", () => {
    expect(shape({ requiresDp: false, status: "READY", required: { done: 2, total: 2 } })).toEqual(["tick:done", "finish:now"]);
  });

  it("sent to the DP: only what blocks it, or nothing", () => {
    expect(shape({ status: "IN_PROCESS", required: { done: 5, total: 5 } })).toEqual([]);
    expect(shape({ status: "IN_PROCESS", hold: true })).toEqual(["hold:now"]);
    expect(shape({ status: "ASSIGNED", problems: 1 })).toEqual(["problem:now"]);
    expect(shape({ status: "COMPLETED", missing: true })).toEqual([]);
  });

  it("the priority order holds in every combination, exactly one step is now, and nothing repeats", () => {
    const order = ["hold", "problem", "confirm", "fix", "resend", "missing", "tick", "send", "finish"];
    const bools = [false, true];
    for (const hold of bools) for (const problem of bools) for (const sb of [null, "named", "none"] as const) for (const pb of [null, false, true]) for (const missing of bools) for (const done of [0, 3]) {
      const s = steps({
        status: sb ? "RETURNED" : "READY", hold, problems: problem ? 1 : 0, missing,
        sentBack: sb === "named" ? returned : sb === "none" ? { kind: "declined", papers: null } : null,
        papersBack: pb === null || !sb ? null : { waiting: pb ? 0 : 3, confirmed: pb },
        required: { done, total: 3 },
      });
      const kinds = s.map((x) => x.kind);
      expect(new Set(kinds).size).toBe(kinds.length); // nothing repeats
      expect([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(kinds); // in priority order
      expect(s.filter((x) => x.state === "now")).toHaveLength(1);
      const now = nowStep(s)!;
      // Everything before "now" is done; nothing after it is done unless it was done on its own.
      expect(s.slice(0, s.indexOf(now)).every((x) => x.state === "done")).toBe(true);
      expect(s.slice(s.indexOf(now) + 1).every((x) => x.state !== "now")).toBe(true);
      // The first that applies wins.
      const first = hold ? "hold" : problem ? "problem" : null;
      if (first) expect(now.kind).toBe(first);
    }
  });
});

describe("The status word, the card and the Open items card never disagree", () => {
  it("the row's word is the blocker of the step that is now", () => {
    const cases: Partial<NextStepsInput>[] = [
      { hold: true, problems: 1, missing: true },
      { problems: 1, missing: true },
      { status: "RETURNED", sentBack: returned, papersBack: { waiting: 1, confirmed: false }, missing: true },
      { missing: true },
    ];
    for (const c of cases) {
      const i = { ...base, ...c };
      const now = nowStep(getNextSteps(i))!;
      const row = txnStatus({
        code: "NOTARY", requiresDp: true, status: i.status, requiredDone: 0, requiredTotal: 5, tickedAny: false, tat: null,
        sentBack: i.sentBack?.kind ?? null, problem: i.problems ? { reason: "LTO down", days: 1 } : null,
        hold: i.hold ? { reason: "Other", days: 1 } : null, missingPapers: i.missing ? 1 : 0,
      });
      expect(row.pill.kind).toBe(blockerOfStep(now.kind));
    }
  });

  it("blockerOf: On hold, then Problem, then Returned, then Missing paper", () => {
    expect(blockerOf({ hold: true, problem: true, returned: true, missing: true })).toBe("hold");
    expect(blockerOf({ hold: false, problem: true, returned: true, missing: true })).toBe("problem");
    expect(blockerOf({ hold: false, problem: false, returned: true, missing: true })).toBe("returned");
    expect(blockerOf({ hold: false, problem: false, returned: false, missing: true })).toBe("missing");
    expect(blockerOf({ hold: false, problem: false, returned: false, missing: false })).toBeNull();
  });

  it("Open items leaves out what the card says for this transaction", () => {
    expect([...coveredOpenKinds(steps({ status: "RETURNED", sentBack: returned }))].sort()).toEqual(["missing", "returned"]);
    expect([...coveredOpenKinds(steps({ hold: true, problems: 1 }))].sort()).toEqual(["hold", "problem"]);
    expect([...coveredOpenKinds(steps({ required: { done: 1, total: 5 } }))]).toEqual([]);
  });
});
