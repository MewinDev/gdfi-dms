import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentHash, hashInput, HASH_FIELDS } from "./hash";
import { readApi1, redoSuffixAt } from "./contract";
import { api1, api2, api5, codeOf, redoneCode, renameProduct, scenarioDb, sourceUpdatedAtOf } from "./mock";
import { classificationFlips, fetchRun, planRun, productRenames } from "./sync-plan";
import { DEFAULT_CLASSIFICATION_RULES } from "@/lib/rules/classify";

/** myloans round 2 and 3 contract (D-036, D-040): hash, paging by loan, API 1 codes, FeedStates, redo chains, products. */
describe("ContentHash (mock only; the DMS compares hash strings, never recomputes them)", () => {
  it("17 fields (no birth date, D-037), '|' between them, NULL as empty text; SHA-256 over UTF-16LE, lowercase hex", () => {
    expect(HASH_FIELDS).toHaveLength(17);
    expect(HASH_FIELDS[16]).toBe("ReplacedByExternalLoanId");
    expect(HASH_FIELDS as readonly string[]).not.toContain("BirthDate");
    const v = Object.fromEntries(HASH_FIELDS.map((f) => [f, null])) as Parameters<typeof hashInput>[0];
    expect(hashInput(v)).toBe("|".repeat(16));
    // UTF-16LE, not UTF-8: "ñ" hashes differently from its UTF-8 bytes.
    expect(contentHash("Peña")).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash("Peña")).not.toBe(createHash("sha256").update("Peña", "utf8").digest("hex"));
  });

  // docs/myloans/myloans_hash_test_vectors.sql: myloans sends the three output rows (HashInput and ContentHash).
  // Until then the expected values are unknown; fill them in and remove .skip (D-036 item 9).
  it.skip("matches the 3 myloans test vectors (waiting for myloans' output rows)", () => {
    const vectors: { input: string; hash: string }[] = [];
    for (const v of vectors) expect(contentHash(v.input)).toBe(v.hash);
  });
});

describe("API 2: pages cut by loan; checkpoint only after every page", () => {
  it("a duplicate loan's two rows are on one page; nextAfterId null on the last page; empty page = [] and null", async () => {
    const db = scenarioDb();
    const p1 = api2(db, "2026-11-17T08:30:00+08:00", 0, 3);
    expect(p1.items.map((r) => r.externalLoanId)).toEqual([101, 102, 103]);
    expect(p1.nextAfterId).toBe(103);
    const p2 = api2(db, "2026-11-17T08:30:00+08:00", 103, 3);
    expect(p2.items.filter((r) => r.externalLoanId === 104)).toHaveLength(2); // both rows of the duplicate, same page
    expect(api2(db, "2026-11-17T08:30:00+08:00", 99_999, 3)).toEqual({ runStartedAt: db.now, items: [], nextAfterId: null });
    const run = await fetchRun(async (after) => api2(db, "2026-11-17T08:30:00+08:00", after, 3));
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.runStartedAt).toBe(db.now); // page 1's, kept for the run
      expect(run.checkpoint.getTime()).toBe(new Date(db.now).getTime() - 5 * 60_000);
    }
    // A failed page: no checkpoint (the next run starts from the old one).
    let n = 0;
    const failed = await fetchRun(async (after) => { if (++n === 2) throw new Error("timeout"); return api2(db, "2026-11-17T08:30:00+08:00", after, 3); });
    expect(failed).toMatchObject({ ok: false, checkpoint: null });
  });

  it("NotReleased can appear in API 2 (an ever-released loan whose status left 12); all 5 FeedStates are handled", async () => {
    const run = await fetchRun(async (after) => api2(scenarioDb(), "2026-11-17T08:30:00+08:00", after, 50));
    if (!run.ok) throw new Error(run.error);
    expect(run.rows.find((r) => r.externalLoanId === 301)?.feedState).toBe("NotReleased");
    const held = [{ loanId: "L301", cin: "CIN-FAKE-301", externalLoanId: 301, contentHash: "old" }];
    expect(planRun(run.rows, held).find((d) => d.kind === "changed")).toMatchObject({ loanId: "L301", feedState: "NotReleased" });
  });
});

