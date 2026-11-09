import type { MyLoansBranchRow } from "./file";

/**
 * A small built-in subset of the real MyLoans branch list (ids, codes, names, areas and divisions as
 * MyLoans has them; no addresses). Used when storage/kit/myloans-branches.csv is not there, by the seed
 * of a test or local database, by the sample MyLoans (mock) and by every automated test, which never
 * depend on the real file.
 *
 * 12 branches in 3 divisions. Area 12 "Luzon 3 - CFD" and area 15 "Luzon 1 - TFD" appear under two
 * divisions, as in MyLoans. Alicia-Inactive (718) is on the MyLoans admin screen as Inactive but not in
 * the database export, so it has no MyLoans id here.
 */
const r = (divisionId: number, divisionName: string, areaId: number, areaName: string, branchId: number | null, code: string, name: string, active: boolean | null = null): MyLoansBranchRow =>
  ({ divisionId, divisionName, areaId, areaName, branchId, code, name, address: "", active, updatedAt: null });

const BD = "Branch Division";
const CFD = "Car Financing Division";
const TFD = "Truck Financing Division";
const L1 = "LUZON 1 (NGMA + RIZAL)";
const L3N = "LUZON 3 NORTH";

export const BUILTIN_BRANCHES: MyLoansBranchRow[] = [
  r(1, BD, 1, L1, 5, "101", "Antipolo"),
  r(1, BD, 1, L1, 4, "165", "Angono"),
  r(1, BD, 1, L1, 207, "168", "A. Mabini"),
  r(1, BD, 1, L1, 3, "174", "Amang Rodriguez"),
  r(1, BD, 4, L3N, 1, "390", "Alaminos"),
  r(1, BD, 4, L3N, 398, "709", "Alicia"),
  r(1, BD, 4, L3N, null, "718", "Alicia-Inactive", false),
  r(1, BD, 12, "Luzon 3 - CFD", 319, "707", "Laoag - Team 1"),
  r(1, BD, 15, "Luzon 1 - TFD", 301, "288", "Imus - Truck Financing"),
  r(2, CFD, 10, "Luzon 1 - CFD", 439, "189", "Angono - Car Financing"),
  r(2, CFD, 12, "Luzon 3 - CFD", 184, "379", "Baguio - Car Financing"),
  r(3, TFD, 15, "Luzon 1 - TFD", 197, "156", "Head Office - Truck Financing"),
];

/** The LTO office each sample branch uses by default (seed of a test or local database). */
export const BUILTIN_USUAL_LTO: Record<string, string> = { "101": "LTO-QC", "165": "LTO-CEB", "390": "LTO-DVO", "168": "LTO-MKT", "174": "LTO-EAST", "189": "LTO-CEB" };

/** Where the real file goes (Git ignores storage/). */
export const KIT_BRANCH_FILE = "storage/kit/myloans-branches.csv";
