/** Loans page filters: the fields, the active-filter chips and the addresses that remove one. Pure. */

export interface FilterField {
  name: string;
  label: string;
  value?: string;
  options: [string, string][];
}

export interface Chip { name: string; text: string; removeHref: string }

/** Address of the list with these params (empty values dropped). */
export function listHref(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return `/loans${s ? `?${s}` : ""}`;
}

/** One chip per filter that is on: "Stage: Processing ×". Removing one keeps the others and the tab. */
export function activeChips(fields: FilterField[], params: Record<string, string | undefined>, extra: { name: string; text: string }[] = []): Chip[] {
  const chips: Chip[] = [];
  for (const f of fields) {
    const v = params[f.name];
    if (!v) continue;
    const label = f.options.find(([k]) => k === v)?.[1] ?? v;
    chips.push({ name: f.name, text: `${f.label}: ${label}`, removeHref: listHref({ ...params, [f.name]: undefined }) });
  }
  for (const e of extra) if (params[e.name]) chips.push({ ...e, removeHref: listHref({ ...params, [e.name]: undefined }) });
  return chips;
}

/** Clear all filters: keep the tab and the search. */
export const clearAllHref = (params: Record<string, string | undefined>) => listHref({ tab: params.tab, q: params.q, by: params.by });

/**
 * Paging a grouped list: the WHOLE result is grouped (Area, then Branch, the list's own order inside each),
 * then cut into pages of the usual size. A heading shows its group's total over the whole result, and
 * "continued" when the group began on an earlier page. (Pages of whole groups were the other choice: one
 * branch with 300 loan files would then be one page of 300.)
 */
export interface GroupTotals { areas: Record<string, number>; branches: Record<string, number>; continued: Set<string> }
export const branchKey = (area: string, branch: string) => JSON.stringify([area, branch]);

/** The rows in the grouped order (what the grouped table shows from top to bottom). */
export function groupedOrder<T extends { area: string; branch: string }>(rows: T[]): T[] {
  return groupByAreaBranch(rows).flatMap((g) => g.branches.flatMap((b) => b.rows));
}

/** Whole-result totals per Area and per Branch, and which groups began before `firstRow` (0-based). */
export function groupTotals<T extends { area: string; branch: string }>(ordered: T[], firstRow: number): GroupTotals {
  const areas: Record<string, number> = {};
  const branches: Record<string, number> = {};
  const continued = new Set<string>();
  ordered.forEach((r, i) => {
    const a = r.area || "Area needed";
    areas[a] = (areas[a] ?? 0) + 1;
    branches[branchKey(a, r.branch)] = (branches[branchKey(a, r.branch)] ?? 0) + 1;
    if (i < firstRow) { continued.add(a); continued.add(branchKey(a, r.branch)); }
  });
  return { areas, branches, continued };
}

/** Loan rows grouped by Area, then Branch (the Admin table's "Group by area and branch"). Pure. */
export function groupByAreaBranch<T extends { area: string; branch: string }>(rows: T[]): { area: string; count: number; branches: { branch: string; rows: T[] }[] }[] {
  const areas = new Map<string, Map<string, T[]>>();
  for (const r of rows) {
    const a = r.area || "Area needed";
    const m = areas.get(a) ?? new Map<string, T[]>();
    m.set(r.branch, [...(m.get(r.branch) ?? []), r]);
    areas.set(a, m);
  }
  const last = (x: string) => (x === "Area needed" ? 1 : 0);
  return [...areas.entries()].sort(([a], [z]) => last(a) - last(z) || a.localeCompare(z)).map(([area, m]) => ({
    area, count: [...m.values()].reduce((n, rs) => n + rs.length, 0),
    branches: [...m.entries()].sort(([a], [z]) => a.localeCompare(z)).map(([branch, rs]) => ({ branch, rows: rs })),
  }));
}
