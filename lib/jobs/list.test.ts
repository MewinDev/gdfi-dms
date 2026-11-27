import { describe, expect, it } from "vitest";
import { filterJobs, fundsKeyOf, jobListUrl, parseJobParams, shownStatus, sortJobs, timeLeft, toggleStatus } from "./list";

type R = Parameters<typeof filterJobs>[0][number];
const row = (p: Partial<R>): R => ({
  tab: "process", borrower: "Ana Reyes", pn: "GD1652026901001", cin: "CIN-1", branch: "Angono", typeCode: "NOTARY", funds: "NOT_NEEDED",
  problem: null, hold: null, daysLeft: 3, tat: null, dueDate: "2026-12-01", endorsedAt: new Date("2026-11-20"), ...p,
});

describe("D-064 Jobs list: the address", () => {
  it("reads and writes only what differs from the default", () => {
    const p = parseJobParams({ status: "process,hold,nonsense", q: " ana ", funds: "liquidate", late: "1", sort: "borrower", dir: "desc", type: "EDST" });
    expect(p).toEqual({ status: ["process", "hold"], q: "ana", type: "EDST", funds: "liquidate", late: true, sort: "borrower", dir: "desc" });
    expect(jobListUrl(p)).toBe("/jobs?status=process%2Chold&q=ana&type=EDST&funds=liquidate&late=1&sort=borrower&dir=desc");
    expect(jobListUrl(parseJobParams({}))).toBe("/jobs");
  });
  it("the default chips (To review, In process) show as chosen; choosing them again is the clean address", () => {
    expect(shownStatus([])).toEqual(["review", "process"]);
    expect(shownStatus(["hold"])).toEqual(["review", "process", "hold"]);
    expect(toggleStatus([], "review")).toEqual(["process"]);
    expect(toggleStatus([], "done")).toEqual(["review", "process", "done"]);
    expect(toggleStatus(["process"], "review")).toEqual([]); // back to the default
    expect(toggleStatus([], "problems")).toEqual(["problems"]);
  });
});

describe("D-064 Time left chip", () => {
  const tat = (text: string, state = "processing") => ({ state, text }) as never;
  it("late, due today, days left, Day N of M, paused, done", () => {
    expect(timeLeft({ tab: "process", tat: tat("+3 days late", "overdue"), daysLeft: -3, amberWithin: 1 })).toEqual({ text: "Late by 3 days", tone: "bad", kind: "late" });
    expect(timeLeft({ tab: "process", tat: null, daysLeft: -1, amberWithin: 1 })?.text).toBe("Late by 1 day");
    expect(timeLeft({ tab: "review", tat: null, daysLeft: 0, amberWithin: 1 })).toEqual({ text: "Due today", tone: "act", kind: "today" });
    expect(timeLeft({ tab: "process", tat: null, daysLeft: 1, amberWithin: 1 })).toEqual({ text: "1 day left", tone: "act", kind: "left" });
    expect(timeLeft({ tab: "process", tat: tat("Processing · Day 1 of 5"), daysLeft: 4, amberWithin: 1 })).toEqual({ text: "Day 1 of 5", tone: "ok", kind: "day" });
    expect(timeLeft({ tab: "process", tat: null, daysLeft: 6, amberWithin: 1 })?.text).toBe("6 days left");
    expect(timeLeft({ tab: "process", tat: tat("Paused · Borrower", "paused"), daysLeft: -2, amberWithin: 1 })?.text).toBe("Paused");
    expect(timeLeft({ tab: "done", tat: tat("Done · 1 day late", "done"), daysLeft: null, amberWithin: 1 })).toEqual({ text: "Done · 1 day late", tone: "bad", kind: "done" });
    expect(timeLeft({ tab: "returned", tat: null, daysLeft: 1, amberWithin: 1 })).toBeNull();
  });
});

describe("D-064 filters and counts", () => {
  const all = [
    row({ borrower: "Ana Reyes", tab: "review", daysLeft: 0 }),
    row({ borrower: "Ben Cruz", pn: "GD1652026901002", tab: "process", daysLeft: -2, typeCode: "MORTGAGE", funds: "NEEDED", dueDate: "2026-11-24" }),
    row({ borrower: "Carla Diaz", pn: "GD1652026901003", cin: "CIN-77", tab: "process", hold: { id: "h", reason: "Borrower", days: 1 }, funds: "FUNDED", liquidating: true }),
    row({ borrower: "Dan Lopez", tab: "forwarded", funds: "SETTLED" }),
    row({ borrower: "Ella Santos", tab: "done" }),
  ];
  const run = (sp: Record<string, string>) => filterJobs(all, parseJobParams(sp));
  it("no chip: To review and In process; Forwarded and Done only when chosen", () => {
    expect(run({}).rows.map((r) => r.borrower)).toEqual(["Ben Cruz", "Ana Reyes", "Carla Diaz"]); // late first, then the soonest due
    expect(run({ status: "forwarded,done" }).rows.map((r) => r.borrower)).toEqual(["Dan Lopez", "Ella Santos"]);
    expect(run({}).counts.status).toEqual({ review: 1, process: 2, forwarded: 1, done: 1, problems: 0, hold: 1 });
  });
  it("Problems / On hold narrow the open work; the search: name, part of the PN, the CIN", () => {
    expect(run({ status: "hold" }).rows.map((r) => r.borrower)).toEqual(["Carla Diaz"]);
    expect(run({ q: "cruz" }).rows.map((r) => r.borrower)).toEqual(["Ben Cruz"]);
    expect(run({ q: "901-003" }).rows.map((r) => r.borrower)).toEqual(["Carla Diaz"]);
    expect(run({ q: "cin-77" }).rows.map((r) => r.borrower)).toEqual(["Carla Diaz"]);
  });
  it("Transaction, Funds and Late only apply at once, with counts", () => {
    expect(run({ type: "MORTGAGE" }).rows.map((r) => r.borrower)).toEqual(["Ben Cruz"]);
    expect(run({ funds: "needs" }).rows.map((r) => r.borrower)).toEqual(["Ben Cruz"]);
    expect(run({ funds: "liquidate" }).rows.map((r) => r.borrower)).toEqual(["Carla Diaz"]);
    expect(run({ late: "1" }).rows.map((r) => r.borrower)).toEqual(["Ben Cruz"]);
    const c = run({}).counts;
    expect(c.type).toEqual({ NOTARY: 2, MORTGAGE: 1 });
    expect(c.funds).toEqual({ needs: 1, requested: 0, released: 0, liquidate: 1, liquidated: 0 });
    expect(c.late).toBe(1);
  });
  it("the funds filter of a job", () => {
    expect(fundsKeyOf({ funds: "FUNDED" })).toBe("released");
    expect(fundsKeyOf({ funds: "FUNDED", liquidating: true })).toBe("liquidate");
    expect(fundsKeyOf({ funds: "SETTLED" })).toBe("liquidated");
    expect(fundsKeyOf({ funds: "NOT_NEEDED" })).toBeNull();
  });
  it("sort by borrower or branch, either way", () => {
    expect(sortJobs(all, { sort: "borrower", dir: "desc" }).map((r) => r.borrower)[0]).toBe("Ella Santos");
    expect(sortJobs(all, { sort: "borrower", dir: "asc" }).map((r) => r.borrower)[0]).toBe("Ana Reyes");
  });
});
