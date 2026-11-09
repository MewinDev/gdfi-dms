/**
 * The MyLoans branch list as a file (Settings, Branches, Import from MyLoans; the kit; the mock).
 * Pure (no database), so the browser, the server and the tests read files the same way.
 *
 * Two shapes are accepted and detected:
 *  1. The tab-separated dump exactly as MyLoans gave it, no header row, columns in this order:
 *     division_id, division_name, area_id, area_name, branch_id, branch_code, (unknown), branch_name, address
 *  2. A comma- or tab-separated file WITH a header row, e.g. the supplied myloans-branches.csv:
 *     division_id, division, area_id, area, branch_id, code, contact, name, address
 *     (aliases: division_name, area_name, branch_code, branch_name; optional is_active / status, updated_at).
 * The unknown 8-digit column ("contact" in the header file) is dropped here and never stored or shown.
 */

export interface MyLoansBranchRow {
  divisionId: number | null;
  divisionName: string;
  areaId: number | null;
  areaName: string;
  branchId: number | null;
  /** 3 digits. */
  code: string;
  name: string;
  address: string;
  /** null: the file has no status (imported as Active, unless it looks like a test or unused branch). */
  active: boolean | null;
  /** MyLoans updated_at, ISO, when the file or API gives it. */
  updatedAt: string | null;
}

export interface BranchFileProblem { line: number; message: string }

export interface BranchFile {
  shape: "dump" | "header";
  delimiter: "tab" | "comma";
  rows: (MyLoansBranchRow & { line: number })[];
  problems: BranchFileProblem[];
}

export const MAX_BRANCH_ROWS = 5000;
export const BRANCH_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** The template header (Settings, Branches, Import from MyLoans). */
export const BRANCH_FILE_HEADER = ["division_id", "division", "area_id", "area", "branch_id", "code", "name", "address", "is_active", "updated_at"];

/** Bytes to text: UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (what Excel saves). */
export function decodeBranchFile(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** Delimited text to rows of cells: quoted cells with commas, tabs, "" and new lines; CRLF and LF. */
export function splitDelimited(text: string, sep: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const ALIASES: Record<string, keyof MyLoansBranchRow | "skip"> = {
  division_id: "divisionId", divisionid: "divisionId",
  division: "divisionName", division_name: "divisionName", divisionname: "divisionName",
  area_id: "areaId", areaid: "areaId",
  area: "areaName", area_name: "areaName", areaname: "areaName",
  branch_id: "branchId", branchid: "branchId", id: "branchId",
  code: "code", branch_code: "code", branchcode: "code",
  name: "name", branch_name: "name", branchname: "name", branch: "name",
  address: "address",
  is_active: "active", isactive: "active", active: "active", status: "active",
  updated_at: "updatedAt", updatedat: "updatedAt", modified_at: "updatedAt",
  // The unknown 8-digit column: read past it, never stored.
  contact: "skip",
};

const DUMP_ORDER: (keyof MyLoansBranchRow | "skip")[] = ["divisionId", "divisionName", "areaId", "areaName", "branchId", "code", "skip", "name", "address"];

const clean = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t.toUpperCase() === "NULL" ? "" : t;
};
const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

/** "Active", "1", "true", "yes" -> true; "Inactive", "0", "false", "no" -> false; blank -> null. */
export function statusValue(v: string): boolean | null | "bad" {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["active", "1", "true", "yes", "y", "a"].includes(t)) return true;
  if (["inactive", "0", "false", "no", "n", "i", "closed"].includes(t)) return false;
  return "bad";
}

