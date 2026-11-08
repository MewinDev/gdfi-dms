/**
 * Funds rules (pure). Money is integer centavos everywhere; shown as ₱12,500.00.
 */
import { addBusinessDays, businessDate, businessDaysBetween, endOfBusinessDay } from "@/lib/time";

export const EXPENSE_KINDS = ["NOTARY_FEE", "PPSR_FEE", "LTO_FEE", "TRANSPORT", "OTHER"] as const;
export type ExpenseKindKey = (typeof EXPENSE_KINDS)[number];
export const EXPENSE_LABEL: Record<ExpenseKindKey, string> = {
  NOTARY_FEE: "Notary fee", PPSR_FEE: "PPSR fee", LTO_FEE: "LTO fee", TRANSPORT: "Transport", OTHER: "Other",
};

/** "₱12,500.00" from centavos. */
export function peso(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-PH");
  return `${sign}₱${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Centavos from typed text ("12,500", "12500.5", "₱1,000.00"). Null when it is not a valid amount. Never uses floats for the result. */
export function toCents(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const s = String(text).replace(/[₱,\s]/g, "");
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Centavos from a Prisma Decimal / number of pesos (e.g. settings amounts). */
export const decimalToCents = (v: { toString(): string } | number | null | undefined): number | null => (v === null || v === undefined ? null : toCents(String(v)));

// ---------------------------------------------------------------------------
// Status of a transaction's funds (derived)
// ---------------------------------------------------------------------------

export type FundsStatus = "NOT_NEEDED" | "NEEDED" | "REQUESTED" | "FUNDED" | "SETTLED" | "DENIED";
export const FUNDS_LABEL: Record<FundsStatus, string> = {
  NOT_NEEDED: "No funds needed", NEEDED: "Needs funds", REQUESTED: "Funds requested", FUNDED: "Funded", SETTLED: "Settled", DENIED: "Denied",
};

export interface LineLike {
  denied: boolean;
  releasedCents: number;
  advanceStatus: string;
}

/** From the LA's flag and the transaction's advance lines. */
export function fundsStatus(needed: "UNANSWERED" | "YES" | "NO", lines: LineLike[]): FundsStatus {
  if (needed !== "YES") return "NOT_NEEDED";
  const live = lines.filter((l) => !["CANCELLED"].includes(l.advanceStatus));
  if (live.length === 0) return "NEEDED";
  const open = live.filter((l) => !l.denied && l.advanceStatus !== "DENIED");
  if (open.length === 0) return "DENIED";
  if (open.every((l) => ["LIQUIDATED", "CLOSED"].includes(l.advanceStatus))) return "SETTLED";
  if (open.some((l) => l.releasedCents > 0)) return "FUNDED";
  return "REQUESTED";
}

/** Settled for the stage gate: no funds needed, or settled. */
export const fundsDone = (s: FundsStatus) => s === "NOT_NEEDED" || s === "SETTLED";

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** Advance balance = released − liquidated (receipts) − returned. */
export function advanceBalance(a: { releasedCents: number; receiptCents: number; returnedCents: number }): number {
  return a.releasedCents - a.receiptCents - a.returnedCents;
}

/** Status after receipts/returns (released advances only). */
export function liquidationStatus(a: { releasedCents: number; receiptCents: number; returnedCents: number; status: string }): string {
  if (!["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED", "LIQUIDATED"].includes(a.status)) return a.status;
  const bal = advanceBalance(a);
  if (a.releasedCents > 0 && bal <= 0) return "LIQUIDATED";
  if (a.receiptCents + a.returnedCents > 0) return "PARTIALLY_LIQUIDATED";
  return a.status === "FOR_LIQUIDATION" ? "FOR_LIQUIDATION" : "RELEASED";
}

/** Money left on a line for the next attempt = released − spent − returned. */
export const lineBalance = (l: { releasedCents: number; spentCents: number; returnedCents: number }) => l.releasedCents - l.spentCents - l.returnedCents;

// ---------------------------------------------------------------------------
// Due dates, overdue, carry-over, approval bands
// ---------------------------------------------------------------------------

/** Liquidation due date: business days from the release (or the latest carry-over decision). */
export function liquidationDue(from: Date, dueDays: number, holidays: ReadonlySet<string>): Date {
  const ymd = addBusinessDays(businessDate(from), dueDays, holidays);
  return endOfBusinessDay(ymd);
}

export const OPEN_ADVANCE = ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"];
export function isOverdue(a: { status: string; liquidationDueAt: Date | null }, now: Date): boolean {
  return OPEN_ADVANCE.includes(a.status) && !!a.liquidationDueAt && a.liquidationDueAt.getTime() < now.getTime();
}

/**
 * Carry-over: without approval while the balance covers the next attempt (above zero) and the number of
 * business days since the line's first carry-over is within the limit; otherwise it needs approval.
 */
export function carryOverDecision(input: { balanceCents: number; firstCarryOver: Date | null; now: Date; limitDays: number; holidays: ReadonlySet<string> }): { status: "AUTO" | "PENDING"; businessDays: number } {
  const days = input.firstCarryOver ? businessDaysBetween(businessDate(input.firstCarryOver), businessDate(input.now), input.holidays) : 0;
  return { status: input.balanceCents > 0 && days <= input.limitDays ? "AUTO" : "PENDING", businessDays: days };
}

export interface Band { fromCents: number; roleId: string; active: boolean }
/** The band that applies to an amount: the active band with the highest "from" at or below it. */
export function bandFor(amountCents: number, bands: Band[]): Band | null {
  return [...bands].filter((b) => b.active && b.fromCents <= amountCents).sort((a, b) => b.fromCents - a.fromCents)[0] ?? null;
}

/** Days outstanding bucket for the Outstanding tab. */
export function ageBucket(days: number): "0-10" | "11-30" | "31-60" | "60+" {
  return days <= 10 ? "0-10" : days <= 30 ? "11-30" : days <= 60 ? "31-60" : "60+";
}
