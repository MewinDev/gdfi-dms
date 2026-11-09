/**
 * The Funds page list (To approve, To release, Outstanding, History): the plain helpers behind the
 * summary line, the on-page search and the empty-field dash. Browser-safe, no database.
 */

/** One row of a tab as the summary and the search see it. */
export interface ListItem {
  /** The row's key (advance number, or a top-up or carry-over id). */
  key: string;
  /** Funds type code (CA, FT). */
  typeCode: string;
  /** The amount shown in the Amount column, in centavos. */
  cents: number;
  /** Request number, PN(s) and borrower name(s): what the search box matches. */
  search: string[];
}

/** The text a search matches against: lower case, spaces and dashes removed ("CA-2026-0001" = "ca20260001"). */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-·]+/g, "");

/** Does this row match the typed search (request number, PN or borrower)? An empty search matches every row. */
export function matchesSearch(item: Pick<ListItem, "search">, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return item.search.some((s) => norm(s).includes(q));
}

/** The rows left after the type filter and the search, with their count and the sum of their amounts. */
export function summarize(items: ListItem[], opts: { ftype?: string | null; query?: string } = {}): { count: number; cents: number; keys: Set<string> } {
  const shown = items.filter((i) => (!opts.ftype || i.typeCode === opts.ftype) && matchesSearch(i, opts.query ?? ""));
  return { count: shown.length, cents: shown.reduce((s, i) => s + i.cents, 0), keys: new Set(shown.map((i) => i.key)) };
}

const pesoText = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2 requests · ₱7,000.00 total" (the parts, so the page can show the numbers in navy). */
export function summaryParts(s: { count: number; cents: number }): { count: string; noun: string; total: string } {
  return { count: String(s.count), noun: s.count === 1 ? "request" : "requests", total: pesoText(s.cents) };
}
export const summaryText = (s: { count: number; cents: number }) => {
  const p = summaryParts(s);
  return `${p.count} ${p.noun} · ${p.total} total`;
};

/** An empty field shows a grey dash, never a blank cell. */
export const DASH = "—";
export const orDash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : DASH);

/** "Waiting since today", "1 business day waiting", "4 business days waiting" (or "outstanding"). */
export function daysText(days: number, what: "waiting" | "outstanding"): string {
  if (days <= 0) return what === "waiting" ? "Waiting since today" : "Released today";
  return `${days} business day${days === 1 ? "" : "s"} ${what}`;
}

/**
 * The aging dot of an outstanding advance, from what the app already knows: red when the liquidation is
 * overdue, amber when it has been out longer than the first age group (over 10 business days), grey otherwise.
 * Never colour alone: the dot always sits beside its words.
 */
export function agingTone(input: { overdue: boolean; days: number }): "bad" | "act" | "mute" {
  if (input.overdue) return "bad";
  return input.days > 10 ? "act" : "mute";
}

/** A liquidation report can be printed once the request is liquidated (and still after it is closed). */
export const PRINTABLE_STATUSES: readonly string[] = ["LIQUIDATED", "CLOSED"];
