import { describe, expect, it } from "vitest";
import { composeBorrowerName } from "./borrower-name";
import { statusFromId, statusLabel } from "./status";
import { mapLoan } from "./live-mapping";
import { detectChanges, FIELDS, trackedOf, trackedOfSaved } from "./changes";
import { accountColumns, accountWarnings } from "./account";
import { completeSample } from "./mock-account";
import { runDataCheck } from "./data-check";
import type { MyLoansRecord } from "./types";

/** One row of the MyLoans source query (docs/myloans/released-loans-source.sql), by its column aliases. */
const row = (over: Record<string, unknown> = {}) => ({
  ExternalLoanId: 88123, CIN: "CIN-0001", PNNo: "GD1012026901001", TransactionStatusId: 12, TransactionIsActive: 1,
  CIFNo: "CIF-0001", TitleId: 3, FirstName: "Maria", MiddleName: "Cruz", LastName: "Santos", Suffix: null, BirthDate: "1980-01-01",
  LoanID: 501, LoanTypeId: 7, LoanType: "New", BorrowerCompanyName: null, TotalLoanAmount: 450000, ReleaseDate: "2026-11-02T00:00:00",
  ProductID: 9, ProductCode: "ARF-001", ProductName: "Auto Refinancing", CompanyID: 1, CompanyName: "Global Dominion Financing Inc.",
  DivisionId: 1, DivisionName: "Branch Division", AreaId: 1, AreaName: "LUZON 1 (NGMA + RIZAL)", BranchID: 5, BranchCode: "101", BranchName: "Antipolo",
  SourceUpdatedAt: "2026-11-03T09:15:00+08:00", ...over,
});
const today = { allowedBranches: null, today: "2026-11-11" };

describe("borrower name", () => {
  it("is First Middle Last Suffix, empty parts skipped, spaces collapsed", () => {
    expect(composeBorrowerName({ first: "Maria", middle: "Cruz", last: "Santos", suffix: "Jr." })).toBe("Maria Cruz Santos Jr.");
    expect(composeBorrowerName({ first: " Jose ", middle: "", last: "Reyes", suffix: null })).toBe("Jose Reyes");
    expect(composeBorrowerName({ first: "Ana  Marie", middle: undefined, last: "  dela   Cruz ", suffix: " " })).toBe("Ana Marie dela Cruz");
  });
  it("is the company name when the personal parts are empty", () => {
    expect(composeBorrowerName({ first: "", middle: null, last: " ", suffix: "", company: "ABC Trucking Corp." })).toBe("ABC Trucking Corp.");
    expect(composeBorrowerName({ first: "Lito", last: "Ramos", company: "ABC Trucking Corp." })).toBe("Lito Ramos");
    expect(composeBorrowerName({})).toBe("");
  });
});

describe("status", () => {
  it("12 is Loan Released (released)", () => {
    expect(statusFromId(12)).toEqual({ status: "RELEASED", statusId: "12", statusName: "Loan Released" });
  });
  it("an unknown number shows as Status N and is not released", () => {
    expect(statusFromId(7)).toEqual({ status: "STATUS_7", statusId: "7", statusName: "Status 7" });
    expect(statusFromId("7", "Cancelled")).toEqual({ status: "STATUS_7", statusId: "7", statusName: "Cancelled" });
    expect(runDataCheck(mapLoan(row({ TransactionStatusId: 7 }))!, today)).toMatchObject({ ok: false, field: "status" });
  });
  it("the label is the name, the number only when no name is known", () => {
    expect(statusLabel({ statusId: "12" })).toBe("Loan Released");
    expect(statusLabel({ status: "RELEASED" })).toBe("Loan Released");
    expect(statusLabel({ status: "CANCELLED" })).toBe("Cancelled");
    expect(statusLabel({ statusId: "9", statusName: null })).toBe("Status 9");
  });
});

describe("live mapping: every alias of the source query", () => {
  it("maps each column alias to the record", () => {
    expect(mapLoan(row())).toMatchObject({
      pn: "GD1012026901001", sourceLoanId: "88123", cin: "CIN-0001", cif: "CIF-0001", borrowerName: "Maria Cruz Santos",
      totalReleasedAmount: 450000, releaseDate: "2026-11-02", loanType: "New", productName: "Auto Refinancing", productCode: "ARF-001",
      branchCode: "101", branchName: "Antipolo", areaId: "1", areaName: "LUZON 1 (NGMA + RIZAL)", divisionId: "1", divisionName: "Branch Division",
      companyId: "1", companyName: "Global Dominion Financing Inc.", status: "RELEASED", statusId: "12", statusName: "Loan Released",
      isActive: true, sourceUpdatedAt: "2026-11-03T09:15:00+08:00",
    });
  });
  it("never reads BirthDate or TitleId", () => {
    const values = Object.values(mapLoan(row({ TitleId: "TITLE-X" }))!).map(String);
    expect(values).not.toContain("1980-01-01");
    expect(values).not.toContain("TITLE-X");
  });
  it("uses the company name when the borrower is a company; TransactionStatusName when MyLoans sends it", () => {
    const r = mapLoan(row({ FirstName: null, MiddleName: null, LastName: null, BorrowerCompanyName: "ABC Trucking Corp.", TransactionStatusName: "Released" }))!;
    expect(r.borrowerName).toBe("ABC Trucking Corp.");
    expect(r.statusName).toBe("Released");
    expect(mapLoan(row({ TransactionIsActive: 0 }))!.isActive).toBe(false);
  });
  it("keeps raw values: a bad amount stays bad", () => {
    expect(mapLoan(row({ TotalLoanAmount: "abc" }))!.totalReleasedAmount).toBe("abc");
  });
});

