import { createHash } from "node:crypto";

/**
 * ContentHash, myloans round 2 contract (docs/myloans-api-contract.sql, HI block; D-036).
 *
 * 17 fields joined by "|" (D-037: the birth date is removed; ReplacedByExternalLoanId is field 17), NULL = empty text; SHA-256 over the UTF-16LE bytes (SQL nvarchar); lowercase hex.
 * The DMS only COMPARES hash strings in production: it never recomputes a hash from the data. This
 * implementation exists for the mock (so mock hashes behave like real ones) and for the test vectors.
 */
export const HASH_FIELDS = [
  "FeedState", "PNNo", "TransactionStatusId", "TransactionIsActive", "CIFNo", "FirstName", "MiddleName", "LastName", "Suffix",
  "LoanID", "LoanClass", "BorrowerCompanyName", "TotalLoanAmount", "ReleaseDate", "ProductCode", "BranchID", "ReplacedByExternalLoanId",
] as const;
export type HashField = (typeof HASH_FIELDS)[number];
export type HashValues = Record<HashField, string | number | null>;

/** The HashInput text: the 17 values in order, "|" between them, NULL as empty text. */
export function hashInput(v: HashValues): string {
  return HASH_FIELDS.map((f) => (v[f] === null || v[f] === undefined ? "" : String(v[f]))).join("|");
}

/** Lowercase hex SHA-256 of the UTF-16LE bytes of the text. */
export function contentHash(input: string): string {
  return createHash("sha256").update(Buffer.from(input, "utf16le")).digest("hex");
}

export const hashOf = (v: HashValues) => contentHash(hashInput(v));
