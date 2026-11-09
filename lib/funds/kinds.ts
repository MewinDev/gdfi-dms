/**
 * Expense kinds (Settings > Expense kinds), pure rules. Safe in the browser, the server and the tests.
 * A kind is kept on rules and lines by its code; its name can change; Other (code OTHER) is built in.
 */
import { peso } from "./rules";

export const OTHER = "OTHER";
export type AmountMode = "TYPED" | "SUGGESTED" | "FIXED";
export const AMOUNT_MODES: AmountMode[] = ["TYPED", "SUGGESTED", "FIXED"];
/** Where a line's amount came from (CSV "Amount source", the Journey line). */
export type AmountSource = "RULE" | "PRESET" | "OFFICE" | "TYPED";

/** Highest amount a kind may have: PHP 9,999,999.99. */
export const MAX_KIND_CENTS = 999_999_999;

export interface KindLike {
  code: string;
  name: string;
  active: boolean;
  builtIn?: boolean;
  sortOrder: number;
  amountMode: AmountMode;
  amountCents: number | null;
}

/** Names are unique ignoring case and spaces: "Photo Copy" and "photocopy" are the same name. */
export const nameKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** Trimmed, inner spaces collapsed. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

/** Kind name rules: required, 2 to 40 characters. Null when fine. */
export function kindNameProblem(raw: string): string | null {
  const n = cleanName(raw ?? "");
  if (!n) return "Type the name of the kind.";
  if (n.length < 2) return "The name needs at least 2 characters.";
  if (n.length > 40) return "The name can have at most 40 characters.";
  return null;
}

export const OTHER_MIN = 3;
export const OTHER_MAX = 60;
/** "What is this expense?" for Other: 3 to 60 characters, with at least one letter. Null when fine. */
export function otherDescriptionProblem(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return "Say what this expense is (for example: courier, photocopy, parking).";
  if (t.length < OTHER_MIN) return `Say what this expense is in at least ${OTHER_MIN} characters.`;
  if (t.length > OTHER_MAX) return `Keep what this expense is to ${OTHER_MAX} characters or fewer.`;
  if (!/\p{L}/u.test(t)) return "Say what this expense is in words, not only numbers or symbols.";
  return null;
}

/** The kind as people read it: "Other: Courier", "Other (not described)" for old rows, or the kind's name. */
export function kindText(code: string, name: string | undefined, otherDescription?: string | null): string {
  if (code === OTHER) {
    const d = (otherDescription ?? "").trim();
    return d ? `Other: ${d}` : "Other (not described)";
  }
  return name ?? code;
}

