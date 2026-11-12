import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFiring, encodeFiring, plainRuleText, plainRuleValue, RULE_KEYS, RULE_NAMES, ruleText, storedRuleText, type RuleFiring } from "./names";
import { evaluateLoanRules, MORTGAGE_THRESHOLDS } from "./index";

const T = MORTGAGE_THRESHOLDS;

/** One firing of each outcome, so every key and every variant is covered. */
const ALL: RuleFiring[] = [
  { key: "PRODUCT_CLASSIFICATION", reason: "FINANCING_WORD" },
  { key: "PRODUCT_CLASSIFICATION", reason: "REFINANCING_WORD" },
  { key: "PRODUCT_CLASSIFICATION", reason: "NEITHER_WORD" },
  { key: "PRODUCT_CLASSIFICATION", reason: "BLANK" },
  { key: "UNDERTAKING_CHOICE", financingType: "UNDERTAKING" },
  { key: "UNDERTAKING_CHOICE", financingType: "NON_UNDERTAKING" },
  { key: "ORCR_CHECK", orcr: "TRANSFERRED" },
  { key: "ORCR_CHECK", orcr: "UNTRANSFERRED" },
  { key: "ORCR_CHECK", orcr: "SKIPPED" },
  { key: "MORTGAGE_THRESHOLD", loanType: "New", met: true },
  { key: "MORTGAGE_THRESHOLD", loanType: "New", met: false },
  { key: "MORTGAGE_THRESHOLD", loanType: "Renewal", met: true },
  { key: "MORTGAGE_THRESHOLD", loanType: "Renewal", met: false },
];

