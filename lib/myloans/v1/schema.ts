import { z } from "zod";

/**
 * Piece 6 (D-047, IMPLEMENTATION_PLAN.md 7.4): the myloans API contract, validated once. The app's client and the
 * contract tests read every answer through these schemas, so a drift fails in one place with one plain message.
 * Fields are the agreed query's columns (docs/myloans-api-contract.sql), in its order, camelCase as agreed for the
 * JSON (docs/MYLOANS_ANSWERS_R2.md). No birth date at all (D-037).
 */

const FEED_STATES = ["Cancelled", "Superseded", "NotReleased", "Inactive", "Released"] as const;
/** datetimeoffset in +08:00 (myloans sends up to 7 fraction digits). */
const PHT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?\+08:00$/, "a date and time in +08:00");
/** The amount is a string ("219590.00"), parsed as an exact decimal by the DMS (A5). */
const AMOUNT = z.string().regex(/^\d+(\.\d{1,4})?$/, "an amount as a string");
const HASH = z.string().regex(/^[0-9a-f]{64}$/, "64 lowercase hex characters");
const text = z.string().nullable();
const id = z.number().int().nonnegative();

export const feedRowSchema = z.object({
  runStartedAt: PHT,
  externalLoanId: id,
  cin: z.string().max(20).nullable(),
  pnNo: text,
  transactionStatusId: z.number().int(),
  transactionIsActive: z.union([z.literal(0), z.literal(1), z.boolean()]),
  feedState: z.enum(FEED_STATES),
  isSelectable: z.union([z.literal(0), z.literal(1)]),
  replacedByExternalLoanId: id.nullable(),
  replacedByPnNo: text,
  cifNo: text,
  firstName: text,
  middleName: text,
  lastName: text,
  suffix: text,
  loanId: z.union([z.number().int(), z.string()]).nullable(),
  loanTypeId: z.union([z.number().int(), z.string()]).nullable(),
  loanType: text,
  borrowerCompanyName: text,
  totalLoanAmount: AMOUNT.nullable(),
  releaseDate: PHT.nullable(),
  productId: id.nullable(),
  productCode: text,
  productName: text,
  companyId: id.nullable(),
  companyName: text,
  divisionId: id.nullable(),
  divisionName: text,
  areaId: id.nullable(),
  areaName: text,
  branchId: id.nullable(),
  branchCode: text,
  branchName: text,
  sourceUpdatedAt: PHT,
  contentHash: HASH,
  rowsForThisLoan: z.number().int().positive(),
});
export type FeedRowV1 = z.infer<typeof feedRowSchema>;

/** API 2 (change mode) and the pool mode: a page cut by LOAN; nextAfterId null on the last page. */
export const feedPageSchema = z.object({
  runStartedAt: PHT,
  items: z.array(feedRowSchema),
  nextAfterId: id.nullable(),
});
export type FeedPageV1 = z.infer<typeof feedPageSchema>;

/** API 1 bodies by status: 200 one selectable row; 422 not selectable; 409 several rows; 404 not found. */
export const api1OkSchema = feedRowSchema;
export const api1NotSelectableSchema = z.object({ transactionStatusId: z.number().int(), feedState: z.enum(FEED_STATES), replacedByPnNo: text });
export const api1ManySchema = z.object({ rows: z.array(feedRowSchema).min(2) });

/** API 4: branches. */
export const branchRowSchema = z.object({
  branchId: id, branchCode: text, branchName: z.string(), areaId: id.nullable(), areaName: text, divisionId: id.nullable(), divisionName: text,
  companyId: id.nullable(), companyName: text, isActive: z.union([z.literal(0), z.literal(1), z.boolean()]), updatedAt: PHT.nullable(),
});
export const branchesSchema = z.object({ items: z.array(branchRowSchema) });

/** API 5: the full product list every time (no "since"). */
export const productRowSchema = z.object({ productId: id, productCode: z.string(), name: z.string(), active: z.boolean() });
export const productsSchema = z.object({ items: z.array(productRowSchema) });

/** The error body any endpoint may send (401, 429, 500, 503). */
export const errorBodySchema = z.object({ error: z.string() }).passthrough();

/** One plain line for a body that does not match: "myloans sent something we did not expect: items.0.contentHash". */
export function driftMessage(e: z.ZodError): string {
  const i = e.issues[0];
  const where = i?.path.length ? i.path.join(".") : "the answer";
  return `myloans sent something we did not expect: ${where}${i?.message ? ` (${i.message})` : ""}.`;
}

export { FEED_STATES };
