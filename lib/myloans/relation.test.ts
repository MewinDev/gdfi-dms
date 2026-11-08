import { describe, expect, it } from "vitest";
import { classifyRelation, isEnded, paymentEvidence, type RelLoan } from "./relation";

const old: RelLoan = { pn: "PN-0001003", status: "CANCELLED", productName: "Auto Financing", loanType: "Renewal", amount: 100_000_000, releaseDate: "2026-11-02", plateNo: "NAB 1003", chassisNo: "CHS-70003", engineNo: "ENG-90003", endedOn: "2026-11-05" };
const nw: RelLoan = { ...old, pn: "PN-0009100", status: "RELEASED", releaseDate: "2026-11-06", endedOn: null };

describe("classifyRelation", () => {
  it("replacement: ended in MyLoans, same details, released after it ended; shows the fields that matched", () => {
    const r = classifyRelation(old, nw);
    expect(r.kind).toBe("REPLACEMENT_CANDIDATE");
    expect(r.matched).toEqual(["Product name", "Loan type", "Amount", "Plate number", "Chassis number", "Engine number"]);
    // Within the window (no ended day known): 20 days apart.
    expect(classifyRelation({ ...old, endedOn: null }, { ...nw, releaseDate: "2026-11-22" }).kind).toBe("REPLACEMENT_CANDIDATE");
    expect(classifyRelation({ ...old, endedOn: null }, { ...nw, releaseDate: "2026-12-30" }, { windowDays: 30 })).toMatchObject({ kind: "ADDITIONAL", reason: "Released more than 30 days apart: treated as a new loan." });
  });
  it("additional: the other loan is still active, whatever the details", () => {
    expect(classifyRelation({ ...old, status: "RELEASED" }, nw)).toMatchObject({ kind: "ADDITIONAL", reason: "PN-0001003 is still active in MyLoans: a new loan for the same borrower." });
  });
  it("ended but the details differ: not a replacement", () => {
    const r = classifyRelation(old, { ...nw, amount: 120_000_000, plateNo: "NXY 9999" });
    expect(r).toMatchObject({ kind: "ADDITIONAL", mismatched: ["Amount", "Plate number"] });
    expect(classifyRelation(old, { ...nw, productName: "Auto Refinancing" }).kind).toBe("ADDITIONAL");
    expect(classifyRelation(old, { ...nw, loanType: "New" }).kind).toBe("ADDITIONAL");
  });
  it("unit numbers count only when MyLoans gives them for both; spelling and spacing ignored", () => {
    expect(classifyRelation(old, { ...nw, plateNo: null, chassisNo: null, engineNo: null }).matched).toEqual(["Product name", "Loan type", "Amount"]);
    expect(classifyRelation(old, { ...nw, productName: "  auto   financing " }).kind).toBe("REPLACEMENT_CANDIDATE");
  });
  it("ended statuses (placeholders until MyLoans confirms them)", () => {
    for (const s of ["CANCELLED", "canceled", "VOIDED", "REPLACED", "Withdrawn"]) expect(isEnded(s)).toBe(true);
    for (const s of ["RELEASED", "PENDING", null, ""]) expect(isEnded(s)).toBe(false);
    expect(classifyRelation({ ...old, status: "CLOSED_BY_CREDIT" }, nw, { endedStatuses: ["CLOSED_BY_CREDIT"] }).kind).toBe("REPLACEMENT_CANDIDATE");
  });
  it("payments: MyLoans' field when it has one, otherwise unknown (the Admin confirms)", () => {
    expect(paymentEvidence(false)).toEqual({ known: true, recorded: false, text: "No payment recorded in MyLoans" });
    expect(paymentEvidence(true)).toEqual({ known: true, recorded: true, text: "Payment recorded in MyLoans" });
    expect(paymentEvidence(undefined)).toEqual({ known: false, recorded: false, text: null });
  });
});
