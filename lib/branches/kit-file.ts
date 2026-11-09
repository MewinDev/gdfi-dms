import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { databaseName } from "@/lib/env/load-files";
import { BUILTIN_BRANCHES, KIT_BRANCH_FILE } from "./builtin";
import { parseBranchFile, type MyLoansBranchRow } from "./file";

/**
 * The real MyLoans branch list for the Manual Test Kit and the sample MyLoans: storage/kit/myloans-branches.csv
 * (Git ignores storage/; never commit it). Only on the kit's own database (gdfi_dms): a test database
 * (any name with "test") and the automated tests always use the built-in subset, so no test depends on it.
 */
export function kitBranchFilePath(): string {
  return path.resolve(KIT_BRANCH_FILE);
}

export function kitBranchFileUsable(): boolean {
  const db = databaseName(process.env.DATABASE_URL) ?? "";
  return !process.env.VITEST && !/test/i.test(db) && existsSync(kitBranchFilePath());
}

/** The real list when usable, otherwise null. Rows with a problem are left out (the kit says how many). */
export function readKitBranchFile(): { rows: MyLoansBranchRow[]; problems: number } | null {
  if (!kitBranchFileUsable()) return null;
  const f = parseBranchFile(new Uint8Array(readFileSync(kitBranchFilePath())));
  return { rows: f.rows, problems: f.problems.length };
}

/** The sample MyLoans branch list: the real file on the kit database, else the built-in subset. */
export function sampleBranchRows(): MyLoansBranchRow[] {
  return readKitBranchFile()?.rows ?? BUILTIN_BRANCHES;
}
