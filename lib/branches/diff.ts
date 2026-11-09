import { looksLikeTestBranch, TEST_BRANCH_NOTE, type MyLoansBranchRow } from "./file";

/**
 * Compares a MyLoans branch list with the DMS copy (pure: the caller loads the DMS rows). Matching is
 * by MyLoans id first (branch_id, area_id, division_id), by code (branches) or name (areas, divisions)
 * only when there is no id on one side, so a renamed branch or a changed code is an update, not
 * "new plus missing". Nothing here writes anything.
 */

export type ReviewKind =
  | "NEW_BRANCH" | "RENAMED" | "CODE_CHANGED" | "MOVED" | "DETAILS_CHANGED" | "CLOSED" | "REOPENED" | "NOT_IN_LIST" | "UNKNOWN_CODE"
  | "NEW_AREA" | "RENAMED_AREA" | "NEW_DIVISION" | "RENAMED_DIVISION";

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  NEW_BRANCH: "New branch", RENAMED: "Renamed", CODE_CHANGED: "Code changed", MOVED: "Area or division changed", DETAILS_CHANGED: "Address changed",
  CLOSED: "Closed (inactive)", REOPENED: "Reopened", NOT_IN_LIST: "Not in the last list", UNKNOWN_CODE: "Unknown branch code seen in a PN",
  NEW_AREA: "New area", RENAMED_AREA: "Area renamed", NEW_DIVISION: "New division", RENAMED_DIVISION: "Division renamed",
};

export interface DmsGroup { id: string; myloansId: number | null; name: string }
export interface DmsBranch {
  id: string; myloansBranchId: number | null; code: string | null; name: string; address: string; active: boolean; hidden: boolean;
  source: "MYLOANS" | "DMS"; divisionId: string | null; areaId: string | null;
}
export interface DmsState { divisions: DmsGroup[]; areas: DmsGroup[]; branches: DmsBranch[] }

export interface FieldChange { field: "code" | "name" | "address" | "active" | "division" | "area"; label: string; was: string; now: string }

/** A group (area or division) the list names: an existing DMS one, or one to create, or a rename. */
export interface GroupRef { key: string; dmsId: string | null; myloansId: number | null; name: string; kind: "same" | "new" | "renamed"; was?: string }

export interface DiffItem {
  status: "new" | "changed" | "unchanged";
  row: MyLoansBranchRow & { line?: number };
  branchId: string | null;
  matchedBy: "id" | "code" | "name" | null;
  /** The main kind (the label of the review item); kinds lists every difference. */
  kind: ReviewKind | null;
  kinds: ReviewKind[];
  fields: FieldChange[];
  division: GroupRef;
  area: GroupRef;
  /** Status to import for a new branch (the file's, or Inactive for a test-looking row without one). */
  importActive: boolean;
  /** Looks like a test or unused branch: suggest Hide from DMS (Admin decides). */
  suggestHide: boolean;
  note: string;
}

export interface BranchDiff {
  items: DiffItem[];
  /** DMS branches from MyLoans that the (full) list does not have. Never deleted: review "Not in the last list". */
  missing: DmsBranch[];
  newGroups: GroupRef[];
  renamedGroups: (GroupRef & { level: "area" | "division" })[];
  counts: { new: number; changed: number; unchanged: number; missing: number; suggestions: number };
  /** Per (Division, Area): branches in the list, new, changed. */
  perGroup: { division: string; area: string; total: number; new: number; changed: number }[];
}

const KIND_ORDER: ReviewKind[] = ["CLOSED", "REOPENED", "CODE_CHANGED", "MOVED", "RENAMED", "DETAILS_CHANGED"];
const yesNo = (b: boolean) => (b ? "Active" : "Inactive");

function groupResolver(level: "area" | "division", dms: DmsGroup[]) {
  const byMl = new Map(dms.filter((g) => g.myloansId !== null).map((g) => [g.myloansId!, g]));
  const byName = new Map(dms.filter((g) => g.myloansId === null).map((g) => [g.name.toLowerCase(), g]));
  const made = new Map<string, GroupRef>();
  return (id: number | null, name: string): GroupRef => {
    const key = id !== null ? `${level}:id:${id}` : `${level}:name:${name.toLowerCase()}`;
    const done = made.get(key);
    if (done) return done;
    let ref: GroupRef;
    const hit = id !== null ? byMl.get(id) ?? byName.get(name.toLowerCase()) : byName.get(name.toLowerCase()) ?? dms.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (!hit) ref = { key, dmsId: null, myloansId: id, name, kind: "new" };
    else if (name && hit.name !== name) ref = { key, dmsId: hit.id, myloansId: id ?? hit.myloansId, name, kind: "renamed", was: hit.name };
    else ref = { key, dmsId: hit.id, myloansId: id ?? hit.myloansId, name: hit.name, kind: "same" };
    made.set(key, ref);
    return ref;
  };
}

/**
 * The difference between a MyLoans list and the DMS. `full`: the list is the whole MyLoans list (a file
 * or a full API read), so branches it lacks are "Not in the last list"; an incremental read never says so.
 */
