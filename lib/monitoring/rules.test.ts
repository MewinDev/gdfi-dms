import { describe, expect, it } from "vitest";
import { AVAILABILITY, PRESETS, availability, avg, buckets, businessDayCounter, countTone, daysText, leaveText, onLeaveToday, parseRange, presetOf, presetRange, rangeLabel, rangeNote, rangeParams, rangeSummary, showSubtotal, usageBar, weekStart } from "./rules";
import { businessDaysBetween } from "@/lib/time";
import { ADVISORY_STALE_HOURS, advisoryWarning, isStale, mayResolveAdvisory, parseStartedAt, STALE_PROMPT } from "./advisories";

const TODAY = "2026-11-09"; // a Monday

describe("availability", () => {
  it("is free places over capacity, rounded, with the numbers", () => {
    expect(availability(10, 4)).toMatchObject({ pct: 60, status: "AVAILABLE", text: "60% · 4 of 10 in use" });
    expect(availability(10, 6)).toMatchObject({ pct: 40, status: "AVAILABLE" }); // 40% is Available
    expect(availability(10, 7)).toMatchObject({ pct: 30, status: "BUSY" });
    expect(availability(10, 9)).toMatchObject({ pct: 10, status: "BUSY" });
    expect(availability(10, 10)).toMatchObject({ pct: 0, status: "FULL", text: "0% · 10 of 10 in use" });
    expect(availability(10, 16)).toMatchObject({ pct: 0, status: "FULL", text: "0% · 16 of 10 in use" }); // never below 0
    expect(availability(3, 1)).toMatchObject({ pct: 67, status: "AVAILABLE" });
  });
  it("never rounds one free place down to Full", () => {
    expect(availability(200, 199)).toMatchObject({ pct: 1, status: "BUSY" });
  });
  it("on leave is 0% and its own status", () => {
    expect(availability(10, 0, true)).toMatchObject({ pct: 0, status: "ON_LEAVE" });
  });
  it("keeps the thresholds in one constant", () => {
    expect(AVAILABILITY).toMatchObject({ defaultCapacity: 10, availableFrom: 40 });
  });
  it("on leave until a day: the leave ends by itself after that day", () => {
    expect(onLeaveToday({ dpOnLeave: true, dpLeaveUntil: null }, TODAY)).toBe(true);
    expect(onLeaveToday({ dpOnLeave: true, dpLeaveUntil: TODAY }, TODAY)).toBe(true);
    expect(onLeaveToday({ dpOnLeave: true, dpLeaveUntil: "2026-11-08" }, TODAY)).toBe(false);
    expect(onLeaveToday({ dpOnLeave: false, dpLeaveUntil: "2026-12-01" }, TODAY)).toBe(false);
    expect(leaveText("2026-11-14", (d) => d)).toBe("On leave until 2026-11-14");
    expect(leaveText(null, (d) => d)).toBe("On leave");
  });
});

