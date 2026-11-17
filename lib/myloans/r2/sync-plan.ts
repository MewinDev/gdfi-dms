import type { FeedPage, FeedRow, FeedState, ProductRow } from "./contract";
import { classifyByKeywords, type ClassificationRules } from "@/lib/rules/classify";

/**
 * The API 2 sync run as pure planning (D-036): fetch every page, then decide per loan. The database side
 * (Open Items, the checkpoint row, alerts) is pieces 7 and 8; these functions say exactly what they do.
 */

export const CHECKPOINT_OVERLAP_MS = 5 * 60_000;

export interface FetchedRun { ok: true; runStartedAt: string; rows: FeedRow[]; pages: number; checkpoint: Date }
export interface FailedRun { ok: false; error: string; pages: number; checkpoint: null }

/**
 * Pages until nextAfterId is null (an empty page is items [] and null). runStartedAt is page 1's and kept
 * for the run. The checkpoint (runStartedAt minus 5 minutes) is returned only when every page succeeded;
 * on any failure there is no checkpoint, so the next run repeats from the old one.
 */
export async function fetchRun(fetchPage: (afterId: number) => Promise<FeedPage>, maxPages = 10_000): Promise<FetchedRun | FailedRun> {
  const rows: FeedRow[] = [];
  let afterId = 0, pages = 0, runStartedAt: string | null = null;
  try {
    for (;;) {
      const p = await fetchPage(afterId);
      pages++;
      runStartedAt ??= p.runStartedAt;
      rows.push(...p.items);
      if (p.nextAfterId === null) break;
      if (p.nextAfterId <= afterId) throw new Error(`nextAfterId did not move forward (${p.nextAfterId} after ${afterId})`);
      if (pages >= maxPages) throw new Error("Too many pages in one run");
      afterId = p.nextAfterId;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), pages, checkpoint: null };
  }
  return { ok: true, runStartedAt: runStartedAt!, rows, pages, checkpoint: new Date(new Date(runStartedAt!).getTime() - CHECKPOINT_OVERLAP_MS) };
}

/** What the DMS holds for a loan file (linked on CIN; the current live transaction). */
export interface HeldLoan { loanId: string; cin: string; externalLoanId: number; contentHash: string }

export type Decision =
  | { kind: "duplicate"; externalLoanId: number; rows: FeedRow[] }                       // alert Admin, log rows, no Open Items this run
  | { kind: "unchanged"; externalLoanId: number }
  | { kind: "not-held"; externalLoanId: number }                                          // released but no loan file: the pool's business
  | { kind: "changed"; loanId: string; row: FeedRow; feedState: FeedState }               // compare fields -> Open Items (piece 8)
  | { kind: "record-replaced"; loanId: string; fromExternalLoanId: number; row: FeedRow }; // rule (b): a new ExternalLoanId for a known CIN

/**
 * Per loan: duplicates first (RowsForThisLoan > 1, or two rows for one ExternalLoanId); then by CIN, so a
 * redo chain always links the CIN to its current live transaction, even when the older copies are never
 * re-sent. A changed hash means "look at the fields"; the DMS never recomputes the hash.
 */
export function planRun(rows: FeedRow[], held: HeldLoan[]): Decision[] {
  const out: Decision[] = [];
  const byId = new Map<number, FeedRow[]>();
  for (const r of rows) byId.set(r.externalLoanId, [...(byId.get(r.externalLoanId) ?? []), r]);
  const heldByCin = new Map(held.map((h) => [h.cin, h]));
  const heldById = new Map(held.map((h) => [h.externalLoanId, h]));
  for (const [id, rs] of byId) {
    if (rs.length > 1 || rs.some((r) => r.rowsForThisLoan > 1)) { out.push({ kind: "duplicate", externalLoanId: id, rows: rs }); continue; }
    const row = rs[0];
    const same = heldById.get(id);
    if (same) {
      out.push(row.contentHash === same.contentHash ? { kind: "unchanged", externalLoanId: id } : { kind: "changed", loanId: same.loanId, row, feedState: row.feedState });
      continue;
    }
    const byCin = row.cin ? heldByCin.get(row.cin) : undefined;
    // A Superseded copy of a held CIN is an older copy: nothing to link to it.
    if (byCin && row.feedState !== "Superseded") { out.push({ kind: "record-replaced", loanId: byCin.loanId, fromExternalLoanId: byCin.externalLoanId, row }); continue; }
    out.push({ kind: "not-held", externalLoanId: id });
  }
  return out;
}

/** API 5 (the full list each sync): renames by ProductID, and the loans whose classification flips. */
export function productRenames(known: Map<number, string>, list: ProductRow[]): { productId: number; from: string; to: string }[] {
  return list.filter((p) => known.has(p.productId) && known.get(p.productId) !== p.name).map((p) => ({ productId: p.productId, from: known.get(p.productId)!, to: p.name }));
}

export function classificationFlips(renames: { productId: number; from: string; to: string }[], rules: ClassificationRules) {
  return renames
    .map((r) => ({ ...r, before: classifyByKeywords(r.from, rules).classification, after: classifyByKeywords(r.to, rules).classification }))
    .filter((r) => r.before !== r.after);
}