describe("decisions per loan", () => {
  it("RowsForThisLoan > 1: a duplicate alert with the rows, and no Open Items for that loan this run", async () => {
    const run = await fetchRun(async (after) => api2(scenarioDb(), "2026-11-17T08:30:00+08:00", after, 50));
    if (!run.ok) throw new Error(run.error);
    const d = planRun(run.rows, [{ loanId: "L104", cin: "CIN-FAKE-104", externalLoanId: 104, contentHash: "old" }]);
    expect(d.find((x) => x.kind === "duplicate")).toMatchObject({ externalLoanId: 104, rows: expect.arrayContaining([expect.objectContaining({ externalLoanId: 104 })]) });
    expect(d.some((x) => x.kind === "changed" && x.loanId === "L104")).toBe(false);
  });

  it("a redo chain of 3 (round 3): the OLDEST copy is re-sent when the newest replacement is created; one record-replaced to the live copy", async () => {
    const run = await fetchRun(async (after) => api2(scenarioDb(), "2026-11-17T08:30:00+08:00", after, 50));
    if (!run.ok) throw new Error(run.error);
    // 201 was updated and suffixed at 08:00 (before the checkpoint); 203's created_at (09:00) brings it back.
    expect(run.rows.find((r) => r.externalLoanId === 201)).toMatchObject({ feedState: "Superseded", replacedByExternalLoanId: 203, sourceUpdatedAt: "2026-11-17T09:00:00+08:00" });
    expect(run.rows.find((r) => r.externalLoanId === 202)).toMatchObject({ feedState: "Superseded", replacedByExternalLoanId: 203 });
    const d = planRun(run.rows, [{ loanId: "LCHAIN", cin: "CIN-FAKE-CHAIN", externalLoanId: 201, contentHash: "old" }]);
    const mine = d.filter((x) => "loanId" in x && x.loanId === "LCHAIN");
    expect(mine).toEqual([expect.objectContaining({ kind: "record-replaced", fromExternalLoanId: 201, row: expect.objectContaining({ externalLoanId: 203, feedState: "Released" }) })]);
    // Round 2's freshness (updated_at only) would never have re-sent 201.
    const db = scenarioDb();
    expect(new Date(db.txns.find((t) => t.id === 201)!.updatedAt) < new Date("2026-11-17T08:30:00+08:00")).toBe(true);
  });

  it("a redo WITHOUT cancellation reaches API 2 only through the suffix time (round 3); the DMS fetches the replacement", async () => {
    const db = scenarioDb();
    const since = "2026-11-17T08:30:00+08:00";
    const t401 = db.txns.find((t) => t.id === 401)!;
    // Status 12, updated_at and the replacement's created_at both before the checkpoint: only the suffix moves it.
    expect(t401.statusId).toBe(12);
    expect(new Date(t401.updatedAt) < new Date(since) && new Date(t401.createdAt!) < new Date(since)).toBe(true);
    expect(sourceUpdatedAtOf(t401, db)).toBe("2026-11-17T09:00:00+08:00");
    const run = await fetchRun(async (after) => api2(db, since, after, 50));
    if (!run.ok) throw new Error(run.error);
    expect(run.rows.find((r) => r.externalLoanId === 401)).toMatchObject({ feedState: "Superseded", replacedByExternalLoanId: 402, replacedByPnNo: "GD9990000000402" });
    expect(run.rows.some((r) => r.externalLoanId === 402)).toBe(false); // the replacement itself did not change since
    const d = planRun(run.rows, [{ loanId: "LREDO", cin: "CIN-FAKE-REDO", externalLoanId: 401, contentHash: "old" }]);
    expect(d.filter((x) => "loanId" in x && x.loanId === "LREDO")).toEqual([
      { kind: "superseded", loanId: "LREDO", fromExternalLoanId: 401, replacedByExternalLoanId: 402, replacedByPnNo: "GD9990000000402" },
    ]);
  });

  it("the redo suffix time is read like myloans' query: 35 characters, 'x' at 21, Manila time; anything else is null", () => {
    expect(redoSuffixAt(redoneCode(51164, "20261116134215"))).toBe("2026-11-16T13:42:15+08:00");
    expect(redoSuffixAt(codeOf(51164))).toBeNull(); // 20 characters: not redone
    expect(redoSuffixAt(`${codeOf(1)}y20261116134215`)).toBeNull(); // no "x"
    expect(redoSuffixAt(redoneCode(1, "20261131134215"))).toBeNull(); // 31 November: TRY_CONVERT gives NULL
    expect(redoSuffixAt(redoneCode(1, "2026111613421A"))).toBeNull();
    expect(redoSuffixAt(null)).toBeNull();
  });

  it("unchanged hash: nothing to do", () => {
    const row = api2(scenarioDb(), "2026-11-17T08:30:00+08:00", 0, 1).items[0];
    expect(planRun([row], [{ loanId: "L101", cin: "CIN-FAKE-101", externalLoanId: 101, contentHash: row.contentHash }])).toEqual([{ kind: "unchanged", externalLoanId: 101 }]);
  });
});

