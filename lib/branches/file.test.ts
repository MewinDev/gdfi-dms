import { describe, expect, it } from "vitest";
import { branchTemplateCsv, looksLikeTestBranch, parseBranchFile, splitDelimited, statusValue } from "./file";

const DUMP = [
  "1\tBranch Division\t1\tLUZON 1 (NGMA + RIZAL)\t5\t101\t77436381\tAntipolo\tUnit 6 FLJ Building P. Oliveros St. Brgy. Dela Paz Antipolo City",
  "2\tCar Financing Division\t10\tLuzon 1 - CFD\t439\t189\tNULL\tAngono - Car Financing\tNULL",
  "1\tBranch Division\t1\tLUZON 1 (NGMA + RIZAL)\t209\t999\t\tTest Branch\t",
].join("\r\n");

describe("parseBranchFile: the MyLoans dump (tab-separated, no header)", () => {
  it("reads the columns in order, drops the unknown column and NULLs", () => {
    const f = parseBranchFile(DUMP);
    expect(f.shape).toBe("dump");
    expect(f.delimiter).toBe("tab");
    expect(f.problems).toEqual([]);
    expect(f.rows[0]).toMatchObject({ divisionId: 1, divisionName: "Branch Division", areaId: 1, areaName: "LUZON 1 (NGMA + RIZAL)", branchId: 5, code: "101", name: "Antipolo", active: null, updatedAt: null });
    expect(f.rows[1]).toMatchObject({ code: "189", address: "", branchId: 439, areaId: 10 });
    // The unknown 8-digit column is never kept, under any name.
    expect(JSON.stringify(f.rows)).not.toContain("77436381");
    expect(Object.keys(f.rows[0])).not.toContain("contact");
  });
  it("a row with too few columns is a problem, the others are read", () => {
    const f = parseBranchFile(`${DUMP}\n1\tBranch Division\t1`);
    expect(f.rows).toHaveLength(3);
    expect(f.problems).toEqual([{ line: 4, message: expect.stringMatching(/Expected 9 columns/) }]);
  });
});

describe("parseBranchFile: a file with a header row", () => {
  it("myloans-branches.csv shape: quoted addresses with commas, contact ignored", () => {
    const csv = "﻿division_id,division,area_id,area,branch_id,code,contact,name,address\r\n"
      + '1,Branch Division,6,EAST VISAYAS,6,414,97515197,Antique,"2nd floor C.R. Building, T.A. Fornier St., San Jose Antique"\r\n'
      + '1,Branch Division,6,EAST VISAYAS,213,471,,Bacolod - Team 2,"Room 203 ""VSB"" Bldg., Bacolod City"\r\n';
    const f = parseBranchFile(csv);
    expect(f.shape).toBe("header");
    expect(f.delimiter).toBe("comma");
    expect(f.rows.map((r) => r.address)).toEqual(["2nd floor C.R. Building, T.A. Fornier St., San Jose Antique", 'Room 203 "VSB" Bldg., Bacolod City']);
    expect(JSON.stringify(f.rows)).not.toContain("97515197");
  });
  it("aliases, is_active and updated_at; a tab inside a quoted cell", () => {
    const tsv = "division_name\tarea_name\tbranch_code\tbranch_name\taddress\tis_active\tupdated_at\nBranch Division\tLUZON 3 NORTH\t718\tAlicia-Inactive\t\"Main St\tAlicia\"\t0\t2026-06-09T08:00:00Z\n";
    const f = parseBranchFile(tsv);
    expect(f.rows[0]).toMatchObject({ divisionId: null, divisionName: "Branch Division", areaName: "LUZON 3 NORTH", branchId: null, code: "718", name: "Alicia-Inactive", address: "Main St Alicia", active: false, updatedAt: "2026-06-09T08:00:00.000Z" });
  });
  it("problems per line: bad code, no name, bad status, duplicate code or id", () => {
    const csv = "branch_id,code,name,status\n1,10,Short,Active\n2,101,,Active\n3,102,Bad status,Maybe\n4,103,Ok,Active\n5,103,Twin code,\n4,104,Twin id,\n";
    const f = parseBranchFile(csv);
    expect(f.rows.map((r) => r.code)).toEqual(["103"]);
    expect(f.problems.map((p) => p.line)).toEqual([2, 3, 4, 6, 7]);
    expect(f.problems[0].message).toMatch(/not 3 digits/);
    expect(f.problems[1].message).toMatch(/no branch name/);
    expect(f.problems[2].message).toMatch(/not Active or Inactive/);
    expect(f.problems[3].message).toMatch(/also on line 5/);
    expect(f.problems[4].message).toMatch(/branch_id 4 is also on line 5/);
  });
  it("a header without code or name is refused", () => {
    expect(parseBranchFile("division,area\nX,Y\n").problems[0].message).toMatch(/no code or name column/);
  });
  it("Windows-1252 bytes (Excel) are read: Sto Niño", () => {
    const text = "code,name,address\n753,Plaridel-DONT USE,Barangay Sto Niño Plaridel\n";
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0))); // ñ as 0xF1, not UTF-8
    expect(parseBranchFile(bytes).rows[0].address).toBe("Barangay Sto Niño Plaridel");
    expect(parseBranchFile(new TextEncoder().encode(text)).rows[0].address).toBe("Barangay Sto Niño Plaridel");
  });
  it("the template reads back with no problems", () => {
    const f = parseBranchFile(branchTemplateCsv());
    expect(f.problems).toEqual([]);
    expect(f.rows.map((r) => r.code)).toEqual(["101", "189"]);
  });
});

describe("status values and splitting", () => {
  it("status words", () => {
    for (const v of ["Active", "1", "true", "yes"]) expect(statusValue(v)).toBe(true);
    for (const v of ["Inactive", "0", "false", "no"]) expect(statusValue(v)).toBe(false);
    expect(statusValue("")).toBeNull();
    expect(statusValue("maybe")).toBe("bad");
  });
  it("blank lines are skipped", () => {
    expect(splitDelimited("a,b\n\n,\nc,d\n", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("looksLikeTestBranch (only a suggestion to hide)", () => {
  it("the four test or unused rows of the real list", () => {
    expect(looksLikeTestBranch({ name: "Makati A", address: "Test Only 01072020", code: "213" })).toBe(true);
    expect(looksLikeTestBranch({ name: "Test Branch", address: "", code: "999" })).toBe(true);
    expect(looksLikeTestBranch({ name: "Bacoor(DONT USE)", address: "Molino 3 Bacoor City", code: "721" })).toBe(true);
    expect(looksLikeTestBranch({ name: "Plaridel-DONT USE", address: "Plaridel Bulacan", code: "753" })).toBe(true);
    expect(looksLikeTestBranch({ name: "Don't use", address: "", code: "500" })).toBe(true);
  });
  it("real branches are not", () => {
    for (const name of ["Antipolo", "Angono - Car Financing", "Alicia-Inactive", "Testa Verde"]) expect(looksLikeTestBranch({ name, address: "Main St", code: "101" })).toBe(false);
  });
});
