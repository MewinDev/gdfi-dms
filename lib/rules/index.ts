/**
 * GDFI DMS automation rules (prompt section 5.2, Rules 1 to 4).
 *
 * Pure functions only: no database, no clock, no I/O. Every automatic decision made at
 * "Open Loan File" comes from `evaluateLoanRules`, and the result carries the inputs used and
 * the rule that fired so it can be written to the audit trail as-is.
 *
 * Rules are stored by their stable key (lib/rules/names.ts, "KEY:value"); the words people see come from
 * names.ts at display time. Rule numbers live only in these comments.
 */

import { encodeFiring, plainRuleText, plainRuleValue, ruleText, storedRuleText, type RuleFiring } from "./names";
import { DEFAULT_CLASSIFICATION_RULES, classifyByKeywords, type ClassificationRules } from "./classify";

export type { ClassificationRules } from "./classify";
export { DEFAULT_CLASSIFICATION_RULES } from "./classify";

export type { RuleFiring, RuleKey } from "./names";
export { RULE_NAMES, RULE_KEYS, decodeFiring, encodeFiring } from "./names";

export type Classification = "FINANCING" | "REFINANCING";
export type FinancingType = "UNDERTAKING" | "NON_UNDERTAKING";
export type OrcrStatus = "TRANSFERRED" | "UNTRANSFERRED";
export type MortgageResult = "MORTGAGE" | "NOT_MORTGAGE" | "NOT_EVALUATED";
export type LoanTypeValue = "New" | "Renewal";
export type TransactionCode = "NOTARY" | "EDST" | "PPSR" | "MORTGAGE";

/** Mortgage thresholds (inclusive). Exactly the threshold amount is Mortgage. */
export const MORTGAGE_THRESHOLDS: Record<LoanTypeValue, number> = {
  New: 500_000,
  Renewal: 1_000_000,
};

/** Display order of transactions. */
export const TRANSACTION_ORDER: TransactionCode[] = ["NOTARY", "EDST", "PPSR", "MORTGAGE"];

// ---------------------------------------------------------------------------
// Rule 1: classification from the product name by keywords (D-031; lib/rules/classify.ts)
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  classification: Classification;
  /** The stored key form (names.ts). */
  rule: string;
  fired: RuleFiring;
  /** No keyword matched: the default decided it (the "Classified by default" label). */
  byDefault: boolean;
}

export function classifyProductName(productName: string | null | undefined, rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES, productCode?: string | null): ClassificationResult {
  const r = classifyByKeywords(productName, rules, productCode);
  const fired: RuleFiring = r.step === "DEFAULT" || r.step === "MANUAL"
    ? { key: "PRODUCT_CLASSIFICATION", reason: r.step, result: r.classification }
    : { key: "PRODUCT_CLASSIFICATION", reason: r.step, keyword: r.keyword! };
  return { classification: r.classification, rule: encodeFiring(fired), fired, byDefault: r.step === "DEFAULT" };
}

// ---------------------------------------------------------------------------
// Rule 4: Mortgage determination
// ---------------------------------------------------------------------------

export function isValidLoanType(value: unknown): value is LoanTypeValue {
  return value === "New" || value === "Renewal";
}

export interface MortgageDetermination {
  result: Exclude<MortgageResult, "NOT_EVALUATED">;
  /** The stored key form (names.ts). */
  rule: string;
  fired: RuleFiring;
}

export function determineMortgage(loanType: LoanTypeValue, totalReleasedAmount: number): MortgageDetermination {
  if (!isValidLoanType(loanType)) {
    throw new Error(`Loan Type must be exactly "New" or "Renewal" (got "${String(loanType)}")`);
  }
  if (!Number.isFinite(totalReleasedAmount) || totalReleasedAmount <= 0) {
    throw new Error("Total Released Amount must be a number greater than 0");
  }
  const met = totalReleasedAmount <= MORTGAGE_THRESHOLDS[loanType];
  const fired: RuleFiring = { key: "MORTGAGE_THRESHOLD", loanType, met };
  return { result: met ? "MORTGAGE" : "NOT_MORTGAGE", rule: encodeFiring(fired), fired };
}

// ---------------------------------------------------------------------------
// Rules 1-4 combined
// ---------------------------------------------------------------------------

export interface RuleInputs {
  productName: string | null | undefined;
  loanType: LoanTypeValue;
  totalReleasedAmount: number;
  /** Financing only: picked by the LA on the preview card. */
  financingType?: FinancingType | null;
  /** Financing only: picked by the LA on the preview card. */
  orcrStatus?: OrcrStatus | null;
  /** The keyword lists and the default (Settings, Product classification); the starting values when missing. */
  classificationRules?: ClassificationRules;
  /** The myloans product code: a product set by hand is found by it first (D-049). */
  productCode?: string | null;
}

