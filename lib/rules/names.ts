/**
 * The names of the automatic rules: the only place in the app that writes rule wording.
 *
 * Naming convention (docs/workflow/09-status-and-open-questions.md, "Rule names"):
 * - No rule numbers on screen. Each rule has a stable key (used in code, stored records, audit and tests).
 * - A short title that says what it decides, in the pattern "<Thing> needed" / "<Thing> not needed" /
 *   "<Thing> required", sentence case.
 * - One plain sentence that says why, with the loan's real values: "<Thing> is needed: <reason>."
 * - On screen a decision reads "<title> · <reason>" (never the title twice).
 * - The classification is not a decision but what the loan is: it reads as one complete sentence with no
 *   title, "This is a Refinancing loan: the product name has the word Refinancing."
 *
 * Internal history only (never shown): PRODUCT_CLASSIFICATION was Rule 1, UNDERTAKING_CHOICE Rule 2,
 * ORCR_CHECK Rule 3, MORTGAGE_THRESHOLD Rule 4.
 *
 * Pure: no database, no I/O, safe in client components.
 */

export type RuleKey = "PRODUCT_CLASSIFICATION" | "UNDERTAKING_CHOICE" | "ORCR_CHECK" | "MORTGAGE_THRESHOLD";
type LoanType = "New" | "Renewal";

/** One rule as it fired for a loan: the key plus the values the wording needs. */
export type RuleFiring =
  | { key: "PRODUCT_CLASSIFICATION"; reason: "FINANCING_WORD" | "REFINANCING_WORD" | "NEITHER_WORD" | "BLANK" }
  | { key: "UNDERTAKING_CHOICE"; financingType: "UNDERTAKING" | "NON_UNDERTAKING" }
  | { key: "ORCR_CHECK"; orcr: "TRANSFERRED" | "UNTRANSFERRED" | "SKIPPED" }
  | { key: "MORTGAGE_THRESHOLD"; loanType: LoanType; met: boolean };

export type Thresholds = Record<LoanType, number>;

export interface RuleName {
  key: RuleKey;
  /** The rule in general (Settings, docs). */
  title: string;
  /** What it decides, for the docs table. */
  decides: string;
  /** Internal: the old number, for the docs table only ("formerly Rule N"). */
  formerly: 1 | 2 | 3 | 4;
}

export const RULE_NAMES: Record<RuleKey, RuleName> = {
  PRODUCT_CLASSIFICATION: { key: "PRODUCT_CLASSIFICATION", title: "Loan classification", decides: "Financing or Refinancing, from the product name", formerly: 1 },
  UNDERTAKING_CHOICE: { key: "UNDERTAKING_CHOICE", title: "Undertaking answer required", decides: "Undertaking or Non-Undertaking, picked by the Loan Associate", formerly: 2 },
  ORCR_CHECK: { key: "ORCR_CHECK", title: "Mortgage check needed", decides: "Whether the mortgage amount check runs, from the OR/CR answer", formerly: 3 },
  MORTGAGE_THRESHOLD: { key: "MORTGAGE_THRESHOLD", title: "Mortgage needed", decides: "Mortgage or not, from the loan type and the amount threshold", formerly: 4 },
};

export const RULE_KEYS = Object.keys(RULE_NAMES) as RuleKey[];

/** The peso amount as written in the rest of the app: ₱500,000. */
export const pesoWhole = (n: number) => `₱${n.toLocaleString("en-PH")}`;

/**
 * Title, sentence, the reason alone (the sentence after its colon) and the on-screen line. The threshold
 * comes from the caller (the rules' setting).
 */
export function ruleText(f: RuleFiring, thresholds: Thresholds): RuleWords {
  const w = ruleTitleAndSentence(f, thresholds);
  const reason = reasonOf(w.sentence);
  // The classification is one complete sentence; a decision is its title and then the reason.
  const line = f.key === "PRODUCT_CLASSIFICATION" ? { title: null, text: w.sentence } : { title: w.title, text: reason };
  return { ...w, reason, line };
}

