/**
 * The PN (promissory note number) format: one shared parser for Find loan, the search box, imports and
 * the MyLoans client. Pure (safe in the browser: Settings, "Try a PN").
 *
 *   GD 101 2026 9 00001  ->  GD1012026900001 (15 characters)
 *   |  |   |    | +-- running number (5 digits)
 *   |  |   |    +---- the MyLoans system digit (always 9)
 *   |  |   +--------- year (4 digits, not in the future)
 *   |  +------------- branch code (3 digits, 100 to 999): where the loan was OPENED, a hint only
 *   +---------------- prefix GD
 *
 * The rules are an Admin setting (Settings, System, PN format); the check can be switched off.
 */

export interface PnFormat {
  /** Off: any cleaned input is taken as a PN (no parts). */
  enabled: boolean;
  /** Letters, e.g. "GD". */
  prefix: string;
  branchDigits: number;
  yearDigits: number;
  /** The system digit(s) after the year, e.g. "9". */
  system: string;
  runningDigits: number;
}

export const DEFAULT_PN_FORMAT: PnFormat = { enabled: true, prefix: "GD", branchDigits: 3, yearDigits: 4, system: "9", runningDigits: 5 };

export interface PnParts {
  prefix: string;
  branchCode: string;
  year: string;
  system: string;
  running: string;
}

export type PnPart = "empty" | "prefix" | "chars" | "length" | "branch" | "year" | "system" | "running";

export type PnParse =
  | { ok: true; pn: string; parts: PnParts | null }
  | { ok: false; cleaned: string; part: PnPart; message: string };

/** Trim, upper case, remove spaces, dashes and dots: "gd 101-2026-9-00001" -> "GD1012026900001". */
export function cleanPn(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-.–—]/g, "");
}

/** The example PN for a format: prefix, branch 101, this year, the system digit, running number 1. */
export function examplePn(f: PnFormat = DEFAULT_PN_FORMAT, year = 2026): string {
  const branch = "101".padStart(f.branchDigits, "1").slice(-f.branchDigits);
  return `${f.prefix}${branch}${String(year).slice(-f.yearDigits).padStart(f.yearDigits, "0")}${f.system}${"1".padStart(f.runningDigits, "0")}`;
}

/** "This does not look like a PN. Example: GD1012026900001" */
export const pnHeadline = (f: PnFormat = DEFAULT_PN_FORMAT) => `This does not look like a PN. Example: ${examplePn(f)}`;

/** The pattern in words, for Settings and help text. */
export function describePn(f: PnFormat = DEFAULT_PN_FORMAT): { pattern: string; parts: { label: string; rule: string; example: string }[]; length: number } {
  const ex = examplePn(f);
  let i = f.prefix.length;
  const cut = (n: number) => { const s = ex.slice(i, i + n); i += n; return s; };
  const prefix = ex.slice(0, f.prefix.length);
  const parts = [
    { label: "Prefix", rule: `Always ${f.prefix}`, example: prefix },
    { label: "Branch code", rule: `${f.branchDigits} digits (where the loan was opened)`, example: cut(f.branchDigits) },
    { label: "Year", rule: `${f.yearDigits} digits, not in the future`, example: cut(f.yearDigits) },
    { label: "System", rule: `Always ${f.system} (the MyLoans system)`, example: cut(f.system.length) },
    { label: "Running number", rule: `${f.runningDigits} digits`, example: cut(f.runningDigits) },
  ];
  const hash = (n: number) => "#".repeat(n);
  return { pattern: `${f.prefix} ${hash(f.branchDigits)} ${hash(f.yearDigits)} ${f.system} ${hash(f.runningDigits)}`, parts, length: ex.length };
}

const digitsWord = (n: number) => `${n} digit${n === 1 ? "" : "s"}`;

/**
 * Cleans the input, then checks it against the format. Returns the PN as it will be stored and its parts,
 * or which part is wrong in plain words. `now` decides "the year is in the future".
 */
