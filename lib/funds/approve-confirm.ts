/**
 * The "Approve this request?" window (pure, browser-safe): the amount in bold and one grey line,
 * "CA-2026-0002 · DP 1 · LTO fee · Elsa Morales". When the approver changed the amounts in the form, the
 * window shows the changed total, not the amount asked.
 */

export interface ApproveConfirmInput {
  number: string;
  /** Who asked (the processor). */
  requester: string;
  /** The expense kinds of the lines ("LTO fee", "Transport"). */
  kinds: string[];
  /** The borrowers of the lines' loans (none for a general expense). */
  borrowers: string[];
  /** What will be approved, in centavos: the changed total when the amounts were changed. */
  cents: number;
}

export interface ApproveConfirmText {
  title: string;
  amount: string;
  line: string;
}

const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

export function approveConfirmText(i: ApproveConfirmInput): ApproveConfirmText {
  const parts = [i.number, i.requester, uniq(i.kinds).join(", "), uniq(i.borrowers).join(", ")].filter((x) => x && x.trim());
  return { title: "Approve this request?", amount: peso(i.cents), line: parts.join(" · ") };
}

/** "1,500.00", "₱1,500", "1500.5" → centavos; anything else → null. Same reading as the approve form. */
export function toCents(text: string | null | undefined): number | null {
  const s = (text ?? "").replace(/[,\s₱]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

/** The total the approver is about to approve: the typed amount of each line (a blank or bad amount counts as 0). */
export function approvedTotal(lines: { id: string }[], typed: Record<string, string>): number {
  return lines.reduce((s, l) => s + (toCents(typed[l.id]) ?? 0), 0);
}
