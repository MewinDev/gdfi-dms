/**
 * MyLoans transaction status: the id MyLoans gives (TransactionStatusId) and its name
 * (TransactionStatusName, which MyLoans builds as COALESCE(description, name) from TransactionStatuses).
 *
 * The DMS accepts ONE status: 12, "Loan Released". This file is the only place that knows that number:
 * every other check goes through isAcceptedStatus / statusKind / recordStatusKind (no setting, no table).
 *   1 to 11, 13, 49  before release (1, 3, 4 and 13 have no PN yet, so they cannot be found by PN)
 *   12               released (the last status of a loan)
 *   14               cancelled
 *   15 to 19         disbursement-check records, not account statuses: never a loan (the MyLoans view
 *                    never returns them; if one arrives anyway it counts as "no loan found")
 */
const ACCEPTED_STATUS_ID = "12";

/** Names for the ids MyLoans confirmed, used only when MyLoans sends no name. Any other id shows as "Status 7". */
export const STATUS_NAMES: Readonly<Record<string, string>> = {
  "8": "Check Prepared",
  "11": "For Approval (Loan Released)",
  "12": "Loan Released",
  "14": "Cancelled",
  "49": "Check Assignment (Transaction)",
};

export type StatusKind = "released" | "before_release" | "cancelled" | "not_a_loan" | "other";

const clean = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const idNumber = (id: unknown): number | null => {
  const c = clean(id);
  return c !== null && /^\d+$/.test(c) ? Number(c) : null;
};

/** True only for the one status the DMS accepts (12, Loan Released). */
export function isAcceptedStatus(id: unknown): boolean {
  const n = idNumber(id);
  return n !== null && String(n) === ACCEPTED_STATUS_ID;
}

/** What a MyLoans status id means to the DMS. */
export function statusKind(id: unknown): StatusKind {
  const n = idNumber(id);
  if (n === null) return "other";
  if (isAcceptedStatus(n)) return "released";
  if ((n >= 1 && n <= 11) || n === 13 || n === 49) return "before_release";
  if (n === 14) return "cancelled";
  if (n >= 15 && n <= 19) return "not_a_loan";
  return "other";
}

/**
 * The kind of a record: by its MyLoans status id when it has one; otherwise by the DMS status word (a
 * record from before ids were sent, or a status the simulator set: RELEASED, CANCELLED...).
 */
export function recordStatusKind(r: { statusId?: string | null; status?: string | null }): StatusKind {
  if (clean(r.statusId) !== null) return statusKind(r.statusId);
  const w = (clean(r.status) ?? "").toUpperCase();
  if (w === "RELEASED") return "released";
  if (w === "CANCELLED" || w === "CANCELED") return "cancelled";
  if (w === "NOT_RELEASED" || w === "PENDING") return "before_release";
  const m = /^STATUS_(\d+)$/.exec(w);
  return m ? statusKind(m[1]) : "other";
}

/** The DMS status word for an accepted record. */
export const RELEASED_WORD = "RELEASED";
/** The id and name the DMS gives a record it marks released itself (the sample MyLoans, the simulator). */
export const releasedStatus = () => ({ statusId: ACCEPTED_STATUS_ID, statusName: STATUS_NAMES[ACCEPTED_STATUS_ID] });

/**
 * From MyLoans' status id (and name, when MyLoans sends one) to the DMS status word and the name to show.
 * The accepted id is RELEASED; any other id is "STATUS_<id>" (not accepted).
 */
export function statusFromId(id: unknown, name?: unknown): { status: string | null; statusId: string | null; statusName: string | null } {
  const statusId = clean(id);
  if (statusId === null) return { status: null, statusId: null, statusName: clean(name) };
  return {
    status: isAcceptedStatus(statusId) ? RELEASED_WORD : `STATUS_${statusId}`,
    statusId,
    statusName: clean(name) ?? STATUS_NAMES[statusId] ?? `Status ${statusId}`,
  };
}

/** The status name to show a person: MyLoans' name, else the id ("Status 7"), else the DMS word in plain case. */
export function statusLabel(r: { statusName?: string | null; statusId?: string | null; status?: string | null }): string {
  if (clean(r.statusName)) return clean(r.statusName)!;
  if (clean(r.statusId)) return STATUS_NAMES[clean(r.statusId)!] ?? `Status ${clean(r.statusId)}`;
  const w = clean(r.status);
  if (!w) return "No status";
  if (recordStatusKind({ status: w }) === "released") return releasedStatus().statusName;
  return w.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