export interface RuleWords {
  key: RuleKey;
  title: string;
  sentence: string;
  reason: string;
  /** What a list shows: "<title> · <text>", or the text alone when title is null. */
  line: { title: string | null; text: string };
}

const reasonOf = (sentence: string) => { const i = sentence.indexOf(": "); return i < 0 ? sentence : sentence.slice(i + 2).replace(/^./, (c) => c.toUpperCase()); };

function ruleTitleAndSentence(f: RuleFiring, thresholds: Thresholds): Omit<RuleWords, "reason" | "line"> {
  switch (f.key) {
    case "PRODUCT_CLASSIFICATION": {
      const cls = f.reason === "FINANCING_WORD" ? "Financing" : "Refinancing";
      const why =
        f.reason === "FINANCING_WORD" ? "the product name has the word Financing"
        : f.reason === "REFINANCING_WORD" ? "the product name has the word Refinancing"
        : f.reason === "BLANK" ? "the product name is blank, so it counts as Refinancing"
        : "the product name has neither Financing nor Refinancing, so it counts as Refinancing";
      return { key: f.key, title: `${cls} loan`, sentence: `This is a ${cls} loan: ${why}.` };
    }
    case "UNDERTAKING_CHOICE":
      return {
        key: f.key,
        title: "Undertaking answer required",
        sentence: `Undertaking answer is required: this is a Financing loan, answered ${f.financingType === "UNDERTAKING" ? "Undertaking" : "Non-Undertaking"}.`,
      };
    case "ORCR_CHECK":
      if (f.orcr === "UNTRANSFERRED") return { key: f.key, title: "Mortgage check not needed", sentence: "Mortgage check is not needed: the OR/CR is untransferred." };
      return {
        key: f.key,
        title: "Mortgage check needed",
        sentence: f.orcr === "TRANSFERRED" ? "Mortgage check is needed: the OR/CR is transferred." : "Mortgage check is needed: a Refinancing loan skips the OR/CR question.",
      };
    case "MORTGAGE_THRESHOLD": {
      const t = pesoWhole(thresholds[f.loanType]);
      return f.met
        ? { key: f.key, title: "Mortgage needed", sentence: `Mortgage is needed: this is a ${f.loanType} loan of ${t} or below.` }
        : { key: f.key, title: "Mortgage not needed", sentence: `Mortgage is not needed: this is a ${f.loanType} loan above ${t}.` };
    }
  }
}

// ---------------------------------------------------------------------------
// Stored form: "KEY:value[:value]" (Loan.ruleFired, audit details). Stable, no wording.
// ---------------------------------------------------------------------------

export function encodeFiring(f: RuleFiring): string {
  switch (f.key) {
    case "PRODUCT_CLASSIFICATION": return `${f.key}:${f.reason}`;
    case "UNDERTAKING_CHOICE": return `${f.key}:${f.financingType}`;
    case "ORCR_CHECK": return `${f.key}:${f.orcr}`;
    case "MORTGAGE_THRESHOLD": return `${f.key}:${f.loanType}:${f.met ? "MET" : "ABOVE"}`;
  }
}

/**
 * The firing behind a stored text: the key form above, or the full sentence older records stored
 * ("Rule 4: New and amount at or below PHP 500,000 -> Mortgage"). Null for anything else
 * (a supervisor override, a test fixture).
 */
