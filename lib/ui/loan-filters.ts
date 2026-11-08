/** Loans page filters: the fields, the active-filter chips and the addresses that remove one. Pure. */

export interface FilterField {
  name: string;
  label: string;
  value?: string;
  options: [string, string][];
}

export const FILTER_NAMES = ["stage", "classification", "branch", "loanType", "tat", "needsAction", "group"] as const;

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
export const clearAllHref = (params: Record<string, string | undefined>) => listHref({ tab: params.tab, q: params.q });
