import { describe, expect, it } from "vitest";
import {
  classifyProductName,
  determineMortgage,
  evaluateLoanRules,
  outcomesDiffer,
  RuleInputError,
} from "./index";

describe("Rule 1: classification from Product Name", () => {
  it.each([
    ["Auto Refinancing", "REFINANCING"],
    ["Auto Financing", "FINANCING"],
    ["AUTO   financing  ", "FINANCING"],
    ["  auto REFINANCING", "REFINANCING"],
    ["Financing", "FINANCING"],
    ["Refinancing - Auto", "REFINANCING"],
    ["Auto Finance", "REFINANCING"], // O-4: partial word is not a match
    ["Autofinancing", "REFINANCING"], // not a whole word
    ["Car Loan", "REFINANCING"],
    ["", "REFINANCING"],
    [null, "REFINANCING"],
    [undefined, "REFINANCING"],
    ["Financing / Refinancing", "REFINANCING"], // Refinancing is checked first
  ])("%j -> %s", (name, expected) => {
    expect(classifyProductName(name as string | null).classification).toBe(expected);
  });

  it("explains blank and default", () => {
    expect(classifyProductName("").rule).toMatch(/blank/);
    expect(classifyProductName("Auto Finance").rule).toMatch(/default Refinancing/);
  });
});

describe("Rule 4: Mortgage determination (boundaries)", () => {
  it.each([
    ["New", 1, "MORTGAGE"],
    ["New", 499_999.99, "MORTGAGE"],
    ["New", 500_000, "MORTGAGE"],
    ["New", 500_000.01, "NOT_MORTGAGE"],
    ["New", 600_000, "NOT_MORTGAGE"],
    ["Renewal", 999_999.99, "MORTGAGE"],
    ["Renewal", 1_000_000, "MORTGAGE"],
    ["Renewal", 1_000_000.01, "NOT_MORTGAGE"],
    ["Renewal", 1_250_000, "NOT_MORTGAGE"],
  ] as const)("%s %d -> %s", (loanType, amount, expected) => {
    expect(determineMortgage(loanType, amount).result).toBe(expected);
  });

  it("refuses loan types other than New or Renewal", () => {
    expect(() => determineMortgage("Restructured" as never, 400_000)).toThrow(/New" or "Renewal/);
  });
  it("refuses zero or negative amounts", () => {
    expect(() => determineMortgage("New", 0)).toThrow(/greater than 0/);
    expect(() => determineMortgage("New", -5)).toThrow(/greater than 0/);
    expect(() => determineMortgage("New", Number.NaN)).toThrow(/greater than 0/);
  });
});

