import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAcceptedStatus, recordStatusKind, statusFromId, statusKind, statusLabel } from "./status";
import { ResilientAdapter } from "./resilience";
import { MockMyLoansAdapter } from "./mock-adapter";
import { mockRecords } from "./mock-data";
import { mapLoan } from "./live-mapping";
import { runDataCheck } from "./data-check";

describe("the one accepted MyLoans status", () => {
  it("isAcceptedStatus: true only for 12", () => {
    expect(isAcceptedStatus(12)).toBe(true);
    expect(isAcceptedStatus("12")).toBe(true);
    expect(isAcceptedStatus(" 12 ")).toBe(true);
    for (let id = 0; id <= 60; id++) if (id !== 12) expect(isAcceptedStatus(id)).toBe(false);
    for (const v of [null, undefined, "", "abc", "12a", "1.2"]) expect(isAcceptedStatus(v)).toBe(false);
  });

  it("statusKind for every status", () => {
    const want: Record<number, string> = {
      1: "before_release", 2: "before_release", 3: "before_release", 4: "before_release", 5: "before_release", 6: "before_release",
      7: "before_release", 8: "before_release", 9: "before_release", 10: "before_release", 11: "before_release",
      12: "released", 13: "before_release", 14: "cancelled",
      15: "not_a_loan", 16: "not_a_loan", 17: "not_a_loan", 18: "not_a_loan", 19: "not_a_loan",
      20: "other", 0: "other", 48: "other", 49: "before_release", 50: "other", 99: "other",
    };
    for (const [id, kind] of Object.entries(want)) {
      expect(statusKind(Number(id))).toBe(kind);
      expect(statusKind(id)).toBe(kind);
    }
    for (const v of [null, undefined, "", "x"]) expect(statusKind(v)).toBe("other");
  });

  it("recordStatusKind: by id first, else by the DMS word", () => {
    expect(recordStatusKind({ statusId: "8", status: "RELEASED" })).toBe("before_release"); // the id wins
    expect(recordStatusKind({ status: "RELEASED" })).toBe("released");
    expect(recordStatusKind({ status: "CANCELLED" })).toBe("cancelled");
    expect(recordStatusKind({ status: "STATUS_14" })).toBe("cancelled");
    expect(recordStatusKind({ status: "STATUS_16" })).toBe("not_a_loan");
    expect(recordStatusKind({ status: "PENDING" })).toBe("before_release");
    expect(recordStatusKind({ status: "REPLACED" })).toBe("other");
    expect(recordStatusKind({ status: null })).toBe("other");
  });

  it("names: MyLoans' name straight through, else the confirmed names, else Status N", () => {
    expect(statusFromId(8)).toEqual({ status: "STATUS_8", statusId: "8", statusName: "Check Prepared" });
    expect(statusFromId(11).statusName).toBe("For Approval (Loan Released)");
    expect(statusFromId(14).statusName).toBe("Cancelled");
    expect(statusFromId(49).statusName).toBe("Check Assignment (Transaction)");
    expect(statusFromId(8, "Custom from MyLoans").statusName).toBe("Custom from MyLoans");
    expect(statusLabel({ status: "STATUS_8" })).toBe("Status 8");
    expect(statusLabel({ status: "RELEASED" })).toBe("Loan Released");
    expect(mapLoan({ PNNo: "GD1", TransactionStatusId: 8, TransactionStatusName: "Check Prepared" })).toMatchObject({ statusId: "8", statusName: "Check Prepared", status: "STATUS_8" });
  });

  it("the data check refuses every status but 12", () => {
    const ok = mockRecords().find((r) => r.pn === "GD1012026901001")!;
    const ctx = { allowedBranches: null, today: "2099-01-01" };
    expect(runDataCheck(ok, ctx).ok).toBe(true);
    for (const id of [1, 8, 11, 13, 14, 15, 49, 50]) {
      const r = runDataCheck({ ...ok, ...statusFromId(id) }, ctx);
      expect(r.ok ? null : r.field).toBe("status");
    }
  });

  it("no other code compares to 12", () => {
    // Every .ts/.tsx file outside tests: no `=== 12`, `"12"` status comparison or RELEASED_STATUS_ID.
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f) || p.endsWith(join("myloans", "status.ts"))) continue;
        const src = readFileSync(p, "utf8");
        if (/RELEASED_STATUS_ID|[sS]tatus(Id)?\s*[!=]==?\s*"?12\b|\b"?12"?\s*[!=]==?\s*\w*[sS]tatus/.test(src)) bad.push(p);
      }
    };
    for (const d of ["lib", "app", "components"]) walk(d);
    expect(bad).toEqual([]);
  });
});

describe("statuses 15 to 19 are not loans", () => {
  const adapter = () => new ResilientAdapter(new MockMyLoansAdapter(), { retries: 0 });

  it("the mock gives every row a status id and name, with cases 8, 11, 14, 49 and the bad 15", () => {
    const rows = mockRecords();
    for (const r of rows) {
      expect(r.statusId, r.pn).toBeTruthy();
      expect(r.statusName, r.pn).toBeTruthy();
    }
    expect(rows.map((r) => r.statusId).filter((id) => id !== "12").sort()).toEqual(["11", "14", "15", "49", "8"]);
  });

  it("a lookup of status 15 is 'not found'; the feed and the search leave it out", async () => {
    const a = adapter();
    expect(await a.getByPn("GD1652026901015")).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(await a.getByPn("GD1652026901008")).toMatchObject({ ok: true, record: { statusId: "8", statusName: "Check Prepared" } });
    const s = await a.search("GD16520269010", 50);
    expect(s.ok && s.hits.map((h) => h.pn)).not.toContain("GD1652026901015");
    const inner = new MockMyLoansAdapter({ overrides: () => ({ GD1652026901015: { changedAt: new Date().toISOString() }, GD1652026901008: { changedAt: new Date().toISOString() } }) });
    const feed = await new ResilientAdapter(inner, { retries: 0 }).getChangedSince(new Date(0), 10);
    expect(feed.ok && feed.records.map((r) => r.pn)).toEqual(["GD1652026901008"]);
  });
});