/** Short grey line on the kinds list: "Person enters", "Suggested PHP 500", "Fixed PHP 1,200". */
export function amountModeText(mode: AmountMode, cents: number | null): string {
  if (mode === "TYPED" || cents === null) return "Person enters";
  const amt = `PHP ${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return mode === "FIXED" ? `Fixed ${amt}` : `Suggested ${amt}`;
}

/** Every dropdown: order, then name; Other always last. */
export function sortKinds<T extends { code: string; sortOrder: number; name: string }>(kinds: T[]): T[] {
  return [...kinds].sort((a, b) => (a.code === OTHER ? 1 : 0) - (b.code === OTHER ? 1 : 0) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Kinds offered for new work: active ones, plus the one already on the record (so old records still show it). */
export function kindOptions<T extends KindLike>(kinds: T[], current?: string | null): T[] {
  return sortKinds(kinds.filter((k) => k.active || k.code === current));
}

/**
 * The amount a field starts with when a kind is picked, and where it came from.
 * Order: the LTO office's transport amount (Transport only, as before), the Cash-advance rule's
 * Suggested amount, then the kind's own amount, then nothing. Only the kind's Fixed amount locks it.
 */
export function startingAmount(input: { officeCents?: number | null; ruleSuggestedCents?: number | null; kind?: Pick<KindLike, "amountMode" | "amountCents" | "code"> | null }): { cents: number | null; source: AmountSource | null; locked: boolean } {
  if (input.officeCents != null) return { cents: input.officeCents, source: "OFFICE", locked: false };
  if (input.ruleSuggestedCents != null) return { cents: input.ruleSuggestedCents, source: "RULE", locked: false };
  const k = input.kind;
  if (k && k.code !== OTHER && k.amountMode !== "TYPED" && k.amountCents != null) return { cents: k.amountCents, source: "PRESET", locked: k.amountMode === "FIXED" };
  return { cents: null, source: null, locked: false };
}

/** What a saved line records: the source (TYPED when the person changed the starting value) and the starting value. */
export function lineAmountSource(start: { cents: number | null; source: AmountSource | null; locked: boolean }, finalCents: number): { amountSource: AmountSource; presetCents: number | null; locked: boolean } {
  if (start.cents === null || start.source === null) return { amountSource: "TYPED", presetCents: null, locked: false };
  return { amountSource: start.cents === finalCents ? start.source : "TYPED", presetCents: start.cents, locked: start.locked };
}

/** Grey line under the amount: "Suggested by rule", "Preset for this kind", "Fixed for this kind". */
export function sourceHint(source: AmountSource | null, locked: boolean): string {
  if (source === "RULE") return "Suggested by rule";
  if (source === "OFFICE") return "Suggested by the LTO office";
  if (source === "PRESET") return locked ? "Fixed for this kind (cannot be changed)" : "Preset for this kind";
  return "";
}

/** "Preset was ₱500.00" when the person changed a prefilled amount. */
export function presetWas(presetCents: number | null, cents: number): string {
  return presetCents !== null && presetCents !== cents ? `Preset was ${peso(presetCents)}` : "";
}

export const SOURCE_TEXT: Record<AmountSource, string> = { RULE: "Rule", PRESET: "Preset", OFFICE: "LTO office", TYPED: "Typed" };

/** A code for a new kind, from its name ("Photo copy" -> PHOTO_COPY), unique among the given codes. */
export function codeFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = cleanName(name).normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "KIND";
  let code = /^[A-Z]/.test(base) ? base : `K_${base}`;
  for (let i = 2; used.has(code); i++) code = `${base}_${i}`;
  return code;
}

/** Kind amount rules (form and import). Returns the centavos to store or a plain message. */
export function checkKindAmount(code: string, mode: AmountMode, cents: number | null): { ok: true; cents: number | null } | { ok: false; message: string } {
  if (code === OTHER && mode !== "TYPED") return { ok: false, message: "Other is always entered by the person. It cannot have an amount." };
  if (mode === "TYPED") return { ok: true, cents: null };
  if (cents === null) return { ok: false, message: "Type the amount (whole pesos or two decimals)." };
  if (cents <= 0) return { ok: false, message: "The amount must be more than 0." };
  if (cents > MAX_KIND_CENTS) return { ok: false, message: "The amount can be at most PHP 9,999,999.99." };
  return { ok: true, cents };
}

/** Groups typed Other descriptions ignoring case and spaces; those typed `min` times or more, most first. */
export function otherSuggestions(descriptions: string[], existingNameKeys: Set<string>, min = 3): { text: string; count: number }[] {
  const groups = new Map<string, { texts: Map<string, number>; count: number }>();
  for (const raw of descriptions) {
    const t = cleanName(raw ?? "");
    if (!t) continue;
    const k = nameKey(t);
    const g = groups.get(k) ?? { texts: new Map(), count: 0 };
    g.count++;
    g.texts.set(t, (g.texts.get(t) ?? 0) + 1);
    groups.set(k, g);
  }
  return [...groups.entries()]
    .filter(([k, g]) => g.count >= min && !existingNameKeys.has(k))
    .map(([, g]) => ({ text: [...g.texts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], count: g.count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}