export interface RuleOutcome {
  classification: Classification;
  financingType: FinancingType | null;
  orcrStatus: OrcrStatus | null;
  mortgage: MortgageResult;
  transactions: TransactionCode[];
  /** The rules that fired, in order (title and sentence: `ruleWording`). */
  fired: RuleFiring[];
  /** The same in the stored key form ("MORTGAGE_THRESHOLD:New:MET"), for the audit trail. */
  rulesFired: string[];
  /** The last rule that fired, stored key form (Loan.ruleFired; shown as "Why this was set up"). */
  summary: string;
}

export class RuleInputError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "RuleInputError";
  }
}

export function evaluateLoanRules(input: RuleInputs): RuleOutcome {
  const rulesFired: RuleFiring[] = [];
  const cls = classifyProductName(input.productName, input.classificationRules, input.productCode);
  rulesFired.push(cls.fired);

  if (cls.classification === "FINANCING") {
    // Rule 2: the LA picks Undertaking / Non-Undertaking. The system never guesses.
    if (!input.financingType) {
      throw new RuleInputError("Pick Undertaking or Non-Undertaking before opening the Loan File.", "financingType");
    }
    if (!input.orcrStatus) {
      throw new RuleInputError("Pick ORCR Transferred or Untransferred before opening the Loan File.", "orcrStatus");
    }
    rulesFired.push({ key: "UNDERTAKING_CHOICE", financingType: input.financingType });

    // Rule 3: ORCR (Untransferred: Notary + For EDST, Mortgage not evaluated; Transferred: run Rule 4)
    if (input.orcrStatus === "UNTRANSFERRED") {
      rulesFired.push({ key: "ORCR_CHECK", orcr: "UNTRANSFERRED" });
      return finish(cls.classification, input.financingType, "UNTRANSFERRED", "NOT_EVALUATED", rulesFired);
    }
    rulesFired.push({ key: "ORCR_CHECK", orcr: "TRANSFERRED" });
    const m = determineMortgage(input.loanType, input.totalReleasedAmount);
    rulesFired.push(m.fired);
    return finish(cls.classification, input.financingType, "TRANSFERRED", m.result, rulesFired);
  }

  // Refinancing: ORCR is skipped and Undertaking does not apply.
  rulesFired.push({ key: "ORCR_CHECK", orcr: "SKIPPED" });
  const m = determineMortgage(input.loanType, input.totalReleasedAmount);
  rulesFired.push(m.fired);
  return finish("REFINANCING", null, null, m.result, rulesFired);
}

function finish(
  classification: Classification,
  financingType: FinancingType | null,
  orcrStatus: OrcrStatus | null,
  mortgage: MortgageResult,
  fired: RuleFiring[],
): RuleOutcome {
  const transactions = transactionsFor(mortgage);
  const rulesFired = fired.map(encodeFiring);
  return {
    classification,
    financingType,
    orcrStatus,
    mortgage,
    transactions,
    fired,
    rulesFired,
    summary: rulesFired[rulesFired.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Wording (names.ts) with the thresholds above
// ---------------------------------------------------------------------------

/** Title and sentence of one fired rule. */
export const ruleWording = (f: RuleFiring) => ruleText(f, MORTGAGE_THRESHOLDS);
/** Title and sentence of a stored rule (Loan.ruleFired), old wording included. */
export const storedRuleWording = (text: string | null | undefined) => storedRuleText(text, MORTGAGE_THRESHOLDS);
/** Old rule numbers in a stored text (audit summary, notification) replaced by the rule sentences. */
export const plainRules = (text: string) => plainRuleText(text, MORTGAGE_THRESHOLDS);
/** The same for a JSON value (audit details). */
export const plainRulesIn = (v: unknown) => plainRuleValue(v, MORTGAGE_THRESHOLDS);

/** Outcome table: Mortgage -> 4 transactions, otherwise Notary + For EDST. */
export function transactionsFor(mortgage: MortgageResult): TransactionCode[] {
  return mortgage === "MORTGAGE" ? ["NOTARY", "EDST", "PPSR", "MORTGAGE"] : ["NOTARY", "EDST"];
}

/** True when a refreshed source record would produce a different automatic result. */
export function outcomesDiffer(a: RuleOutcome, b: RuleOutcome): boolean {
  return (
    a.classification !== b.classification ||
    a.mortgage !== b.mortgage ||
    a.transactions.join(",") !== b.transactions.join(",")
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const TRANSACTION_LABEL: Record<TransactionCode, string> = {
  NOTARY: "Notary",
  EDST: "For EDST",
  PPSR: "For Entry PPSR",
  MORTGAGE: "Mortgage",
};
