import { peso } from "./rules";

/** The Finance funds tabs and their statuses (the CSV follows the tab picked on the page). */
export const FUNDS_TAB_STATUS: Record<string, string[]> = {
  approve: ["REQUESTED"],
  release: ["APPROVED"],
  outstanding: ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED", "LIQUIDATED"],
  history: ["CLOSED", "DENIED", "CANCELLED"],
};

export interface FundsCsvRow {
  number: string; typeCode: string; typeName: string; status: string; processor: string; branch: string;
  requestedCents: number; approvedCents: number | null; releasedCents: number; receiptCents: number; returnedCents: number;
  releasedOn: string; releaseRef: string; transferDate: string; accountProvider: string; accountName: string; accountLast4: string;
  liquidateBy: string; cashToSettle: boolean; lines: string;
}

export const FUNDS_CSV_HEADER = [
  "Number", "Type", "Type name", "Status", "Processor", "Branch", "Requested", "Approved", "Released", "Receipts", "Returned", "Balance",
  "Released on", "Reference", "Transfer date", "Receiving account", "Liquidate by", "Cash to settle", "For",
];

/** A cell safe for Excel: text that looks like a formula gets a leading quote; commas, quotes and new lines are quoted. */
export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The funds CSV: one row per record, with the Type column. Only the last 4 digits of an account ever appear. */
export function fundsCsv(rows: FundsCsvRow[]): string {
  const out = [FUNDS_CSV_HEADER.join(",")];
  for (const r of rows) {
    const balance = r.releasedCents - r.receiptCents - r.returnedCents;
    out.push([
      r.number, r.typeCode, r.typeName, r.status, r.processor, r.branch, peso(r.requestedCents), r.approvedCents === null ? "" : peso(r.approvedCents), peso(r.releasedCents),
      peso(r.receiptCents), peso(r.returnedCents), peso(balance), r.releasedOn, r.releaseRef, r.transferDate,
      r.accountLast4 ? `${r.accountProvider}, ${r.accountName}, ending ${r.accountLast4}` : "", r.liquidateBy, r.cashToSettle ? "Yes" : "", r.lines,
    ].map(csvCell).join(","));
  }
  return out.join("\r\n");
}
