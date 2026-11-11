import { PERMISSIONS as P, type Permission } from "@/lib/auth/permissions";

/**
 * The kit's example roles for funds handled by different people (Settings, Roles): Finance and an
 * approver for each type, with only that type's ticks. The kit's Finance and approver roles keep both.
 */
export type TypeRoleKey = "FIN_CA" | "FIN_FT" | "APPR_CA" | "APPR_FT";

const fin = (t: "CA" | "FT"): Permission[] => [
  P.LOANS_VIEW, P.FUNDS_KINDS_VIEW, P.FUNDS_KINDS_MANAGE, P.JOURNEY_VIEW_AMOUNTS, P.MYLOANS_VIEW, P.SOURCE_REVIEW_BORROWER,
  ...(t === "CA"
    ? [P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_RELEASE, P.FUNDS_CA_SETTLE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_CHANGE_TYPE, P.FUNDS_CA_PRINT]
    : [P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_RELEASE, P.FUNDS_FT_SETTLE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_CHANGE_TYPE, P.FUNDS_FT_PRINT]),
];
// Approvers review the borrower detail corrections too (myloans:review_borrower is on for every funds approver).
const appr = (t: "CA" | "FT"): Permission[] => [
  P.LOANS_VIEW, P.FUNDS_KINDS_VIEW, P.SOURCE_REVIEW_BORROWER,
  ...(t === "CA" ? [P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_PRINT] : [P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_PRINT]),
];

export const TYPE_ROLES: Record<TypeRoleKey, { name: string; description: string; permissions: Permission[] }> = {
  FIN_CA: { name: "Finance (cash advance)", description: "Sample role (Manual Test Kit): Finance for cash advances only.", permissions: fin("CA") },
  FIN_FT: { name: "Finance (fund transfer)", description: "Sample role (Manual Test Kit): Finance for fund transfers only.", permissions: fin("FT") },
  APPR_CA: { name: "Approver (cash advance)", description: "Sample role (Manual Test Kit): approves cash advances only; it shares the kit's Cash advance bands.", permissions: appr("CA") },
  APPR_FT: { name: "Approver (fund transfer)", description: "Sample role (Manual Test Kit): approves fund transfers only; it shares the kit's Fund transfer bands.", permissions: appr("FT") },
};

/** The kit approvers of the clean kit keep both types (as before the split). */
export const BOTH_TYPES_APPROVER: Permission[] = [
  P.LOANS_VIEW, P.FUNDS_KINDS_VIEW, P.SOURCE_REVIEW_BORROWER,
  P.FUNDS_CA_VIEW, P.FUNDS_CA_APPROVE, P.FUNDS_CA_EDIT_LINES, P.FUNDS_CA_PRINT,
  P.FUNDS_FT_VIEW, P.FUNDS_FT_APPROVE, P.FUNDS_FT_EDIT_LINES, P.FUNDS_FT_PRINT,
];
