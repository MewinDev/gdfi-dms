import { describe, expect, it } from "vitest";
import { IMPORT_LISTS, IMPORT_LIST_KEYS, EXAMPLE_NOTE, MAX_ROWS, columnNames, templateFileName } from "./columns";
import { looksLikeFormula, parseCsv, toCsv } from "./csv";
import { readImportFile, templateCsv } from "./importer";

describe("CSV", () => {
  it("writes UTF-8 with BOM and reads it back (quotes, commas, accents, CRLF)", () => {
    const csv = toCsv(["code", "name"], [{ code: "QC", name: 'Quezon City, "Main"' }, { code: "PN", name: "Peñaranda ₱" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(parseCsv(csv)).toEqual([["code", "name"], ["QC", 'Quezon City, "Main"'], ["PN", "Peñaranda ₱"]]);
  });

  it("reads LF files and a last line without a newline", () => {
    expect(parseCsv("a,b\n1,2\n3,")).toEqual([["a", "b"], ["1", "2"], ["3", ""]]);
  });

  it("spots formula-looking text", () => {
    for (const v of ["=1+1", "+63", "-2", "@SUM(A1)", "  =cmd", "\t=x"]) expect(looksLikeFormula(v)).toBe(true);
    for (const v of ["Quezon City", "LTO-QC", "2027-04-09", "a=b"]) expect(looksLikeFormula(v)).toBe(false);
  });
});

describe("Template columns equal importer columns, for every list", () => {
  it.each(IMPORT_LIST_KEYS)("%s", (list) => {
    const def = IMPORT_LISTS[list];
    const rows = parseCsv(templateCsv(list));
    // First row: exactly the column names the importer reads.
    expect(rows[0]).toEqual(columnNames(list));
    // 2 or 3 example rows, each marked in the notes column.
    expect(rows.length - 1).toBeGreaterThanOrEqual(2);
    expect(rows.length - 1).toBeLessThanOrEqual(3);
    const notesAt = rows[0].indexOf("notes");
    expect(notesAt).toBeGreaterThanOrEqual(0);
    for (const r of rows.slice(1)) expect(r[notesAt]).toBe(EXAMPLE_NOTE);
    // The importer accepts the template's header (no unknown or missing columns).
    const read = readImportFile(list, templateCsv(list));
    expect("records" in read ? read.records.length : read.error).toBe(def.examples.length);
    // Every key column is a real, required column.
    for (const k of def.keyColumns) expect(def.columns.find((c) => c.name === k)).toBeTruthy();
    expect(templateFileName(list)).toBe(`gdfi-dms-template-${def.slug}.csv`);
  });
});

describe("Reading a file", () => {
  it("refuses changed column names, plainly", () => {
    const r = readImportFile("branches", "code,branch_name\nQC,Quezon City\n");
    expect("error" in r && r.error).toMatch(/column this list does not use: "branch_name"/);
    const m = readImportFile("branches", "code\nQC\n");
    expect("error" in m && m.error).toMatch(/missing the column "name"/);
  });

  it("refuses formula-looking text in text columns, with row and column", () => {
    const r = readImportFile("branches", "code,name\nQC,Quezon City\nZZ,=HYPERLINK(\"x\")\n");
    expect("error" in r && r.error).toMatch(/^Row 3, Branch name: .*formula/);
  });

  it("refuses more than the row limit and skips blank lines", () => {
    const many = ["code,name", ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `B${i},Branch ${i}`)].join("\n");
    expect("error" in readImportFile("branches", many)).toBe(true);
    const r = readImportFile("branches", "code,name\n\nQC,Quezon City\n,\n");
    expect("records" in r && r.records.map((x) => x.line)).toEqual([3]);
  });
});
