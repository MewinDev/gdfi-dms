/**
 * Financing or Refinancing from the product name (D-031, final rule; answers Q-N16 and Q-N17).
 *
 * Case-insensitive; hyphens and extra spaces are ignored ("Re-Financing" = "refinancing"). In order:
 *   1. the name contains a Refinancing keyword -> Refinancing;
 *   2. else it contains a Financing keyword    -> Financing;
 *   3. else                                     -> the default (a setting; Refinancing to start).
 * Refinancing is checked first, so "Refinancing" never becomes Financing: there is no conflict state.
 *
 * Pure: no database, no I/O, safe in client components (the Settings preview uses it too).
 */

export type ClassificationValue = "FINANCING" | "REFINANCING";

export interface ClassificationRules {
  refinancing: string[];
  financing: string[];
  /** Step 3: what a name with no keyword becomes. */
  fallback: ClassificationValue;
}

/** The starting values (D-031). */
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRules = { refinancing: ["refinanc", "refi"], financing: ["financ"], fallback: "REFINANCING" };

/** Lower case, hyphens removed, runs of spaces made one, trimmed: the form both names and keywords are compared in. */
export function normalizeForMatch(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[-‐-―]/g, "").replace(/\s+/g, " ").trim();
}

export interface ClassifyResult {
  classification: ClassificationValue;
  /** Which step decided it. */
  step: "REFINANCING_KEYWORD" | "FINANCING_KEYWORD" | "DEFAULT";
  /** The keyword that matched (as saved), for steps 1 and 2. */
  keyword: string | null;
}

export function classifyByKeywords(productName: string | null | undefined, rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES): ClassifyResult {
  const name = normalizeForMatch(productName);
  const hit = (list: string[]) => (name ? list.find((k) => { const n = normalizeForMatch(k); return n !== "" && name.includes(n); }) ?? null : null);
  const refi = hit(rules.refinancing);
  if (refi) return { classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: refi };
  const fin = hit(rules.financing);
  if (fin) return { classification: "FINANCING", step: "FINANCING_KEYWORD", keyword: fin };
  return { classification: rules.fallback, step: "DEFAULT", keyword: null };
}

/**
 * Cleans the keyword lists typed in Settings: one per line or comma, trimmed, lower case, no duplicates,
 * no blanks. Returns a plain-language problem instead when a list cannot be saved.
 */
export function parseKeywords(raw: string): { keywords: string[]; problem: string | null } {
  const keywords = [...new Set(raw.split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const bad = keywords.find((k) => normalizeForMatch(k).length < 3);
  if (bad) return { keywords, problem: `"${bad}" is too short: use at least 3 letters, so it does not match every product name.` };
  if (keywords.length > 30) return { keywords, problem: "Keep each list to 30 keywords or fewer." };
  return { keywords, problem: null };
}

/** "Refinancing" / "Financing". */
export const classificationWord = (c: ClassificationValue) => (c === "FINANCING" ? "Financing" : "Refinancing");