export function diffBranches(rows: (MyLoansBranchRow & { line?: number })[], dms: DmsState, o: { full: boolean }): BranchDiff {
  const division = groupResolver("division", dms.divisions);
  const area = groupResolver("area", dms.areas);
  const byMlId = new Map(dms.branches.filter((b) => b.myloansBranchId !== null).map((b) => [b.myloansBranchId!, b]));
  const byCode = new Map(dms.branches.filter((b) => b.code).map((b) => [b.code!, b]));
  const byName = new Map(dms.branches.map((b) => [b.name.toLowerCase(), b]));
  const divName = new Map(dms.divisions.map((d) => [d.id, d.name]));
  const areaName = new Map(dms.areas.map((a) => [a.id, a.name]));
  const matched = new Set<string>();
  const items: DiffItem[] = [];

  for (const row of rows) {
    const d = division(row.divisionId, row.divisionName);
    const a = area(row.areaId, row.areaName);
    let b: DmsBranch | undefined;
    let matchedBy: DiffItem["matchedBy"] = null;
    if (row.branchId !== null && byMlId.has(row.branchId)) { b = byMlId.get(row.branchId); matchedBy = "id"; }
    if (!b) {
      // The code only when one side has no MyLoans id (a hand-made or "Code needed" branch, or a list without ids).
      const c = byCode.get(row.code);
      if (c && !matched.has(c.id) && (c.myloansBranchId === null || row.branchId === null)) { b = c; matchedBy = "code"; }
    }
    if (!b) {
      const n = byName.get(row.name.toLowerCase());
      if (n && !matched.has(n.id) && n.myloansBranchId === null && (!n.code || n.code === row.code)) { b = n; matchedBy = "name"; }
    }
    const testLike = looksLikeTestBranch(row);
    const base = { row, division: d, area: a, suggestHide: testLike, note: testLike ? TEST_BRANCH_NOTE : "" };
    if (!b) {
      items.push({ ...base, status: "new", branchId: null, matchedBy: null, kind: "NEW_BRANCH", kinds: ["NEW_BRANCH"], fields: [], importActive: row.active ?? !testLike });
      continue;
    }
    matched.add(b.id);
    const fields: FieldChange[] = [];
    const kinds = new Set<ReviewKind>();
    if (b.code !== row.code) { fields.push({ field: "code", label: "Code", was: b.code ?? "(none)", now: row.code }); kinds.add("CODE_CHANGED"); }
    if (b.name !== row.name) { fields.push({ field: "name", label: "Name", was: b.name, now: row.name }); kinds.add("RENAMED"); }
    if ((b.address ?? "") !== row.address && row.address) { fields.push({ field: "address", label: "Address", was: b.address || "(none)", now: row.address }); kinds.add("DETAILS_CHANGED"); }
    if (row.active !== null && row.active !== b.active) { fields.push({ field: "active", label: "Status", was: yesNo(b.active), now: yesNo(row.active) }); kinds.add(row.active ? "REOPENED" : "CLOSED"); }
    if (d.dmsId !== b.divisionId || d.kind === "new") { fields.push({ field: "division", label: "Division", was: (b.divisionId && divName.get(b.divisionId)) || "(none)", now: d.name }); kinds.add("MOVED"); }
    if (a.dmsId !== b.areaId || a.kind === "new") { fields.push({ field: "area", label: "Area", was: (b.areaId && areaName.get(b.areaId)) || "(none)", now: a.name }); kinds.add("MOVED"); }
    // A branch made by hand that MyLoans now lists: it becomes a MyLoans branch (gets the id).
    const adopt = b.source !== "MYLOANS" || (row.branchId !== null && b.myloansBranchId !== row.branchId);
    const list = KIND_ORDER.filter((k) => kinds.has(k));
    const status = list.length || adopt ? "changed" : "unchanged";
    items.push({ ...base, status, branchId: b.id, matchedBy, kind: list[0] ?? (adopt ? "DETAILS_CHANGED" : null), kinds: list, fields, importActive: row.active ?? b.active });
  }

  const missing = o.full ? dms.branches.filter((b) => !matched.has(b.id) && b.source === "MYLOANS" && b.active && !b.hidden) : [];
  const groups = new Map<string, GroupRef & { level: "area" | "division" }>();
  for (const it of items) {
    for (const [level, g] of [["division", it.division], ["area", it.area]] as const) if (g.kind !== "same") groups.set(g.key, { ...g, level });
  }
  const per = new Map<string, { division: string; area: string; total: number; new: number; changed: number }>();
  for (const it of items) {
    const k = `${it.division.name}\u0000${it.area.name}`;
    const p = per.get(k) ?? { division: it.division.name, area: it.area.name, total: 0, new: 0, changed: 0 };
    p.total++;
    if (it.status === "new") p.new++;
    if (it.status === "changed") p.changed++;
    per.set(k, p);
  }
  // Test-looking rows first, then new, changed, unchanged; by code inside each.
  const rank = (i: DiffItem) => (i.suggestHide && i.status !== "unchanged" ? 0 : i.status === "new" ? 1 : i.status === "changed" ? 2 : 3);
  items.sort((x, y) => rank(x) - rank(y) || x.row.code.localeCompare(y.row.code));
  return {
    items,
    missing,
    newGroups: [...groups.values()].filter((g) => g.kind === "new"),
    renamedGroups: [...groups.values()].filter((g) => g.kind === "renamed"),
    counts: {
      new: items.filter((i) => i.status === "new").length,
      changed: items.filter((i) => i.status === "changed").length,
      unchanged: items.filter((i) => i.status === "unchanged").length,
      missing: missing.length,
      suggestions: items.filter((i) => i.suggestHide && i.status === "new").length,
    },
    perGroup: [...per.values()].sort((x, y) => x.division.localeCompare(y.division) || x.area.localeCompare(y.area)),
  };
}

/** A stable fingerprint of what MyLoans says about one branch (only differences reach the review). */
export function branchRowHash(r: MyLoansBranchRow): string {
  const s = [r.branchId ?? "", r.code, r.name, r.address, r.active ?? "", r.divisionId ?? r.divisionName, r.areaId ?? r.areaName].join("\u0001");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
