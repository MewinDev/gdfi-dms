import { z } from "zod";

/**
 * Funds types (pure). Settings > Funds types holds the list (seeded: Cash advance CA, Fund transfer FT).
 * Every type follows the same funds flow (request, approve, release, receipts, liquidation, close,
 * overdue). The switches only change what Finance enters at release, and whether receipts are needed.
 */

export interface FundsTypeLike {
  id: string;
  code: string;
  name: string;
  active?: boolean;
  needsReference: boolean;
  needsAccount: boolean;
  mustLiquidate: boolean;
}

/** The seeded types (the migration and the seed use the same values). */
export const SEEDED_FUNDS_TYPES = [
  { id: "fundstype_ca", code: "CA", name: "Cash advance", sortOrder: 1, needsReference: false, needsAccount: false, mustLiquidate: true },
  { id: "fundstype_ft", code: "FT", name: "Fund transfer", sortOrder: 2, needsReference: true, needsAccount: true, mustLiquidate: true },
] as const;
export const DEFAULT_FUNDS_TYPE_CODE = "CA";

/** "CA · Cash advance": the pill and the lists. */
export const fundsTypeLabel = (t: { code: string; name: string }) => `${t.code} · ${t.name}`;

/** A transfer type (needs a reference or an account) is "sent"; cash is "released". */
export const isTransfer = (t: Pick<FundsTypeLike, "needsReference" | "needsAccount">) => t.needsReference || t.needsAccount;
/** The release button: "Release cash" for Cash advance, "Send transfer" for Fund transfer. */
export const releaseVerb = (t: Pick<FundsTypeLike, "needsReference" | "needsAccount">) => (isTransfer(t) ? "Send transfer" : "Release cash");

/** The pill colour: the first seeded type (CA) and every other type get two different soft colours. */
export const pillTone = (code: string): "ca" | "ft" => (code.toUpperCase() === DEFAULT_FUNDS_TYPE_CODE ? "ca" : "ft");

/** The default type for a new request: Cash advance if active, otherwise the first active type. */
export function defaultFundsType<T extends { code: string; active?: boolean }>(types: T[]): T | null {
  const live = types.filter((t) => t.active !== false);
  return live.find((t) => t.code === DEFAULT_FUNDS_TYPE_CODE) ?? live[0] ?? null;
}

/** Remarks when Finance changes the type: 5 to 500 characters. */
export const typeChangeRemarks = z.string({ message: "Write 5 to 500 characters." }).trim().min(5, "Write 5 to 500 characters.").max(500, "Write 5 to 500 characters.");

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** Only the last 4 digits of an account number. Anything longer is refused: the full number is never stored. */
export function last4Refusal(input: string | null | undefined): string | null {
  const v = (input ?? "").replace(/[\s-]/g, "");
  if (!v) return "Enter the last 4 digits of the receiving account.";
  if (/^\d{5,}$/.test(v)) return "Enter only the last 4 digits. The full account number is never stored.";
  if (!/^\d{4}$/.test(v)) return "Enter the last 4 digits (numbers only).";
  return null;
}

export interface ReleaseInput {
  ref?: string;
  date?: string;
  transferDate?: string;
  accountProvider?: string;
  accountName?: string;
  accountLast4?: string;
}
export interface ReleaseDetails { ref: string; transferDate: string; accountProvider: string; accountName: string; accountLast4: string }

/**
 * What Finance must enter at release, by type. Every type keeps today's reference note (voucher or
 * transfer number). A type that needs a reference number also needs the transfer date; a type that
 * needs account details needs the bank or e-wallet, the account name and the last 4 digits.
 * Returns the details to store, or the first problem with the field it belongs to.
 */
export function checkRelease(t: Pick<FundsTypeLike, "needsReference" | "needsAccount">, raw: ReleaseInput): { ok: true; details: ReleaseDetails } | { ok: false; message: string; field: string } {
  const ref = (raw.ref ?? "").trim();
  if (t.needsReference) {
    if (ref.length < 4) return { ok: false, message: "Enter the transfer reference number.", field: "ref" };
    if (!ymd.test(raw.transferDate ?? "")) return { ok: false, message: "Pick the transfer date.", field: "transferDate" };
  } else if (ref.length < 2) {
    return { ok: false, message: "Add a reference note (voucher or transfer number).", field: "ref" };
  }
  if (ref.length > 60) return { ok: false, message: "Keep the reference under 60 characters.", field: "ref" };
  let account = { accountProvider: "", accountName: "", accountLast4: "" };
  if (t.needsAccount) {
    const provider = (raw.accountProvider ?? "").trim();
    const name = (raw.accountName ?? "").trim();
    if (provider.length < 2) return { ok: false, message: "Enter the bank or e-wallet.", field: "accountProvider" };
    if (name.length < 2) return { ok: false, message: "Enter the account name.", field: "accountName" };
    const bad = last4Refusal(raw.accountLast4);
    if (bad) return { ok: false, message: bad, field: "accountLast4" };
    account = { accountProvider: provider.slice(0, 60), accountName: name.slice(0, 80), accountLast4: (raw.accountLast4 ?? "").replace(/[\s-]/g, "") };
  }
  return { ok: true, details: { ref, transferDate: t.needsReference ? raw.transferDate! : "", ...account } };
}

/** One line for the history and the lists: "Ref FT-889 · sent 2026-11-09 · to BPI, Juan Cruz, account ending 1234". */
export function releaseLine(r: { releaseRef: string; transferDate: string; accountProvider: string; accountName: string; accountLast4: string }): string {
  const parts = [r.releaseRef ? `Ref ${r.releaseRef}` : ""];
  if (r.transferDate) parts.push(`sent ${r.transferDate}`);
  if (r.accountLast4) parts.push(`to ${r.accountProvider}, ${r.accountName}, account ending ${r.accountLast4}`);
  return parts.filter(Boolean).join(" · ");
}