export function decodeFiring(text: string | null | undefined): RuleFiring | null {
  const s = (text ?? "").trim();
  const [k, a, b] = s.split(":");
  if (k === "PRODUCT_CLASSIFICATION" && (a === "FINANCING_WORD" || a === "REFINANCING_WORD" || a === "NEITHER_WORD" || a === "BLANK")) return { key: k, reason: a };
  if (k === "UNDERTAKING_CHOICE" && (a === "UNDERTAKING" || a === "NON_UNDERTAKING")) return { key: k, financingType: a };
  if (k === "ORCR_CHECK" && (a === "TRANSFERRED" || a === "UNTRANSFERRED" || a === "SKIPPED")) return { key: k, orcr: a };
  if (k === "MORTGAGE_THRESHOLD" && (a === "New" || a === "Renewal") && (b === "MET" || b === "ABOVE")) return { key: k, loanType: a, met: b === "MET" };
  return decodeOld(s);
}

/** The wording older records stored (before the rule names). Read only; old rows are never edited. */
function decodeOld(s: string): RuleFiring | null {
  const m = /^Rule ([1-4]): ([^]*)$/.exec(s);
  if (!m) return null;
  const body = m[2];
  switch (m[1]) {
    case "1":
      return {
        key: "PRODUCT_CLASSIFICATION",
        reason: /^Product Name is blank/.test(body) ? "BLANK" : /has neither/.test(body) ? "NEITHER_WORD" : /"Refinancing"$/.test(body) ? "REFINANCING_WORD" : "FINANCING_WORD",
      };
    case "2":
      return { key: "UNDERTAKING_CHOICE", financingType: /Non-Undertaking/.test(body) ? "NON_UNDERTAKING" : "UNDERTAKING" };
    case "3":
      return { key: "ORCR_CHECK", orcr: /^Refinancing/.test(body) ? "SKIPPED" : /Untransferred/.test(body) ? "UNTRANSFERRED" : "TRANSFERRED" };
    case "4": {
      const lt = /^(New|Renewal)\b/.exec(body)?.[1] as LoanType | undefined;
      if (!lt) return null;
      return { key: "MORTGAGE_THRESHOLD", loanType: lt, met: /at or below/.test(body) };
    }
  }
  return null;
}

/** Title and sentence for a stored rule text; anything that is not a rule (an override) is shown as it is. */
export function storedRuleText(text: string | null | undefined, thresholds: Thresholds): Omit<RuleWords, "key"> & { key: RuleKey | null } {
  const f = decodeFiring(text);
  if (f) return ruleText(f, thresholds);
  const s = (text ?? "").trim();
  if (/^Supervisor override by /.test(s)) {
    const sentence = s.replace(/^Supervisor override by /, "Changed by ") + (/[.!?]$/.test(s) ? "" : ".");
    return { key: null, title: "Changed by a supervisor", sentence, reason: sentence, line: { title: "Changed by a supervisor", text: sentence } };
  }
  return { key: null, title: s || "-", sentence: s || "-", reason: "", line: { title: null, text: s || "-" } };
}

/**
 * Display-time wording for any text that may hold old rule numbers (an audit summary, a notification, a
 * stored sentence): the old phrases become the rule sentences. Text without them is returned unchanged.
 */
export function plainRuleText(text: string, thresholds: Thresholds): string {
  if (!text) return text;
  const whole = decodeFiring(text);
  if (whole) return ruleText(whole, thresholds).sentence;
  return text
    .replace(/Rule 4 no longer applies \(now above ₱[\d,]+ for (New|Renewal)\)\./g, (_, lt: LoanType) => ruleText({ key: "MORTGAGE_THRESHOLD", loanType: lt, met: false }, thresholds).sentence)
    .replace(/Rule 4 now applies \(at or below ₱[\d,]+ for (New|Renewal)\)\./g, (_, lt: LoanType) => ruleText({ key: "MORTGAGE_THRESHOLD", loanType: lt, met: true }, thresholds).sentence);
}

/** The same, for a JSON value (audit details): every string inside is mapped. */
export function plainRuleValue(v: unknown, thresholds: Thresholds): unknown {
  if (typeof v === "string") return plainRuleText(v, thresholds);
  if (Array.isArray(v)) return v.map((x) => plainRuleValue(x, thresholds));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainRuleValue(x, thresholds)]));
  return v;
}
