/**
 * MyLoans transaction status: the id MyLoans gives (TransactionStatusId) and its name.
 *
 * TO CONFIRM (MyLoans team, docs/myloans/field-map.md question 4): the list of status ids and names. The
 * source query only returns status 12, "Loan Released", and has no name column yet. Until MyLoans sends
 * TransactionStatusName this small lookup is the only place that names a status id. Any other id shows as
 * "Status 7" and counts as NOT released (the Data Check refuses it).
 */
export const STATUS_NAMES: Readonly<Record<string, string>> = { "12": "Loan Released" };
/** The status id that means released. */
export const RELEASED_STATUS_ID = "12";

const clean = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

/**
 * From MyLoans' status id (and name, when MyLoans sends one) to the DMS status word and the name to show.
 * 12 is RELEASED; any other id is "STATUS_<id>" (not released).
 */
export function statusFromId(id: unknown, name?: unknown): { status: string | null; statusId: string | null; statusName: string | null } {
  const statusId = clean(id);
  if (statusId === null) return { status: null, statusId: null, statusName: clean(name) };
  return {
    status: statusId === RELEASED_STATUS_ID ? "RELEASED" : `STATUS_${statusId}`,
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
  if (w.toUpperCase() === "RELEASED") return STATUS_NAMES[RELEASED_STATUS_ID];
  return w.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