export function parsePn(input: string, f: PnFormat = DEFAULT_PN_FORMAT, now: Date = new Date()): PnParse {
  const cleaned = cleanPn(input);
  const bad = (part: PnPart, message: string): PnParse => ({ ok: false, cleaned, part, message });
  if (!cleaned) return bad("empty", "Type a PN.");
  if (!f.enabled) return { ok: true, pn: cleaned, parts: null };

  const prefix = f.prefix.toUpperCase();
  if (!cleaned.startsWith(prefix)) {
    return bad("prefix", /^\d+$/.test(cleaned) ? `The PN must start with ${prefix}.` : `The PN must start with ${prefix}, not ${cleaned.replace(/\d.*$/, "") || cleaned.slice(0, 2)}.`);
  }
  const digits = cleaned.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return bad("chars", `After ${prefix} a PN has only numbers.`);

  const yearNow = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric" }).format(now));
  const expected = f.branchDigits + f.yearDigits + f.system.length + f.runningDigits;
  let b = f.branchDigits;
  if (digits.length !== expected) {
    // Find the year and the system digit to say which part has the wrong length.
    const y4 = f.yearDigits === 4;
    let found = -1;
    for (let i = 1; i + f.yearDigits + f.system.length <= digits.length; i++) {
      const y = digits.slice(i, i + f.yearDigits);
      if (digits.slice(i + f.yearDigits, i + f.yearDigits + f.system.length) !== f.system) continue;
      if (y4 && !/^20\d\d$/.test(y)) continue;
      found = i;
      break;
    }
    if (found >= 0) {
      const running = digits.length - found - f.yearDigits - f.system.length;
      if (found !== f.branchDigits) return bad("branch", `The branch code must be ${digitsWord(f.branchDigits)} (this one has ${found}).`);
      if (running !== f.runningDigits) return bad("running", `The running number must be ${digitsWord(f.runningDigits)} (this one has ${running}).`);
    }
    return bad("length", `A PN has ${prefix.length + expected} characters (${prefix} and ${expected} numbers); this one has ${cleaned.length}.`);
  }
  const branchCode = digits.slice(0, b);
  const year = digits.slice(b, (b += f.yearDigits));
  const system = digits.slice(b, (b += f.system.length));
  const running = digits.slice(b);
  if (/^0/.test(branchCode)) return bad("branch", `The branch code must be ${digitsWord(f.branchDigits)}, ${"1".padEnd(f.branchDigits, "0")} to ${"9".repeat(f.branchDigits)}.`);
  const fullYear = f.yearDigits === 2 ? 2000 + Number(year) : Number(year);
  if (fullYear > yearNow) return bad("year", `The year is in the future (${year}).`);
  if (f.yearDigits === 4 && fullYear < 2000) return bad("year", `The year ${year} does not look right.`);
  if (system !== f.system) return bad("system", `The number after the year must be ${f.system} (the MyLoans system), not ${system}.`);
  if (/^0+$/.test(running)) return bad("running", `The running number cannot be all zeros.`);
  return { ok: true, pn: cleaned, parts: { prefix, branchCode, year, system, running } };
}

/**
 * Does the text look like someone typing a PN (rather than a CIN, CIF, a label code or a name)?
 * Used by Find loan to show the PN error instead of searching. With the check off, nothing is refused.
 */
export function isPnAttempt(input: string, f: PnFormat = DEFAULT_PN_FORMAT): boolean {
  const c = cleanPn(input);
  if (!c || !f.enabled) return false;
  const prefix = f.prefix.toUpperCase();
  // "GD" followed by a digit, or a long run of digits (a PN typed without its prefix).
  if (c.startsWith(prefix) && /^\d/.test(c.slice(prefix.length))) return true;
  return /^\d{10,}$/.test(c);
}

/** Builds a PN from its parts (the sample MyLoans, the simulator): GD + branch + year + system + running. */
export function buildPn(branchCode: string, year: number | string, running: number, f: PnFormat = DEFAULT_PN_FORMAT): string {
  return `${f.prefix}${branchCode}${String(year).slice(-f.yearDigits)}${f.system}${String(running).padStart(f.runningDigits, "0")}`;
}

/** Validates the setting itself (Settings, System, PN format). Returns a message or null. */
export function pnFormatProblem(f: PnFormat): string | null {
  if (!/^[A-Z]{1,5}$/.test(f.prefix)) return "Prefix: 1 to 5 capital letters.";
  for (const [label, n, lo, hi] of [["Branch code", f.branchDigits, 2, 5], ["Year", f.yearDigits, 2, 4], ["Running number", f.runningDigits, 3, 8]] as const) {
    if (!Number.isInteger(n) || n < lo || n > hi) return `${label}: ${lo} to ${hi} digits.`;
  }
  if (f.yearDigits !== 2 && f.yearDigits !== 4) return "Year: 2 or 4 digits.";
  if (!/^\d{1,2}$/.test(f.system)) return "System: 1 or 2 digits.";
  return null;
}