describe("rule names: the naming convention", () => {
  it("every key has a title, the old number, and a sentence for every outcome", () => {
    expect(RULE_KEYS.sort()).toEqual(["MORTGAGE_THRESHOLD", "ORCR_CHECK", "PRODUCT_CLASSIFICATION", "UNDERTAKING_CHOICE"]);
    for (const k of RULE_KEYS) expect(RULE_NAMES[k].title).toMatch(/^[A-Z][a-z/]+( [A-Za-z/]+){1,3}$/);
    for (const k of RULE_KEYS) expect(ALL.some((f) => f.key === k)).toBe(true);
    for (const f of ALL) {
      const w = ruleText(f, T);
      expect(`${w.title} ${w.sentence}`).not.toMatch(/->|→|\bRule\s*#?\d|\bR[1-4]\b/);
      if (f.key === "PRODUCT_CLASSIFICATION") {
        // A classification, not a decision: one complete sentence, no title on screen.
        expect(w.sentence).toMatch(/^This is a (Financing|Refinancing) loan: the product name .+\.$/);
        expect(w.line).toEqual({ title: null, text: w.sentence });
        continue;
      }
      // "<Thing> needed / not needed / required", 2 to 4 words, sentence case, no arrows or numbers.
      expect(w.title).toMatch(/^[A-Z][a-z/]*( [a-zA-Z/]+)*? (needed|not needed|required)$/);
      expect(w.title.split(" ").length).toBeGreaterThanOrEqual(2);
      expect(w.title.split(" ").length).toBeLessThanOrEqual(4);
      // "<Thing> is needed: <reason>." (are, for a plural thing)
      expect(w.sentence).toMatch(/^[A-Z][^:]* (is|are) (needed|not needed|required): .+\.$/);
      expect(w.reason).toMatch(/^[A-Z].+\.$/);
      // On screen: the title, then only the reason (the title is never said twice).
      expect(w.line).toEqual({ title: w.title, text: w.reason });
    }
  });

  it("the rule 4 example, word for word", () => {
    const w = ruleText({ key: "MORTGAGE_THRESHOLD", loanType: "New", met: true }, T);
    expect(w.title).toBe("Mortgage needed");
    expect(w.sentence).toBe("Mortgage is needed: this is a New loan of ₱500,000 or below.");
    expect(w.reason).toBe("This is a New loan of ₱500,000 or below.");
  });

  it("the sentence follows the threshold setting, never a fixed 500,000", () => {
    const other = { New: 750_000, Renewal: 1_250_000 };
    expect(ruleText({ key: "MORTGAGE_THRESHOLD", loanType: "New", met: false }, other).sentence).toBe("Mortgage is not needed: this is a New loan above ₱750,000.");
    expect(ruleText({ key: "MORTGAGE_THRESHOLD", loanType: "Renewal", met: true }, other).sentence).toBe("Mortgage is needed: this is a Renewal loan of ₱1,250,000 or below.");
    expect(plainRuleText("Rule 4 no longer applies (now above ₱500,000 for New).", other)).toBe("Mortgage is not needed: this is a New loan above ₱750,000.");
  });

  it("the stored key form goes both ways, and the engine stores it", () => {
    for (const f of ALL) expect(decodeFiring(encodeFiring(f))).toEqual(f);
    const r = evaluateLoanRules({ productName: "Auto Refinancing", loanType: "New", totalReleasedAmount: 450_000 });
    expect(r.summary).toBe("MORTGAGE_THRESHOLD:New:MET");
    expect(r.fired.map((f) => ruleText(f, T).line)).toEqual([
      { title: null, text: "This is a Refinancing loan: the product name has the word Refinancing." },
      { title: "Mortgage check needed", text: "A Refinancing loan skips the OR/CR question." },
      { title: "Mortgage needed", text: "This is a New loan of ₱500,000 or below." },
    ]);
  });
});

describe("rule names: old stored text maps to the key at display time", () => {
  // Exactly what the engine stored before the rule names (Loan.ruleFired, audit details).
  it.each<[string, RuleFiring]>([
    ['Rule 1: Product Name contains the whole word "Refinancing"', { key: "PRODUCT_CLASSIFICATION", reason: "REFINANCING_WORD" }],
    ['Rule 1: Product Name contains the whole word "Financing"', { key: "PRODUCT_CLASSIFICATION", reason: "FINANCING_WORD" }],
    ['Rule 1: Product Name has neither "Refinancing" nor "Financing" as a whole word, default Refinancing', { key: "PRODUCT_CLASSIFICATION", reason: "NEITHER_WORD" }],
    ["Rule 1: Product Name is blank, default Refinancing", { key: "PRODUCT_CLASSIFICATION", reason: "BLANK" }],
    ["Rule 2: Financing type Undertaking (picked by LA)", { key: "UNDERTAKING_CHOICE", financingType: "UNDERTAKING" }],
    ["Rule 2: Financing type Non-Undertaking (picked by LA)", { key: "UNDERTAKING_CHOICE", financingType: "NON_UNDERTAKING" }],
    ["Rule 3: Financing + ORCR Untransferred -> Notary + For EDST (Mortgage not evaluated)", { key: "ORCR_CHECK", orcr: "UNTRANSFERRED" }],
    ["Rule 3: Financing + ORCR Transferred -> run Rule 4", { key: "ORCR_CHECK", orcr: "TRANSFERRED" }],
    ["Rule 3: Refinancing -> ORCR skipped, run Rule 4", { key: "ORCR_CHECK", orcr: "SKIPPED" }],
    ["Rule 4: New and amount at or below PHP 500,000 -> Mortgage", { key: "MORTGAGE_THRESHOLD", loanType: "New", met: true }],
    ["Rule 4: Renewal and amount above PHP 1,000,000 -> Not Mortgage", { key: "MORTGAGE_THRESHOLD", loanType: "Renewal", met: false }],
  ])("%s", (old, firing) => {
    expect(decodeFiring(old)).toEqual(firing);
    expect(storedRuleText(old, T).sentence).toBe(ruleText(firing, T).sentence);
  });

  it("an override and a fixture are shown as they are, never as a rule", () => {
    expect(storedRuleText("Supervisor override by Ana Cruz: client paperwork", T)).toMatchObject({ key: null, title: "Changed by a supervisor", sentence: "Changed by Ana Cruz: client paperwork." });
    expect(storedRuleText("E2E fixture", T)).toMatchObject({ key: null, sentence: "E2E fixture" });
  });

  it("old sentences inside a longer text and inside audit details read as the rule sentences", () => {
    const old = "MyLoans changed Amount. Admin X applied it: Rule 4 no longer applies (now above ₱500,000 for New). Mortgage would be removed. Note: ok";
    expect(plainRuleText(old, T)).toBe("MyLoans changed Amount. Admin X applied it: Mortgage is not needed: this is a New loan above ₱500,000. Mortgage would be removed. Note: ok");
    expect(plainRuleText("Rule 4 now applies (at or below ₱1,000,000 for Renewal).", T)).toBe("Mortgage is needed: this is a Renewal loan of ₱1,000,000 or below.");
    expect(plainRuleValue({ rulesFired: ["Rule 3: Refinancing -> ORCR skipped, run Rule 4", "MORTGAGE_THRESHOLD:New:ABOVE"], n: 1 }, T)).toEqual({
      rulesFired: ["Mortgage check is needed: a Refinancing loan skips the OR/CR question.", "Mortgage is not needed: this is a New loan above ₱500,000."],
      n: 1,
    });
    expect(plainRuleText("Nothing about rules here.", T)).toBe("Nothing about rules here.");
  });
});

// ---------------------------------------------------------------------------
// Guard: no rule numbers in anything a person can see.
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");
/** Screens, components, emails, notifications and the wording libraries (tests and docs are not screens). */
const SCAN = ["app", "components", "lib"];
const SKIP = /(\.test\.tsx?$|\.spec\.tsx?$|[\\/]node_modules[\\/])/;
const BAD = /\b[Rr]ule\s*#?\s*[1-4]\b|\bR[1-4]\b|[Rr]ule that fired/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|html|txt)$/.test(n) && !SKIP.test(p) ? [p] : [];
  });
}

/** String and template literals and JSX text only (comments may keep the old numbers as history). */
function visibleText(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const out: string[] = [];
  for (const m of noComments.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|>[^<>{}]+</g)) out.push(m[0]);
  return out;
}

describe("guard: no rule numbers on screen, in emails or in notifications", () => {
  it("no string in app, components or lib says Rule 1 to Rule 4, R1 to R4 or 'rule that fired'", () => {
    const hits: string[] = [];
    for (const f of SCAN.flatMap((d) => files(join(ROOT, d)))) {
      for (const s of visibleText(readFileSync(f, "utf8"))) {
        // The read-only patterns that recognise the old stored wording (names.ts) are allowed.
        if (f.endsWith(join("lib", "rules", "names.ts")) && /^\/|Rule \(\[1-4\]\)|Rule 4 (no longer|now) applies/.test(s)) continue;
        if (BAD.test(s)) hits.push(`${relative(ROOT, f)}: ${s.slice(0, 100)}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the guard itself catches a rule number", () => {
    expect(visibleText('const a = "Rule 4: New -> Mortgage";').some((s) => BAD.test(s))).toBe(true);
    expect(visibleText("<p>R2 picked</p>").some((s) => BAD.test(s))).toBe(true);
    expect(visibleText("// Rule 4: comment only").some((s) => BAD.test(s))).toBe(false);
  });
});
