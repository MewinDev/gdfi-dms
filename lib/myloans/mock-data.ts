import { businessDaysAgo } from "@/lib/time";
import type { MyLoansRecord } from "./types";

/**
 * Seeded MyLoans records (prompt section 9). Release dates are relative to today so the TAT
 * badges can be demonstrated (On time, Due today, Overdue) on any day the app is run.
 */
export function mockRecords(now: Date = new Date()): MyLoansRecord[] {
  const d = (n: number) => businessDaysAgo(n, now);
  const base = (i: number, over: Partial<MyLoansRecord>): MyLoansRecord => ({
    pn: `PN-000${1000 + i}`,
    cin: `CIN-77${String(1000 + i)}`,
    cif: `CIF-55${String(1000 + i)}`,
    sourceLoanId: `ML-${2026_00_000 + i}`,
    borrowerName: "",
    branchName: "Quezon City",
    branchCode: "QC",
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
    base(3, { borrowerName: "Ana Villanueva", branchName: "Cebu", branchCode: "CEB", loanType: "Renewal", totalReleasedAmount: 1_000_000, releaseDate: d(2) }),
    base(4, { borrowerName: "Ramon Garcia", branchName: "Cebu", branchCode: "CEB", loanType: "Renewal", totalReleasedAmount: 1_250_000, releaseDate: d(3) }),
    base(5, { borrowerName: "Liza Mendoza", productName: "Auto Finance", totalReleasedAmount: 600_000, releaseDate: d(0) }),
    base(6, { borrowerName: "Pedro Bautista", loanType: "Renewal", productName: "", totalReleasedAmount: 800_000, releaseDate: d(1) }),
    base(7, { borrowerName: "Carmen Aquino", branchName: "Davao", branchCode: "DVO", totalReleasedAmount: 400_000 }),
    base(8, { borrowerName: "Roberto Cruz", branchName: "Cebu", branchCode: "CEB", status: "PENDING", totalReleasedAmount: 400_000 }),
    base(9, { borrowerName: "Elena Ramos", branchName: "Cebu", branchCode: "CEB", loanType: "Restructured", totalReleasedAmount: 400_000 }),
    base(10, { borrowerName: "Manuel Torres", branchName: "Cebu", branchCode: "CEB", totalReleasedAmount: 0 }),
    base(11, { borrowerName: "Teresa Flores", branchName: "Cebu", branchCode: "CEB", totalReleasedAmount: 400_000, releaseDate: null }),
  ];
}
