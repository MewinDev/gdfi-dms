/**
 * GDFI DMS automation rules (prompt section 5.2, Rules 1 to 4).
 *
 * Pure functions only: no database, no clock, no I/O. Every automatic decision made at
 * "Open Loan File" comes from `evaluateLoanRules`, and the result carries the inputs used and
 * the rule that fired so it can be written to the audit trail as-is.
 */

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
// Rule 1: classification from Product Name (whole words, case and spacing ignored)
// ---------------------------------------------------------------------------

function normalizeProductName(productName: string | null | undefined): string {
  return (productName ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function containsWholeWord(text: string, word: string): boolean {
  // A "word" is a run of letters/digits. "Auto Finance" does not contain "financing",
  // and "Refinancing" does not contain the whole word "financing".
  const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes(word.toLowerCase());
}

export interface ClassificationResult {
  classification: Classification;
  rule: string;
}

export function classifyProductName(productName: string | null | undefined): ClassificationResult {
  const name = normalizeProductName(productName);
  if (containsWholeWord(name, "refinancing")) {
    return { classification: "REFINANCING", rule: 'Rule 1: Product Name contains the whole word "Refinancing"' };
  }
  if (containsWholeWord(name, "financing")) {
    return { classification: "FINANCING", rule: 'Rule 1: Product Name contains the whole word "Financing"' };
  }
  return {
    classification: "REFINANCING",
    rule: name
      ? 'Rule 1: Product Name has neither "Refinancing" nor "Financing" as a whole word, default Refinancing'
      : "Rule 1: Product Name is blank, default Refinancing",
  };
}

// ---------------------------------------------------------------------------
// Rule 4: Mortgage determination
// ---------------------------------------------------------------------------

export function isValidLoanType(value: unknown): value is LoanTypeValue {
  return value === "New" || value === "Renewal";
}

export interface MortgageDetermination {
  result: Exclude<MortgageResult, "NOT_EVALUATED">;
  rule: string;
}

export function determineMortgage(loanType: LoanTypeValue, totalReleasedAmount: number): MortgageDetermination {
  if (!isValidLoanType(loanType)) {
    throw new Error(`Loan Type must be exactly "New" or "Renewal" (got "${String(loanType)}")`);
  }
  if (!Number.isFinite(totalReleasedAmount) || totalReleasedAmount <= 0) {
    throw new Error("Total Released Amount must be a number greater than 0");
  }
  const threshold = MORTGAGE_THRESHOLDS[loanType];
  const peso = threshold.toLocaleString("en-PH");
  if (totalReleasedAmount <= threshold) {
    return { result: "MORTGAGE", rule: `Rule 4: ${loanType} and amount at or below PHP ${peso} -> Mortgage` };
  }
  return { result: "NOT_MORTGAGE", rule: `Rule 4: ${loanType} and amount above PHP ${peso} -> Not Mortgage` };
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
}

export interface RuleOutcome {
  classification: Classification;
  financingType: FinancingType | null;
  orcrStatus: OrcrStatus | null;
  mortgage: MortgageResult;
  transactions: TransactionCode[];
  /** Human-readable trail of the rules that fired, in order. */
  rulesFired: string[];
  /** One-line summary for the Loan File ("rule that fired"). */
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
  const rulesFired: string[] = [];
  const cls = classifyProductName(input.productName);
  rulesFired.push(cls.rule);

  if (cls.classification === "FINANCING") {
    // Rule 2: the LA picks Undertaking / Non-Undertaking. The system never guesses.
    if (!input.financingType) {
      throw new RuleInputError("Pick Undertaking or Non-Undertaking before opening the Loan File.", "financingType");
    }
    if (!input.orcrStatus) {
      throw new RuleInputError("Pick ORCR Transferred or Untransferred before opening the Loan File.", "orcrStatus");
    }
    rulesFired.push(
      `Rule 2: Financing type ${input.financingType === "UNDERTAKING" ? "Undertaking" : "Non-Undertaking"} (picked by LA)`,
    );

    // Rule 3: ORCR
    if (input.orcrStatus === "UNTRANSFERRED") {
      rulesFired.push("Rule 3: Financing + ORCR Untransferred -> Notary + For EDST (Mortgage not evaluated)");
      return finish(cls.classification, input.financingType, "UNTRANSFERRED", "NOT_EVALUATED", rulesFired);
    }
    rulesFired.push("Rule 3: Financing + ORCR Transferred -> run Rule 4");
    const m = determineMortgage(input.loanType, input.totalReleasedAmount);
    rulesFired.push(m.rule);
    return finish(cls.classification, input.financingType, "TRANSFERRED", m.result, rulesFired);
  }

  // Refinancing: ORCR is skipped and Undertaking does not apply.
  rulesFired.push("Rule 3: Refinancing -> ORCR skipped, run Rule 4");
  const m = determineMortgage(input.loanType, input.totalReleasedAmount);
  rulesFired.push(m.rule);
  return finish("REFINANCING", null, null, m.result, rulesFired);
}

function finish(
  classification: Classification,
  financingType: FinancingType | null,
  orcrStatus: OrcrStatus | null,
  mortgage: MortgageResult,
  rulesFired: string[],
): RuleOutcome {
  const transactions = transactionsFor(mortgage);
  return {
    classification,
    financingType,
    orcrStatus,
    mortgage,
    transactions,
    rulesFired,
    summary: rulesFired[rulesFired.length - 1],
  };
}

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

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  FINANCING: "Financing",
  REFINANCING: "Refinancing",
};
export const FINANCING_TYPE_LABEL: Record<FinancingType, string> = {
  UNDERTAKING: "Undertaking",
  NON_UNDERTAKING: "Non-Undertaking",
};
export const ORCR_LABEL: Record<OrcrStatus, string> = {
  TRANSFERRED: "Transferred",
  UNTRANSFERRED: "Untransferred",
};
export const MORTGAGE_LABEL: Record<MortgageResult, string> = {
  MORTGAGE: "Mortgage",
  NOT_MORTGAGE: "Not Mortgage",
  NOT_EVALUATED: "Not evaluated",
};
export const TRANSACTION_LABEL: Record<TransactionCode, string> = {
  NOTARY: "Notary",
  EDST: "For EDST",
  PPSR: "For Entry PPSR",
  MORTGAGE: "Mortgage",
};
