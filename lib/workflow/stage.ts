/**
 * Loan File stage, computed from its transactions (never typed in). Pure.
 * A loan shows the earliest step any live transaction still needs, so it can step backwards
 * when one transaction is declined or returned.
 */

export const STAGES = [
  "Opened",
  "For checklist",
  "No DP assignment required",
  "Assigned to DP",
  "In process",
  "Awaiting LA acceptance",
  "For Vault Transmittal",
  "In transit to Vault",
  "In Safekeeping",
  "Closed",
  "Cancelled in MyLoans",
  "Archived",
  "Disposed",
] as const;
export type Stage = (typeof STAGES)[number];

export type TxnStatus =
  | "FOR_CHECKLIST"
  | "READY"
  | "ASSIGNED"
  | "RETURNED"
  | "IN_PROCESS"
  | "FORWARDED"
  | "COMPLETED"
  | "CANCELLED";

export interface StageInput {
  transactions: { requiresDp: boolean; status: TxnStatus }[];
  /** Cash advance statuses for the loan. */
  /** Some transaction still has funds that are not Settled (or Not needed): step 5.3 waits for them. */
  fundsOpen?: boolean;
  /** Stages of physical document items (those with a Document ID). */
  documentStages?: string[];
  closedAt?: Date | null;
  /** Closed as cancelled in MyLoans (Admin review). */
  cancelledAt?: Date | null;
  archivedAt?: Date | null;
  disposedAt?: Date | null;
}

const WITH_LA: TxnStatus[] = ["FOR_CHECKLIST", "READY", "RETURNED"];

export function computeStage(input: StageInput): Stage {
  if (input.disposedAt) return "Disposed";
  if (input.archivedAt) return "Archived";
  if (input.closedAt) return "Closed";
  if (input.cancelledAt) return "Cancelled in MyLoans";

  const live = input.transactions.filter((t) => t.status !== "CANCELLED");
  if (live.length === 0) return "Opened";

  if (live.some((t) => WITH_LA.includes(t.status))) {
    return live.every((t) => !t.requiresDp) ? "No DP assignment required" : "For checklist";
  }
  if (live.some((t) => t.status === "ASSIGNED")) return "Assigned to DP";
  if (live.some((t) => t.status === "IN_PROCESS")) return "In process";
  if (live.some((t) => t.status === "FORWARDED")) return "Awaiting LA acceptance";

  // All live transactions are COMPLETED.
  // Step 5.3: all transactions complete AND all their funds Settled or Not needed.
  if (input.fundsOpen) return "In process"; // funds still to be liquidated (step 4.5)

  const docs = input.documentStages ?? [];
  if (docs.some((s) => s === "IN_TRANSIT")) return "In transit to Vault";
  if (docs.length > 0 && docs.every((s) => s === "IN_SAFEKEEPING")) return "In Safekeeping";
  return "For Vault Transmittal";
}

// Stage names, next steps and owners on screen: lib/workflow/stage-map.ts (the one source).
