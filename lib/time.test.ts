import { describe, expect, it } from "vitest";
import { tatBadge } from "./time";

// Working days (weekends, holidays, closures) are tested in lib/calendar/core.test.ts (D-041).
describe("TAT badge", () => {
  it("on time, due today, overdue", () => {
    expect(tatBadge("2026-11-10", "2026-11-09")).toBe("ON_TIME");
    expect(tatBadge("2026-11-10", "2026-11-10")).toBe("DUE_TODAY");
    expect(tatBadge("2026-11-10", "2026-11-11")).toBe("OVERDUE");
  });
});