describe("dates filter", () => {
  it("presets, in Philippine dates", () => {
    expect(parseRange({ range: "today" }, TODAY)).toMatchObject({ from: TODAY, to: TODAY, label: "9 Nov to 9 Nov 2026" });
    expect(parseRange({ range: "yesterday" }, TODAY)).toMatchObject({ from: "2026-11-08", to: "2026-11-08" });
    expect(parseRange({ range: "7d" }, TODAY)).toMatchObject({ from: "2026-11-03", to: TODAY, days: 7 });
    expect(parseRange({}, TODAY)).toMatchObject({ preset: "30d", from: "2026-10-11", to: TODAY, days: 30 }); // default
    expect(parseRange({ range: "month" }, TODAY)).toMatchObject({ from: "2026-11-01", to: TODAY });
    expect(parseRange({ range: "lastmonth" }, TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(parseRange({ range: "lastmonth" }, "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31", label: "1 Dec to 31 Dec 2025" });
  });
  it("custom: any exact days, both included; no future; To not before From", () => {
    expect(parseRange({ range: "custom", from: "2026-11-02", to: "2026-11-06" }, TODAY)).toMatchObject({ preset: "custom", from: "2026-11-02", to: "2026-11-06", days: 5, error: null });
    expect(parseRange({ from: "2026-11-09", to: "2026-11-09" }, TODAY)).toMatchObject({ preset: "custom", label: "9 Nov to 9 Nov 2026" });
    expect(parseRange({ range: "custom", from: "2026-11-02", to: "2026-11-10" }, TODAY)).toMatchObject({ preset: "30d", error: "Dates cannot be in the future." });
    expect(parseRange({ range: "custom", from: "2026-11-06", to: "2026-11-02" }, TODAY).error).toBe("\"To\" cannot be before \"From\".");
    expect(parseRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, TODAY).error).toBe("Pick both the From and the To date.");
  });
  it("labels across years", () => {
    expect(rangeLabel("2025-12-28", "2026-01-03")).toBe("28 Dec 2025 to 3 Jan 2026");
  });
  it("days up to 92, weeks (Monday to Sunday, cut to the range) above", () => {
    expect(buckets("2026-11-01", "2026-11-09")).toMatchObject({ unit: "day" });
    expect(buckets("2026-11-01", "2026-11-09").rows).toHaveLength(9);
    expect(buckets("2026-08-10", "2026-11-09").rows).toHaveLength(92);
    const w = buckets("2026-08-09", "2026-11-09");
    expect(w.unit).toBe("week");
    expect(w.rows[0]).toMatchObject({ key: "2026-08-03", from: "2026-08-09", to: "2026-08-09" });
    expect(w.rows.at(-1)).toMatchObject({ key: "2026-11-09", from: "2026-11-09", to: "2026-11-09" });
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });
});

describe("business-day counter", () => {
  const holidays = new Set(["2026-11-30"]);
  const d = (s: string) => new Date(`${s}T10:00:00+08:00`);
  it("matches the TAT calendar (weekends and holidays skipped; same day is 0)", () => {
    const bd = businessDayCounter(holidays, "2026-11-01", "2026-12-31");
    for (const [a, b] of [["2026-11-06", "2026-11-09"], ["2026-11-27", "2026-12-01"], ["2026-11-09", "2026-11-09"], ["2026-11-02", "2026-11-20"]]) {
      expect(bd(d(a), d(b)), `${a} to ${b}`).toBe(businessDaysBetween(a, b, holidays));
    }
    expect(bd(d("2026-11-06"), d("2026-11-09"))).toBe(1); // Friday to Monday
    expect(bd(d("2026-11-27"), d("2026-12-01"))).toBe(1); // Monday 30 Nov is a holiday
  });
  it("works outside the precomputed range too", () => {
    const bd = businessDayCounter(holidays, "2026-11-10", "2026-11-12");
    expect(bd(d("2026-11-02"), d("2026-11-20"))).toBe(businessDaysBetween("2026-11-02", "2026-11-20", holidays));
  });
  it("averages to one decimal with the words", () => {
    expect(avg([1, 2, 2])).toBe(1.7);
    expect(avg([])).toBeNull();
    expect(daysText(1)).toBe("1 day");
    expect(daysText(2.5)).toBe("2.5 days");
    expect(daysText(null)).toBe("-");
  });
});

describe("LTO advisories (words and rules)", () => {
  const now = new Date("2026-11-09T12:00:00+08:00");
  const a = { officeName: "LTO Quezon City District Office", type: "SYSTEM_DOWN" as const, filedByLabel: "DP 1", filedById: "u1", startedAt: new Date(now.getTime() - 2 * 3_600_000), resolvedAt: null };
  it("warning line", () => {
    expect(advisoryWarning(a, now)).toBe("LTO Quezon City District Office: System down, reported by DP 1, 2 h ago");
  });
  it("prompts after 24 hours", () => {
    expect(isStale(a, now)).toBe(false);
    expect(isStale({ ...a, startedAt: new Date(now.getTime() - (ADVISORY_STALE_HOURS + 1) * 3_600_000) }, now)).toBe(true);
    expect(isStale({ ...a, startedAt: new Date(0), resolvedAt: now }, now)).toBe(false);
    expect(STALE_PROMPT).toBe("Still active? Please confirm");
  });
  it("the filer and ltoreports:manage resolve; nobody resolves twice", () => {
    expect(mayResolveAdvisory(a, { id: "u1", permissions: new Set() })).toBe(true);
    expect(mayResolveAdvisory(a, { id: "u2", permissions: new Set() })).toBe(false);
    expect(mayResolveAdvisory(a, { id: "u2", permissions: new Set(["ltoreports:manage"]) })).toBe(true);
    expect(mayResolveAdvisory({ ...a, resolvedAt: now }, { id: "u1", permissions: new Set(["ltoreports:manage"]) })).toBe(false);
  });
  it("start time: blank is now; PHT; not in the future; at most 7 days back", () => {
    expect(parseStartedAt("", now)).toEqual({ ok: true, at: now });
    expect(parseStartedAt("2026-11-09T08:30", now)).toEqual({ ok: true, at: new Date("2026-11-09T00:30:00Z") });
    expect(parseStartedAt("2026-11-09T13:00", now)).toMatchObject({ ok: false, error: "The start time cannot be in the future." });
    expect(parseStartedAt("2026-11-01T08:00", now)).toMatchObject({ ok: false });
    expect(parseStartedAt("yesterday", now)).toMatchObject({ ok: false, error: "Enter the start date and time." });
  });
});

describe("the date range picker (design pass)", () => {
  it("presets are Philippine dates; This week is Monday to today", () => {
    expect(PRESETS.map(([k]) => k)).toEqual(["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "custom"]);
    expect(presetRange("week", TODAY)).toEqual([TODAY, TODAY]); // 9 Nov 2026 is a Monday
    expect(presetRange("week", "2026-11-15")).toEqual(["2026-11-09", "2026-11-15"]); // Sunday
    expect(presetRange("30d", TODAY)).toEqual(["2026-10-11", TODAY]);
    expect(parseRange({ range: "week" }, "2026-11-12")).toMatchObject({ preset: "week", from: "2026-11-09", to: "2026-11-12", label: "9 Nov to 12 Nov 2026" });
  });

  it("round trip: what Apply puts in the URL reads back as the same range (the existing range / from / to format)", () => {
    for (const [k] of PRESETS) {
      if (k === "custom") continue;
      const [from, to] = presetRange(k, TODAY);
      expect(parseRange(rangeParams({ preset: k, from, to }), TODAY)).toMatchObject({ preset: k, from, to, error: null });
    }
    expect(rangeParams({ preset: "30d", from: "2026-10-11", to: TODAY })).toEqual({}); // the default needs nothing
    const custom = rangeParams({ preset: "custom", from: "2026-10-01", to: "2026-10-15" });
    expect(custom).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-15" });
    expect(parseRange(custom, TODAY)).toMatchObject({ preset: "custom", from: "2026-10-01", to: "2026-10-15", days: 15 });
  });

  it("Custom: two picked dates match a preset only when they are exactly it", () => {
    expect(presetOf("2026-10-11", TODAY, TODAY)).toBe("30d");
    expect(presetOf("2026-10-12", TODAY, TODAY)).toBe("custom");
  });

  it("limits: no future days, To not before From; over 92 days By day shows weeks (one line says so)", () => {
    expect(parseRange({ range: "custom", from: TODAY, to: "2026-11-10" }, TODAY).error).toBe("Dates cannot be in the future.");
    expect(parseRange({ range: "custom", from: TODAY, to: "2026-11-01" }, TODAY).error).toBe("\"To\" cannot be before \"From\".");
    expect(rangeNote(92)).toBeNull();
    expect(rangeNote(93)).toBe("Over 92 days, By day shows one row per week.");
  });

  it("says the days and the business days", () => {
    expect(rangeSummary("2026-10-11", TODAY, new Set())).toBe("30 days, 21 business days");
    expect(rangeSummary("2026-10-11", TODAY, new Set(["2026-11-02"]))).toBe("30 days, 20 business days");
    expect(rangeSummary(TODAY, TODAY, new Set())).toBe("1 day, 1 business day");
  });
});

describe("the page's tints and subtotals (design pass: no number changes)", () => {
  it("zero is neutral; above zero Overdue is red and On hold amber", () => {
    expect(countTone(0, "overdue")).toBe("zero");
    expect(countTone(0, "onHold")).toBe("zero");
    expect(countTone(0)).toBe("zero");
    expect(countTone(2, "overdue")).toBe("bad");
    expect(countTone(1, "onHold")).toBe("hold");
    expect(countTone(5)).toBe("plain");
  });

  it("a subtotal shows only when the group has more than one processor", () => {
    expect(showSubtotal(0)).toBe(false);
    expect(showSubtotal(1)).toBe(false);
    expect(showSubtotal(2)).toBe(true);
  });

  it("the usage bar is jobs in use out of capacity, tinted by the same thresholds", () => {
    expect(usageBar(availability(5, 2))).toEqual({ pct: 40, tone: "ok" }); // 60% free: Available
    expect(usageBar(availability(10, 7))).toEqual({ pct: 70, tone: "act" }); // Busy
    expect(usageBar(availability(2, 3))).toEqual({ pct: 100, tone: "bad" }); // Full (over capacity stays at 100)
    expect(usageBar(availability(10, 3, true))).toEqual({ pct: 0, tone: "mute" }); // On leave
  });
});
