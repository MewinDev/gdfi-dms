import { describe, expect, it } from "vitest";
import { addBusinessDays, businessDaysBetween, tatBadge } from "./time";

describe("business days", () => {
  it("skips weekends", () => {
    // 2026-11-06 is a Friday
    expect(addBusinessDays("2026-11-06", 1)).toBe("2026-11-09");
    expect(addBusinessDays("2026-11-06", 2)).toBe("2026-11-10");
    expect(addBusinessDays("2026-11-06", 0)).toBe("2026-11-06");
  });
  it("skips holidays", () => {
    expect(addBusinessDays("2026-11-27", 2, new Set(["2026-11-30"]))).toBe("2026-12-02");
  });
  it("counts between dates", () => {
    expect(businessDaysBetween("2026-11-06", "2026-11-10")).toBe(2);
    expect(businessDaysBetween("2026-11-10", "2026-11-06")).toBe(-2);
  });
  it("TAT badge", () => {
    expect(tatBadge("2026-11-10", "2026-11-09")).toBe("ON_TIME");
    expect(tatBadge("2026-11-10", "2026-11-10")).toBe("DUE_TODAY");
    expect(tatBadge("2026-11-10", "2026-11-11")).toBe("OVERDUE");
  });
});
