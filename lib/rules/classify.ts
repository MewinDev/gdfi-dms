/**
 * Financing or Refinancing from the product name (D-031, D-034; answers Q-N16 and Q-N17).
 *
 * Case-insensitive; extra spaces ignored. Each keyword matches at the START of a word, or, with
 * "Whole word only", only a whole word. Hyphens: the name is checked with hyphens removed inside words
 * ("Re-Financing" = "refinancing") and with hyphens as word breaks ("Pre-Financing" = "pre financing"), so a
 * keyword matches if it starts a word in either form. In order:
 *   1. a Refinancing keyword -> Refinancing;
 *   2. else a Financing keyword -> Financing;
 *   3. else -> the default (a setting; Refinancing to start), labelled "Classified by default".
 * Refinancing is checked first, so "Refinancing" never becomes Financing: there is no conflict state.
 *
 * Pure: no database, no I/O, safe in client components (the Settings preview uses it too).
 */

export type ClassificationValue = "FINANCING" | "REFINANCING";

/** One keyword: its text and whether it must be a whole word (the tickbox in Settings). */
export interface Keyword { text: string; wholeWord: boolean }

export interface ClassificationRules {
  refinancing: Keyword[];
  financing: Keyword[];
  /** Step 3: what a name with no keyword becomes. */
  fallback: ClassificationValue;
}

/** The starting values (D-034): "refinanc" starts a word; "refi" whole word only; "financ" starts a word. */
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRules = {
  refinancing: [{ text: "refinanc", wholeWord: false }, { text: "refi", wholeWord: true }],
  financing: [{ text: "financ", wholeWord: false }],
  fallback: "REFINANCING",
};

/** Settings saved before D-034 held plain strings: read them as "starts a word". */
export function asRules(raw: { refinancing: (Keyword | string)[]; financing: (Keyword | string)[]; fallback: ClassificationValue }): ClassificationRules {
  const k = (x: Keyword | string): Keyword => (typeof x === "string" ? { text: x, wholeWord: false } : { text: x.text, wholeWord: !!x.wholeWord });
  return { refinancing: raw.refinancing.map(k), financing: raw.financing.map(k), fallback: raw.fallback === "FINANCING" ? "FINANCING" : "REFINANCING" };
}

const HYPHENS = /[-‐-―]/g;
/** Lower case, hyphens removed, runs of spaces made one, trimmed: how keywords are stored and compared. */
export function normalizeForMatch(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(HYPHENS, "").replace(/\s+/g, " ").trim();
}
/** The words of a name in both hyphen forms (removed inside words, and as breaks). */
function wordsOf(name: string | null | undefined): string[][] {
  const base = (name ?? "").toLowerCase();
  const split = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);
  return [split(base.replace(HYPHENS, "")), split(base.replace(HYPHENS, " "))];
}
/** Does the keyword (one or more words) start a word, or match whole words, in this word list? */
function matchesWords(words: string[], kw: Keyword): boolean {
  const parts = normalizeForMatch(kw.text).split(/[^a-z0-9]+/).filter(Boolean);
  if (!parts.length) return false;
  for (let i = 0; i + parts.length <= words.length; i++) {
    const ok = parts.every((p, j) => {
      const w = words[i + j];
      const last = j === parts.length - 1;
      // Inner words of a multi-word keyword match whole; the last one may be the start of a word.
      return last && !kw.wholeWord ? w.startsWith(p) : w === p;
    });
    if (ok) return true;
  }
  return false;
}

export interface ClassifyResult {
  classification: ClassificationValue;
  /** Which step decided it. */
  step: "REFINANCING_KEYWORD" | "FINANCING_KEYWORD" | "DEFAULT";
  /** The keyword that matched (its text as saved), for steps 1 and 2. */
  keyword: string | null;
}

export function classifyByKeywords(productName: string | null | undefined, rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES): ClassifyResult {
  const forms = wordsOf(productName);
  const hit = (list: Keyword[]) => list.find((k) => forms.some((ws) => matchesWords(ws, k)))?.text ?? null;
  const refi = hit(rules.refinancing);
  if (refi) return { classification: "REFINANCING", step: "REFINANCING_KEYWORD", keyword: refi };
  const fin = hit(rules.financing);
  if (fin) return { classification: "FINANCING", step: "FINANCING_KEYWORD", keyword: fin };
  return { classification: rules.fallback, step: "DEFAULT", keyword: null };
}

/**
 * Cleans one keyword list from Settings: trimmed, lower case, no duplicates (the first one's tickbox wins),
 * no blanks. Returns a plain-language problem instead when the list cannot be saved.
 */
export function cleanKeywords(list: Keyword[]): { keywords: Keyword[]; problem: string | null } {
  const seen = new Set<string>();
  const keywords: Keyword[] = [];
  for (const k of list) {
    const text = k.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    keywords.push({ text, wholeWord: !!k.wholeWord });
  }
  const bad = keywords.find((k) => normalizeForMatch(k.text).replace(/ /g, "").length < 3);
  if (bad) return { keywords, problem: `"${bad.text}" is too short: use at least 3 letters, so it does not match every product name.` };
  if (keywords.length > 30) return { keywords, problem: "Keep each list to 30 keywords or fewer." };
  return { keywords, problem: null };
}

/** "Refinancing" / "Financing". */
export const classificationWord = (c: ClassificationValue) => (c === "FINANCING" ? "Financing" : "Refinancing");