describe("Outcome table", () => {
  it("Financing + Untransferred -> Notary, For EDST; Mortgage not evaluated", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing",
      loanType: "New",
      totalReleasedAmount: 300_000,
      financingType: "UNDERTAKING",
      orcrStatus: "UNTRANSFERRED",
    });
    expect(r.classification).toBe("FINANCING");
    expect(r.financingType).toBe("UNDERTAKING");
    expect(r.orcrStatus).toBe("UNTRANSFERRED");
    expect(r.mortgage).toBe("NOT_EVALUATED");
    expect(r.transactions).toEqual(["NOTARY", "EDST"]);
  });

  it("Financing + Untransferred does not evaluate Mortgage even for a huge amount", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing",
      loanType: "Renewal",
      totalReleasedAmount: 9_000_000,
      financingType: "NON_UNDERTAKING",
      orcrStatus: "UNTRANSFERRED",
    });
    expect(r.mortgage).toBe("NOT_EVALUATED");
    expect(r.transactions).toEqual(["NOTARY", "EDST"]);
  });

  it("Financing + Transferred + Mortgage -> 4 transactions", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing",
      loanType: "New",
      totalReleasedAmount: 300_000,
      financingType: "NON_UNDERTAKING",
      orcrStatus: "TRANSFERRED",
    });
    expect(r.mortgage).toBe("MORTGAGE");
    expect(r.transactions).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
  });

  it("Financing + Transferred + Not Mortgage -> Notary, For EDST", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing",
      loanType: "Renewal",
      totalReleasedAmount: 1_250_000,
      financingType: "UNDERTAKING",
      orcrStatus: "TRANSFERRED",
    });
    expect(r.mortgage).toBe("NOT_MORTGAGE");
    expect(r.transactions).toEqual(["NOTARY", "EDST"]);
  });

  it("Refinancing + Mortgage -> 4 transactions; ORCR skipped", () => {
    const r = evaluateLoanRules({ productName: "Auto Refinancing", loanType: "New", totalReleasedAmount: 450_000 });
    expect(r.classification).toBe("REFINANCING");
    expect(r.orcrStatus).toBeNull();
    expect(r.financingType).toBeNull();
    expect(r.mortgage).toBe("MORTGAGE");
    expect(r.transactions).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
  });

  it("Refinancing + Not Mortgage -> Notary, For EDST", () => {
    const r = evaluateLoanRules({ productName: "Auto Finance", loanType: "New", totalReleasedAmount: 600_000 });
    expect(r.classification).toBe("REFINANCING");
    expect(r.mortgage).toBe("NOT_MORTGAGE");
    expect(r.transactions).toEqual(["NOTARY", "EDST"]);
  });

  it("Refinancing ignores LA picks if any are passed", () => {
    const r = evaluateLoanRules({
      productName: "",
      loanType: "Renewal",
      totalReleasedAmount: 800_000,
      financingType: "UNDERTAKING",
      orcrStatus: "UNTRANSFERRED",
    });
    expect(r.classification).toBe("REFINANCING");
    expect(r.financingType).toBeNull();
    expect(r.orcrStatus).toBeNull();
    expect(r.mortgage).toBe("MORTGAGE");
  });

  it("Financing requires both LA picks; the system never guesses", () => {
    expect(() =>
      evaluateLoanRules({ productName: "Auto Financing", loanType: "New", totalReleasedAmount: 1, orcrStatus: "TRANSFERRED" }),
    ).toThrow(RuleInputError);
    expect(() =>
      evaluateLoanRules({ productName: "Auto Financing", loanType: "New", totalReleasedAmount: 1, financingType: "UNDERTAKING" }),
    ).toThrow(/ORCR/);
  });

  it("records every rule that fired", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing",
      loanType: "Renewal",
      totalReleasedAmount: 1_000_000,
      financingType: "UNDERTAKING",
      orcrStatus: "TRANSFERRED",
    });
    expect(r.rulesFired).toHaveLength(4);
    expect(r.rulesFired[0]).toMatch(/^Rule 1/);
    expect(r.rulesFired[1]).toMatch(/^Rule 2/);
    expect(r.rulesFired[2]).toMatch(/^Rule 3/);
    expect(r.rulesFired[3]).toMatch(/^Rule 4.*Mortgage/);
    expect(r.summary).toBe(r.rulesFired[3]);
  });
});

describe("Section 9 mock PNs (rules part)", () => {
  it("GD1012026901001 Refinancing, Mortgage -> 4", () => {
    expect(evaluateLoanRules({ productName: "Auto Refinancing", loanType: "New", totalReleasedAmount: 450_000 }).transactions).toHaveLength(4);
  });
  it("GD1652026901003 Financing Transferred Renewal 1,000,000 -> Mortgage (boundary)", () => {
    const r = evaluateLoanRules({
      productName: "Auto Financing", loanType: "Renewal", totalReleasedAmount: 1_000_000,
      financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED",
    });
    expect(r.mortgage).toBe("MORTGAGE");
  });
  it("GD1012026901006 blank -> Refinancing, Mortgage", () => {
    const r = evaluateLoanRules({ productName: "", loanType: "Renewal", totalReleasedAmount: 800_000 });
    expect(r.classification).toBe("REFINANCING");
    expect(r.mortgage).toBe("MORTGAGE");
  });
});

describe("outcomesDiffer", () => {
  it("detects an amount change that flips Mortgage", () => {
    const a = evaluateLoanRules({ productName: "", loanType: "New", totalReleasedAmount: 450_000 });
    const b = evaluateLoanRules({ productName: "", loanType: "New", totalReleasedAmount: 550_000 });
    expect(outcomesDiffer(a, b)).toBe(true);
    expect(outcomesDiffer(a, a)).toBe(false);
  });
});
