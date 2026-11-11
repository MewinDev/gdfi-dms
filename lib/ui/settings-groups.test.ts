import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS, visibleSettingsGroups } from "./settings-groups";

describe("Settings groups", () => {
  it("shows the four groups in order, with Test data in test mode", () => {
    const g = visibleSettingsGroups(true);
    expect(g.map((x) => x.label)).toEqual(["Company setup", "People and access", "Documents and steps", "Time and money", "System and testing"]);
    expect(g[0].cards).toEqual(["branches", "lto", "loan-types"]);
    expect(g[4].cards).toEqual(["system", "myloans-sync", "email", "test-data"]);
  });

  it("shows Test kit only when the kit is available here (and in test mode)", () => {
    expect(visibleSettingsGroups(true, undefined, true)[4].cards).toEqual(["system", "myloans-sync", "email", "test-data", "test-kit"]);
    expect(visibleSettingsGroups(true, undefined, false).flatMap((x) => x.cards)).not.toContain("test-kit");
    expect(visibleSettingsGroups(false, undefined, true).flatMap((x) => x.cards)).not.toContain("test-kit");
  });

  it("hides the Test data card when TEST_MODE is not true", () => {
    const g = visibleSettingsGroups(false);
    expect(g.flatMap((x) => x.cards)).not.toContain("test-data");
    expect(g.find((x) => x.key === "system")?.cards).toEqual(["system", "myloans-sync", "email"]);
  });

  it("leaves out a group with no visible cards, but keeps Test data alone under its heading in test mode", () => {
    const groups = [
      { key: "a", label: "A", help: "", cards: ["branches"] as const },
      { key: "t", label: "Testing", help: "", cards: ["test-data"] as const },
    ];
    expect(visibleSettingsGroups(false, groups).map((x) => x.key)).toEqual(["a"]);
    expect(visibleSettingsGroups(true, groups).map((x) => x.key)).toEqual(["a", "t"]);
  });

  it("every card belongs to exactly one group", () => {
    const all = SETTINGS_GROUPS.flatMap((x) => x.cards);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(24); // + Processing stages, beside Checklist items; + Test kit; + Funds types; + Processor capacity; + Expense kinds; + Missing paper reasons
    const money = SETTINGS_GROUPS.find((x) => x.key === "time-money")!.cards as readonly string[];
    expect(money.indexOf("expense-kinds")).toBe(money.indexOf("cash-advance") + 1); // beside Cash-advance rules and Funds types
    expect(SETTINGS_GROUPS.find((x) => x.key === "documents")!.cards).toContain("processing-stages");
    // Hold reasons sit beside Problem reasons.
    const docs = SETTINGS_GROUPS.find((x) => x.key === "documents")!.cards as readonly string[];
    expect(docs.indexOf("hold-reasons")).toBe(docs.indexOf("problem-reasons") + 1);
  });
});