/** Reads a MyLoans branch file (either shape). Rows with a problem are listed, not imported. */
export function parseBranchFile(input: string | Uint8Array): BranchFile {
  const text = typeof input === "string" ? input.replace(/^﻿/, "") : decodeBranchFile(input);
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = first.includes("\t") ? "tab" : "comma";
  const grid = splitDelimited(text, delimiter === "tab" ? "\t" : ",");
  const problems: BranchFileProblem[] = [];
  const rows: BranchFile["rows"] = [];
  if (!grid.length) return { shape: "dump", delimiter, rows, problems: [{ line: 1, message: "The file is empty." }] };

  const head = grid[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const isHeader = !/^\d+$/.test(clean(grid[0][0])) && head.some((h) => Object.hasOwn(ALIASES, h));
  let columns: (keyof MyLoansBranchRow | "skip" | null)[];
  if (isHeader) {
    columns = head.map((h) => ALIASES[h] ?? null);
    const missing = (["code", "name"] as const).filter((k) => !columns.includes(k));
    if (missing.length) return { shape: "header", delimiter, rows, problems: [{ line: 1, message: `The header row has no ${missing.join(" or ")} column.` }] };
  } else {
    columns = DUMP_ORDER;
  }
  const body = isHeader ? grid.slice(1) : grid;
  if (body.length > MAX_BRANCH_ROWS) return { shape: isHeader ? "header" : "dump", delimiter, rows, problems: [{ line: 1, message: `The file has ${body.length} rows; at most ${MAX_BRANCH_ROWS} can be imported at once.` }] };

  const seenCode = new Map<string, number>();
  const seenId = new Map<number, number>();
  body.forEach((cells, i) => {
    const line = i + (isHeader ? 2 : 1);
    const get = (k: keyof MyLoansBranchRow) => { const at = columns.indexOf(k); return at < 0 ? "" : clean(cells[at]); };
    if (!isHeader && cells.length < 8) { problems.push({ line, message: `Expected 9 columns (division_id ... address), found ${cells.length}.` }); return; }
    const code = get("code");
    const name = get("name");
    const st = statusValue(get("active"));
    const why: string[] = [];
    if (!/^[1-9]\d{2}$/.test(code)) why.push(code ? `branch code "${code}" is not 3 digits (100 to 999)` : "no branch code");
    if (!name) why.push("no branch name");
    if (st === "bad") why.push(`status "${get("active")}" is not Active or Inactive`);
    const updatedRaw = get("updatedAt");
    const updated = updatedRaw && !Number.isNaN(Date.parse(updatedRaw)) ? new Date(updatedRaw).toISOString() : null;
    if (updatedRaw && !updated) why.push(`updated_at "${updatedRaw}" is not a date`);
    const branchId = int(get("branchId"));
    if (!why.length) {
      const dupCode = seenCode.get(code);
      if (dupCode) why.push(`branch code ${code} is also on line ${dupCode}`);
      if (branchId !== null && seenId.has(branchId)) why.push(`branch_id ${branchId} is also on line ${seenId.get(branchId)}`);
    }
    if (why.length) { problems.push({ line, message: why.join("; ") }); return; }
    seenCode.set(code, line);
    if (branchId !== null) seenId.set(branchId, line);
    rows.push({
      line, divisionId: int(get("divisionId")), divisionName: get("divisionName"), areaId: int(get("areaId")), areaName: get("areaName"),
      branchId, code, name, address: get("address"), active: st === "bad" ? null : st, updatedAt: updated,
    });
  });
  return { shape: isHeader ? "header" : "dump", delimiter, rows, problems };
}

/**
 * A row that looks like a test or unused branch: the name has "test", "don't use" or "dont use", the
 * address says "Test Only", or the code is 999. Only a suggestion: Admin decides; nothing is hidden by itself.
 */
export function looksLikeTestBranch(r: Pick<MyLoansBranchRow, "name" | "address" | "code">): boolean {
  const n = r.name.toLowerCase();
  return /\btest\b/.test(n) || /don'?t\s*use/.test(n) || /\btest only\b/i.test(r.address) || r.code === "999";
}

export const TEST_BRANCH_NOTE = "Looks like a test or unused branch";

/** The template file for Import from MyLoans (comma-separated, with the header row). */
export function branchTemplateCsv(): string {
  const ex = [
    ["1", "Branch Division", "1", "LUZON 1 (NGMA + RIZAL)", "5", "101", "Antipolo", "Unit 6 FLJ Building P. Oliveros St. Brgy. Dela Paz Antipolo City", "Active", ""],
    ["2", "Car Financing Division", "10", "Luzon 1 - CFD", "439", "189", "Angono - Car Financing", "", "Active", ""],
  ];
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [BRANCH_FILE_HEADER, ...ex].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
