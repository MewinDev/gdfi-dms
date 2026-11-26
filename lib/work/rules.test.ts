import { describe, expect, it } from "vitest";
import { addWorkingDays, DEFAULT_WORKING_WEEKDAYS, daysFor } from "@/lib/calendar/core";
import { isAway, outcomeText, poolArrival, poolSinceText, poolTone, roundDue, roundResult, waitingDays, waitingText } from "./rules";

/** D-046: the six worked examples the user checked (Mon-Sat; Nov 2026 Mon 23 ... Mon 30) and the pool colours. */
const plain = daysFor({ workingWeekdays: DEFAULT_WORKING_WEEKDAYS, entries: [] }, null);

describe("the six worked examples (D-046)", () => {
  it("1. accepted the same day: waiting 0; LA target 1 -> due Tue 24; forwarded Tue 24: used 1, on time", () => {
    expect(waitingDays("2026-11-23", "2026-11-23", plain)).toBe(0);
    expect(roundDue("2026-11-23", 1, plain)).toBe("2026-11-24");
    expect(roundResult({ acceptedDay: "2026-11-23", endDay: "2026-11-24", dueDate: "2026-11-24", pausedDays: 0, outcome: "FORWARDED", days: plain })).toEqual({ used: 1, late: false, lateBy: 0 });
  });

  it("2. waits 2 days in the pool (Thu 26 -> Sat 28): waiting 2, not counted; due Mon 30", () => {
    expect(waitingDays("2026-11-26", "2026-11-28", plain)).toBe(2);
    expect(roundDue("2026-11-28", 1, plain)).toBe("2026-11-30");
  });

  it("3. accept -> pausing hold -> resume -> forward: due Sat 28 + 2 paused = Tue 1; used 6 - 2 = 4, on time", () => {
    const due = addWorkingDays(roundDue("2026-11-23", 5, plain), 2, plain);
    expect(due).toBe("2026-12-01");
    expect(roundResult({ acceptedDay: "2026-11-23", endDay: "2026-11-30", dueDate: due, pausedDays: 2, outcome: "FORWARDED", days: plain })).toEqual({ used: 4, late: false, lateBy: 0 });
  });

  it("4. returned and accepted again: each round on its own, a fresh full target for round 2", () => {
    // DP round 1: accepted Tue 24, returned Thu 26.
    expect(roundResult({ acceptedDay: "2026-11-24", endDay: "2026-11-26", dueDate: "2026-11-30", pausedDays: 0, outcome: "RETURNED", days: plain }).used).toBe(2);
    // The LA: the return waits Thu 26 -> Fri 27; accepted, forwarded Sat 28.
    expect(waitingDays("2026-11-26", "2026-11-27", plain)).toBe(1);
    expect(roundResult({ acceptedDay: "2026-11-27", endDay: "2026-11-28", dueDate: "2026-11-30", pausedDays: 0, outcome: "FORWARDED", days: plain }).used).toBe(1);
    // DP round 2: waits Sat 28 -> Mon 30; a fresh 5-day target -> due Sat 5 Dec.
    expect(waitingDays("2026-11-28", "2026-11-30", plain)).toBe(1);
    expect(roundDue("2026-11-30", 5, plain)).toBe("2026-12-05");
  });

  it("6. a round closed by a move is 'Moved (away)', never late, even after its due date", () => {
    expect(roundResult({ acceptedDay: "2026-11-23", endDay: "2026-11-30", dueDate: "2026-11-24", pausedDays: 0, outcome: "MOVED_AWAY", days: plain })).toMatchObject({ late: false, lateBy: 0 });
    expect(roundResult({ acceptedDay: "2026-11-23", endDay: "2026-11-30", dueDate: "2026-11-24", pausedDays: 0, outcome: "FORWARDED", days: plain })).toMatchObject({ late: true, lateBy: 5 });
    expect(outcomeText("MOVED_AWAY")).toBe("Moved (away)");
  });
});

describe("pool colours and Away (D-046)", () => {
  it("green the day it arrives, amber after 1 working day, red after 2 (settings)", () => {
    expect(poolTone(0, 1, 2)).toBe("green");
    expect(poolTone(1, 1, 2)).toBe("amber");
    expect(poolTone(2, 1, 2)).toBe("red");
    expect(poolTone(2, 2, 3)).toBe("amber");
    expect(waitingText(0)).toBe("Arrived today");
    expect(waitingText(2)).toBe("Waiting 2 working days");
  });

  it("D-060: a pool item never arrives before the loan's release; the pool wording", () => {
    const released = new Date("2026-11-19T00:00:00Z");
    expect(poolArrival(new Date("2026-11-16T01:00:00Z"), released).toISOString()).toBe("2026-11-19T00:00:00.000Z"); // the kit's "4 working days ago"
    expect(poolArrival(new Date("2026-11-20T03:00:00Z"), released).toISOString()).toBe("2026-11-20T03:00:00.000Z"); // later: kept
    expect(poolArrival(new Date("2026-11-20T03:00:00Z"), null).toISOString()).toBe("2026-11-20T03:00:00.000Z"); // no release date known
    expect(poolSinceText("Nov 24", 2)).toBe("In the branch pool since Nov 24 · 2 working days");
    expect(poolSinceText("Nov 26", 1)).toBe("In the branch pool since Nov 26 · 1 working day");
    expect(poolSinceText("Nov 26", 0)).toBe("In the branch pool since Nov 26 · less than a day");
  });

  it("away from and to, both days included", () => {
    const u = { awayFrom: "2026-11-24", awayTo: "2026-11-26" };
    expect([isAway(u, "2026-11-23"), isAway(u, "2026-11-24"), isAway(u, "2026-11-26"), isAway(u, "2026-11-27")]).toEqual([false, true, true, false]);
    expect(isAway({ awayFrom: null, awayTo: null }, "2026-11-24")).toBe(false);
  });
});
