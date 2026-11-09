import { describe, expect, it } from "vitest";
import { PERMISSIONS as P } from "@/lib/auth/permissions";
import { lastChangeWhat, roleImpact, tick, tickMany } from "./impact";

describe("Ticks (Settings > Roles)", () => {
  it("ticking a Change also ticks its View, and says so in one line", () => {
    const r = tick([P.LOANS_VIEW], P.BRANCHES_MANAGE, true);
    expect([...r.next].sort()).toEqual([P.LOANS_VIEW, P.BRANCHES_VIEW, P.BRANCHES_MANAGE].sort());
    expect(r.note).toBe("Also ticked: See branches (needed by Change branches).");
  });
  it("unticking a View also unticks its Change", () => {
    const r = tick([P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH], P.MYLOANS_VIEW, false);
    expect([...r.next]).toEqual([P.LOANS_VIEW]);
    expect(r.note).toBe("Also unticked: Refresh a loan from MyLoans (it needs See when MyLoans was last checked).");
  });
  it("a tick that needs nothing new says nothing", () => {
    expect(tick([P.LOANS_VIEW], P.MYLOANS_VIEW, true).note).toBeNull();
    expect(tick([P.LOANS_VIEW, P.MYLOANS_VIEW], P.MYLOANS_VIEW, false).note).toBeNull();
  });
  it("tick all and clear a group", () => {
    const all = tickMany([], [P.EMAIL_VIEW, P.EMAIL_MANAGE], true, "Email");
    expect([...all.next].sort()).toEqual([P.EMAIL_VIEW, P.EMAIL_MANAGE].sort());
    expect(all.note).toBeNull();
    const clear = tickMany([P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH, P.CHECKLIST_TICK], [P.LOANS_VIEW], false, "Loans");
    expect(clear.next.size).toBe(0);
    expect(clear.note).toContain("Also unticked:");
  });
});

describe("Impact preview", () => {
  it("says who gains and loses, with the exact wording", () => {
    expect(roleImpact([P.LOANS_VIEW], [P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH], 3).text)
      .toBe("3 users gain: See when MyLoans was last checked, Refresh a loan from MyLoans. 0 users lose anything.");
    const r = roleImpact([P.LOANS_VIEW, P.LOANS_REFRESH], [P.LOANS_VIEW], 1);
    expect(r.removed).toEqual([P.LOANS_REFRESH]);
    expect(r.text).toBe("0 users gain anything. 1 user loses: Refresh a loan from MyLoans.");
    expect(roleImpact([P.LOANS_VIEW], [], 0).text).toBe("0 users gain anything. 0 users lose anything.");
  });
});

describe("Last change on the role card", () => {
  it("names what was added and removed, else the audit summary", () => {
    expect(lastChangeWhat({ summary: "x", details: { added: [P.LOANS_REFRESH], removed: [P.AUDIT_VIEW] } })).toBe("added Refresh a loan from MyLoans; removed See the audit log");
    expect(lastChangeWhat({ summary: "Role Z: renamed from Y", details: { added: [], removed: [] } })).toBe("Role Z: renamed from Y");
    expect(lastChangeWhat({ summary: "Role Z made inactive", details: null })).toBe("Role Z made inactive");
  });
});
