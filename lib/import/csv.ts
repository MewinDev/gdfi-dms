/** Small CSV reader/writer for Import / Export (Excel "CSV (Comma delimited)" and UTF-8 CSV). */

const BOM = "﻿";

/** Parses CSV text into rows of cells. Handles a BOM, quoted cells, "" escapes, CRLF and LF. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function quote(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Writes CSV with a UTF-8 BOM so Excel opens accents and ₱ correctly. Lines end with CRLF. */
export function toCsv(header: string[], rows: Record<string, string>[]): string {
  const lines = [header.map(quote).join(",")];
  for (const r of rows) lines.push(header.map((h) => quote(r[h] ?? "")).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Text that a spreadsheet could run as a formula (CSV injection): starts with = + - or @
 * (also after leading spaces or a tab / carriage return).
 */
export function looksLikeFormula(v: string): boolean {
  return /^[\s]*[=+\-@]/.test(v) || /^[\t\r]/.test(v);
}
