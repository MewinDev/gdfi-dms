import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFICATION_RULES, asRules, classifyByKeywords, cleanKeywords, normalizeForMatch, type ClassificationRules } from "./classify";

/** D-031 and D-034: the classification rule with "Whole word only" per keyword. Fake product names only. */
describe("classification by keywords (D-031, D-034)", () => {
  const c = (name: string | null, rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES) => classifyByKeywords(name, rules);

  it("the examples from the decision (refinanc starts a word; refi whole word only; financ starts a word)", () => {
    expect(c("Pre-Financing")).toEqual({ classification: "FINANCING", step: "FINANCING_KEYWORD", keyword: "financ" });
    expect(c("REFI Loan")).toEqual({ classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: "refi" });
    expect(c("Refinancing")).toEqual({ classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: "refinanc" });
    expect(c("Auto Financing")).toEqual({ classification: "FINANCING", step: "FINANCING_KEYWORD", keyword: "financ" });
    expect(c("Car Loan")).toEqual({ classification: "REFINANCING", step: "DEFAULT", keyword: null });
  });

  it("the tickbox: refi is a whole word only; refinanc may start a longer word", () => {
    expect(c("Refinery Equipment Loan").step).toBe("DEFAULT"); // "refi" is not the whole word, "refinanc" does not start it
    expect(c("Refi-Loan")).toMatchObject({ classification: "REFINANCING", keyword: "refi" });
    const noTick = { ...DEFAULT_CLASSIFICATION_RULES, refinancing: [{ text: "refi", wholeWord: false }] };
    expect(c("Refinery Equipment Loan", noTick)).toMatchObject({ classification: "REFINANCING", keyword: "refi" });
  });

  it("hyphens inside a word are ignored, and a hyphen is also a word break", () => {
    expect(c("Re-Financing").classification).toBe("REFINANCING"); // re-financing = refinancing
    expect(c("Auto Re-Financing").classification).toBe("REFINANCING");
    expect(c("Angono - Car Financing").classification).toBe("FINANCING");
    expect(c("Autofinancing").step).toBe("DEFAULT"); // "financ" does not start a word here
    expect(normalizeForMatch("  Auto   RE-financing ")).toBe("auto refinancing");
  });

  it("Refinancing is checked first: no conflict state; blank goes to the default; the default is a setting", () => {
    expect(c("Financing and Refinancing Promo").classification).toBe("REFINANCING");
    expect(c("")).toMatchObject({ step: "DEFAULT", classification: "REFINANCING" });
    expect(c(null)).toMatchObject({ step: "DEFAULT" });
    expect(c("Car Loan", { ...DEFAULT_CLASSIFICATION_RULES, fallback: "FINANCING" })).toEqual({ classification: "FINANCING", step: "DEFAULT", keyword: null });
  });

  it("a rename that flips the result", () => {
    expect(c("Auto Loan").step).toBe("DEFAULT");
    expect(c("Auto Financing").classification).toBe("FINANCING");
    expect(c("Auto Refinancing").classification).toBe("REFINANCING");
  });

  it("multi-word keywords; settings saved before D-034 (plain strings) read as 'starts a word'", () => {
    expect(c("Home Equity Line", { ...DEFAULT_CLASSIFICATION_RULES, financing: [{ text: "home equ", wholeWord: false }] }).classification).toBe("FINANCING");
    expect(asRules({ refinancing: ["refinanc"], financing: ["financ"], fallback: "REFINANCING" }).refinancing).toEqual([{ text: "refinanc", wholeWord: false }]);
  });

  it("Settings: keyword lists are cleaned and checked", () => {
    expect(cleanKeywords([{ text: " Refinanc ", wholeWord: false }, { text: "refi", wholeWord: true }, { text: "REFI", wholeWord: false }, { text: "", wholeWord: false }]))
      .toEqual({ keywords: [{ text: "refinanc", wholeWord: false }, { text: "refi", wholeWord: true }], problem: null });
    expect(cleanKeywords([{ text: "fi", wholeWord: false }]).problem).toMatch(/too short/);
  });
});
