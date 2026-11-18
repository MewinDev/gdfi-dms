import { normalizeForMatch } from "./classify";

/**
 * D-049: products the business has not decided yet. They are NOT pre-set: the LA Supervisor/Head sets them on the
 * Product classification screen once decided. Until then the screen shows a small "Please confirm" note on them.
 * Matched on the product name (case, hyphens and spaces ignored).
 */
export const PLEASE_CONFIRM: { label: string; matches: (name: string) => boolean }[] = [
  { label: "SME - Car Financing (R)", matches: (n) => n.includes("car financing (r)") || n.includes("car financing r") },
  { label: "Personal/SME REM Financing", matches: (n) => n.includes("rem financing") },
  // The three real-estate take-outs the keywords do not settle (REF Developer In-House, REF Division / REM, Developer
  // Real Estate In-House); a "Refinancing ... Take Out" is already Refinancing by its keyword.
  { label: "Real-estate Take Out", matches: (n) => (n.includes("take out") || n.includes("takeout")) && /\b(ref|rem|real estate|developer)\b/.test(n) && !n.includes("refinanc") },
  { label: "Doctors loan", matches: (n) => /\bdoctors?\b/.test(n) },
  { label: "Salary loan", matches: (n) => /\bsalary\b/.test(n) },
  { label: "Tricycle loan", matches: (n) => /\btricycle\b/.test(n) },
];

/** "Please confirm" for an undecided product (null when it is not on the list). */
export function pleaseConfirm(productName: string | null | undefined): string | null {
  const n = normalizeForMatch(productName);
  return PLEASE_CONFIRM.find((p) => p.matches(n))?.label ?? null;
}
