import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFICATION_RULES, classifyByKeywords, normalizeForMatch, parseKeywords } from "./classify";

/** D-031: the final classification rule. Fake product names only. */
describe("classification by keywords (D-031)", () => {
  const c = (name: string | null, rules = DEFAULT_CLASSIFICATION_RULES) => classifyByKeywords(name, rules);

  it("the examples from the decision", () => {
    expect(c("Auto Refinancing")).toEqual({ classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: "refinanc" });
    expect(c("Re-Financing")).toEqual({ classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: "refinanc" });
    expect(c("REFI Loan")).toEqual({ classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: "refi" });
    expect(c("Auto Financing")).toEqual({ classification: "FINANCING", step: "FINANCING_KEYWORD", keyword: "financ" });
    expect(c("Car Loan")).toEqual({ classification: "REFINANCING", step: "DEFAULT", keyword: null });
  });

  it("Refinancing is checked first: a Refinancing name never becomes Financing (no conflict state)", () => {
    for (const n of ["Truck Refinancing", "Auto Re-Financing", "Financing and Refinancing Promo"]) expect(c(n).classification, n).toBe("REFINANCING");
  });

  it("case, hyphens and extra spaces are ignored; blank goes to the default", () => {
    expect(normalizeForMatch("  Auto   RE-financing ")).toBe("auto refinancing");
    expect(c("auto   FINANCING").classification).toBe("FINANCING");
    expect(c("Angono - Car Financing").classification).toBe("FINANCING");
    expect(c("")).toMatchObject({ step: "DEFAULT", classification: "REFINANCING" });
    expect(c(null)).toMatchObject({ step: "DEFAULT" });
  });

  it("the default is a setting", () => {
    expect(c("Car Loan", { ...DEFAULT_CLASSIFICATION_RULES, fallback: "FINANCING" })).toEqual({ classification: "FINANCING", step: "DEFAULT", keyword: null });
  });

  it("a rename that flips the result", () => {
    expect(c("Auto Loan").step).toBe("DEFAULT");
    expect(c("Auto Financing").classification).toBe("FINANCING");
    expect(c("Auto Refinancing").classification).toBe("REFINANCING");
  });

  it("a keyword change can flip a name; keywords are compared the same way as names", () => {
    expect(c("Auto Finance").classification).toBe("FINANCING"); // "financ"
    expect(c("Auto Finance", { ...DEFAULT_CLASSIFICATION_RULES, financing: ["financing"] }).step).toBe("DEFAULT");
    expect(c("Re-Fi Loan", { ...DEFAULT_CLASSIFICATION_RULES, refinancing: ["re-fi"] }).keyword).toBe("re-fi");
  });

  it("Settings: keyword lists are cleaned and checked", () => {
    expect(parseKeywords("Refinanc\nrefi, refi\n\n")).toEqual({ keywords: ["refinanc", "refi"], problem: null });
    expect(parseKeywords("fi").problem).toMatch(/too short/);
  });
});
