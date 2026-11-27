import { describe, expect, it } from "vitest";
import type { InboxRow } from "@/lib/services/work-items";
import { dueStatus, groupByLoan, itemChipText, loanCount, matchesFilter, waitedShort } from "./inbox-groups";

const row = (p: Partial<InboxRow>): InboxRow => ({
  id: "i", kind: "TRANSACTION", role: "LA", kindText: "Check and send", label: "GD1: Notary", pn: "GD1", link: "/loans/GD1", branchName: "Angono",
  state: "HELD", holder: null, arrivedText: "", waiting: 0, waitingText: "", poolTone: "green", poolText: null,
  dueDate: "2026-11-30", dueText: "Nov 30, 2026", tone: "green", paused: false, measureText: "", daysLeft: 2, ...p,
});

describe("D-063 counts in loans", () => {
  it("items of one loan count once; an item with no loan is one", () => {
    expect(loanCount([{ id: "a", pn: "GD1" }, { id: "b", pn: "GD1" }, { id: "c", pn: "GD2" }, { id: "f", pn: null }, { id: "g", pn: null }])).toBe(4);
    expect(loanCount([])).toBe(0);
  });
});

describe("D-063 Inbox status chip", () => {
  it("says late, due today, days left or paused", () => {
    expect(dueStatus(row({ daysLeft: -1 }))).toEqual({ kind: "late", text: "Late by 1 day", tone: "bad" });
    expect(dueStatus(row({ daysLeft: -3 }))?.text).toBe("Late by 3 days");
    expect(dueStatus(row({ daysLeft: 0 }))).toEqual({ kind: "today", text: "Due today", tone: "act" });
    expect(dueStatus(row({ daysLeft: 1 }))?.text).toBe("1 day left");
    expect(dueStatus(row({ daysLeft: 1, tone: "amber" }))?.tone).toBe("act");
    expect(dueStatus(row({ daysLeft: 4 }))).toEqual({ kind: "left", text: "4 days left", tone: "ok" });
    expect(dueStatus(row({ paused: true, daysLeft: -2 }))?.text).toBe("Paused");
    expect(dueStatus(row({ daysLeft: null, dueDate: null }))).toBeNull();
  });
});

describe("D-063 one row per loan", () => {
  const rows = [
    row({ id: "a", pn: "GD1", txn: { code: "NOTARY", name: "Notary" }, daysLeft: 2, borrower: "Maria Santos" }),
    row({ id: "b", pn: "GD2", txn: { code: "EDST", name: "EDST" }, daysLeft: 5, borrower: "Jose Cruz" }),
    row({ id: "c", pn: "GD1", txn: { code: "EDST", name: "EDST" }, daysLeft: -1, dueText: "Nov 26, 2026", borrower: "Maria Santos" }),
    row({ id: "f", pn: null, kind: "FUND_REQUEST", kindText: "Funds request", label: "CA-1: Cash advance for Ana", daysLeft: null, dueDate: null }),
  ];
  const groups = groupByLoan(rows);

  it("groups the items of a loan into one row, keeping the list's order", () => {
    expect(groups.map((g) => g.key)).toEqual(["GD1", "GD2", "f"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(groups[0].name).toBe("Maria Santos");
  });
  it("shows the most urgent item's status and due date", () => {
    expect(groups[0].status?.text).toBe("Late by 1 day");
    expect(groups[0].dueText).toBe("Nov 26, 2026");
    expect(groups[1].status?.text).toBe("5 days left");
  });
  it("an item without a loan is its own row, named by its label", () => {
    expect(groups[2].name).toBe("CA-1: Cash advance for Ana");
    expect(groups[2].status).toBeNull();
  });
  it("paused only when every item is paused", () => {
    const g = groupByLoan([row({ id: "p", paused: true }), row({ id: "q", daysLeft: 3 })])[0];
    expect(g.status?.text).toBe("3 days left");
    expect(groupByLoan([row({ id: "p", paused: true })])[0].status?.kind).toBe("paused");
  });
  it("the quick filters", () => {
    expect(groups.filter((g) => matchesFilter(g, "late")).map((g) => g.key)).toEqual(["GD1"]);
    expect(groups.filter((g) => matchesFilter(g, "all"))).toHaveLength(3);
    expect(groups.filter((g) => matchesFilter(g, "today"))).toHaveLength(0);
  });
  it("chip and waited words", () => {
    expect(itemChipText(rows[0])).toBe("Notary · Check and send");
    expect(itemChipText(rows[3])).toBe("Funds request");
    expect(waitedShort(0)).toBe("Less than a day");
    expect(waitedShort(1)).toBe("1 working day");
    expect(waitedShort(2)).toBe("2 working days");
  });
});
