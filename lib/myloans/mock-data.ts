import { businessDaysAgo } from "@/lib/time";
import type { MyLoansRecord } from "./types";
import { buildPn } from "@/lib/pn/format";

/**
 * Seeded MyLoans records (prompt section 9). Release dates are relative to today so the TAT
 * badges can be demonstrated (On time, Due today, Overdue) on any day the app is run.
 */
export function mockRecords(now: Date = new Date()): MyLoansRecord[] {
  const d = (n: number) => businessDaysAgo(n, now);
  // Real PN format: GD + the branch code + 2026 + 9 + a running number (GD1012026901001 is Antipolo's 1001).
  const base = (i: number, over: Partial<MyLoansRecord>): MyLoansRecord => ({
    pn: buildPn(over.branchCode ?? "101", 2026, 1000 + i),
    cin: `CIN-77${String(1000 + i)}`,
    cif: `CIF-55${String(1000 + i)}`,
    sourceLoanId: `ML-${2026_00_000 + i}`,
    borrowerName: "",
    branchName: "Antipolo",
    branchCode: "101",
    status: "RELEASED",
    loanType: "New",
    productName: "Auto Financing",
    totalReleasedAmount: 400_000,
    releaseDate: d(0),
    vehicle: { plateNo: `NAB ${1000 + i}`, engineNo: `ENG-${90000 + i}`, chassisNo: `CHS-${70000 + i}`, make: "Toyota Vios" },
    ...over,
  });

  return [
    base(1, { borrowerName: "Maria Santos", productName: "Auto Refinancing", totalReleasedAmount: 450_000, releaseDate: d(0) }),
    base(2, { borrowerName: "Jose Reyes", productName: "Auto Financing", totalReleasedAmount: 300_000, releaseDate: d(1) }),
    base(3, { borrowerName: "Ana Villanueva", branchName: "Angono", branchCode: "165", loanType: "Renewal", totalReleasedAmount: 1_000_000, releaseDate: d(2) }),
    base(4, { borrowerName: "Ramon Garcia", branchName: "Angono", branchCode: "165", loanType: "Renewal", totalReleasedAmount: 1_250_000, releaseDate: d(3) }),
    base(5, { borrowerName: "Liza Mendoza", productName: "Auto Finance", totalReleasedAmount: 600_000, releaseDate: d(0) }),
    base(6, { borrowerName: "Pedro Bautista", loanType: "Renewal", productName: "", totalReleasedAmount: 800_000, releaseDate: d(1) }),
    base(7, { borrowerName: "Carmen Aquino", branchName: "Alaminos", branchCode: "390", totalReleasedAmount: 400_000 }),
    base(8, { borrowerName: "Roberto Cruz", branchName: "Angono", branchCode: "165", status: "PENDING", totalReleasedAmount: 400_000 }),
    base(9, { borrowerName: "Elena Ramos", branchName: "Angono", branchCode: "165", loanType: "Restructured", totalReleasedAmount: 400_000 }),
    base(10, { borrowerName: "Manuel Torres", branchName: "Angono", branchCode: "165", totalReleasedAmount: 0 }),
    base(11, { borrowerName: "Teresa Flores", branchName: "Angono", branchCode: "165", totalReleasedAmount: 400_000, releaseDate: null }),
  ];
}