describe("change classes of the account details", () => {
  const base = mapLoan(row())!;
  const cls = (over: Partial<MyLoansRecord>) => detectChanges(trackedOf(base), trackedOf({ ...base, ...over })).category;
  it("area, division and company are Minor", () => {
    expect(cls({ areaName: "LUZON 2" })).toBe("MINOR");
    expect(cls({ areaId: "2" })).toBe("MINOR");
    expect(cls({ divisionName: "Car Financing Division", divisionId: "2" })).toBe("MINOR");
    expect(cls({ companyId: "2", companyName: "Other Co." })).toBe("MINOR");
  });
  it("product code and source loan ID are Material", () => {
    expect(cls({ productCode: "AF-001" })).toBe("MATERIAL");
    expect(cls({ sourceLoanId: "99999" })).toBe("MATERIAL");
  });
  it("status ID, status name and active are Status", () => {
    expect(cls({ statusId: "13" })).toBe("STATUS");
    expect(cls({ statusName: "Loan Released (posted)" })).toBe("STATUS");
    expect(cls({ isActive: false })).toBe("STATUS");
  });
  it("the existing classes stay: borrower, CIN and CIF Minor; amount and branch Material", () => {
    expect(FIELDS.borrowerName.kind).toBe("minor");
    expect(FIELDS.cin.kind).toBe("minor");
    expect(FIELDS.cif.kind).toBe("minor");
    expect(cls({ totalReleasedAmount: 1 })).toBe("MATERIAL");
    expect(cls({ branchName: "Angono", branchCode: "165" })).toBe("MATERIAL");
  });
  it("a copy saved before these were tracked: their first appearance is no change", () => {
    const old: MyLoansRecord = { ...base };
    for (const k of ["productCode", "areaId", "areaName", "divisionId", "divisionName", "companyId", "companyName", "statusId", "statusName", "isActive"] as const) delete old[k];
    expect(detectChanges(trackedOfSaved(old), trackedOf(base)).category).toBe("NONE");
  });
});

describe("stored columns and warnings", () => {
  it("keeps every account detail as given, with Source MyLoans", () => {
    expect(accountColumns(mapLoan(row())!)).toEqual({
      source: "MyLoans", productCode: "ARF-001", sourceBranchCode: "101", sourceBranchName: "Antipolo", sourceAreaId: "1", sourceAreaName: "LUZON 1 (NGMA + RIZAL)",
      sourceDivisionId: "1", sourceDivisionName: "Branch Division", sourceCompanyId: "1", sourceCompanyName: "Global Dominion Financing Inc.",
      sourceStatusId: "12", sourceStatusName: "Loan Released", sourceIsActive: true, sourceUpdatedAt: new Date("2026-11-03T01:15:00Z"),
    });
  });
  it("missing product, area, division or company are warnings, not Data Check failures", () => {
    const r = mapLoan(row({ ProductCode: null, AreaId: null, AreaName: null, DivisionName: "", CompanyID: null }))!;
    expect(accountWarnings(r)).toEqual(["Product code is empty.", "Area is missing.", "Division is missing.", "Company is missing."]);
    expect(runDataCheck(r, today).ok).toBe(true);
    expect(accountWarnings(mapLoan(row())!)).toEqual([]);
  });
  it("every sample gets believable account details from the built-in branch list", () => {
    const s = completeSample({ pn: "GD1652026901003", cin: null, cif: null, sourceLoanId: null, borrowerName: "Ana", branchName: "Angono", branchCode: "165", status: "RELEASED", loanType: "Renewal", productName: "Auto Financing", totalReleasedAmount: 1, releaseDate: "2026-11-02" });
    expect(s).toMatchObject({ productCode: "AF-001", areaId: "1", areaName: "LUZON 1 (NGMA + RIZAL)", divisionId: "1", divisionName: "Branch Division", companyId: "1", statusId: "12", statusName: "Loan Released", isActive: true });
    const blank: MyLoansRecord = { ...s, productName: "" };
    delete blank.productCode;
    expect(completeSample(blank).productCode).toBeNull();
  });
});