describe("API 1 codes", () => {
  it("404, 422 with FeedState and Replaced by, 200, and 409 (the single selectable row, else contact Admin)", () => {
    const db = scenarioDb();
    expect(readApi1(api1(db, "GD9990000000000"))).toMatchObject({ kind: "not-found" });
    const r422 = readApi1(api1(db, db.txns.find((t) => t.id === 202)!.pnNo));
    expect(r422).toMatchObject({ kind: "not-selectable", feedState: "Superseded" });
    expect(r422.kind === "not-selectable" && r422.message).toBe("This copy was redone in myloans. Replaced by GD9990000000203.");
    expect(readApi1(api1(db, db.txns[0].pnNo))).toMatchObject({ kind: "found" });
    const r409 = readApi1(api1(db, "GD9990000099905"));
    expect(r409).toMatchObject({ kind: "found", row: { externalLoanId: 105 }, logRows: expect.any(Array) });
    const both = { ...db, txns: db.txns.map((t) => (t.id === 106 ? { ...t, statusId: 12 } : t)) };
    expect(readApi1(api1(both, "GD9990000099905"))).toMatchObject({ kind: "multiple", message: "Multiple records in myloans, contact Admin.", alertAdmin: true });
  });

  it("more than one row is always 409 with every row, whatever their states (round 3)", () => {
    const db = scenarioDb();
    const none = { ...db, txns: db.txns.map((t) => (t.id === 105 ? { ...t, statusId: 14 } : t)) }; // both cancelled
    const a = api1(none, "GD9990000099905");
    expect(a.status).toBe(409);
    expect(a.status === 409 && a.body.rows.map((r) => r.externalLoanId).sort()).toEqual([105, 106]);
    expect(readApi1(a)).toMatchObject({ kind: "multiple", logRows: expect.arrayContaining([expect.objectContaining({ externalLoanId: 106 })]) });
  });
});

describe("API 5 products", () => {
  it("renames by ProductID; a rename that flips the classification flags the loans", () => {
    const db = scenarioDb();
    const known = new Map(api5(db).map((p) => [p.productId, p.name]));
    const renamed = renameProduct(db, 1, "Auto Refinancing");
    const renames = productRenames(known, api5(renamed));
    expect(renames).toEqual([{ productId: 1, from: "Auto Loan", to: "Auto Refinancing" }]);
    // "Auto Loan" (no keyword: Refinancing by default) -> still Refinancing: no flip. A Financing name flips.
    expect(classificationFlips(renames, DEFAULT_CLASSIFICATION_RULES)).toEqual([]);
    const toFin = productRenames(known, api5(renameProduct(db, 1, "Auto Financing")));
    expect(classificationFlips(toFin, DEFAULT_CLASSIFICATION_RULES)).toEqual([{ productId: 1, from: "Auto Loan", to: "Auto Financing", before: "REFINANCING", after: "FINANCING" }]);
  });
});
