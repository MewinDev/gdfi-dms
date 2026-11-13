/**
 * Paging for long lists (Loans, My loans, Settings > Users, Settings > Branches). Pure: no database.
 *
 * - The page number is in the address (`page=2`), so Back and refresh keep it. Page 1 has no `page`.
 * - Filters, the search, the tab and the order are applied first, to the whole list; then one page is cut.
 *   Counts (tab counts, "Showing X of Y", "N of M users") stay the TOTAL, never the page.
 * - A filter, a search or a tab is a new address without `page`, so it starts again at page 1.
 * - A page past the end shows the last page; anything that is not a whole number is page 1.
 */

export const PAGE_SIZE = { loans: 50, settings: 100 } as const;

export interface PageInfo {
  /** The page shown (1-based, clamped to the pages there are). */
  page: number;
  pages: number;
  /** First and last row shown, 1-based ("1–50"); 0 and 0 for an empty list. */
  from: number;
  to: number;
  total: number;
  size: number;
}

/** The page asked for in the address: a whole number from 1, anything else is 1. */
export function pageParam(v: string | string[] | undefined | null): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^\d{1,6}$/.test(s)) return 1;
  return Math.max(1, Number(s));
}

export function pageInfo(total: number, requested: number, size: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pages);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return { page, pages, from, to, total, size };
}

/** One page of a list that is already filtered and in order. */
export function pageOf<T>(rows: readonly T[], requested: number, size: number): { rows: T[]; info: PageInfo } {
  const info = pageInfo(rows.length, requested, size);
  return { rows: rows.slice(info.from ? info.from - 1 : 0, info.to), info };
}

/** For a database query: skip and take for the page (after counting the total). */
export const skipTake = (info: PageInfo) => ({ skip: (info.page - 1) * info.size, take: info.size });

/** "1–50 of 312" (thousands with commas). */
export const rangeText = (i: PageInfo) => `${i.from.toLocaleString("en-PH")}–${i.to.toLocaleString("en-PH")} of ${i.total.toLocaleString("en-PH")}`;

/** The address of another page: the same params, `page` set (left out for page 1). */
export function withPage(href: string, page: number): string {
  const [path, query = ""] = href.split("?");
  const p = new URLSearchParams(query);
  p.delete("page");
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}
