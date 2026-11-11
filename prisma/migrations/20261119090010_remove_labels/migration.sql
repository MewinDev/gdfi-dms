-- Remove print labels (11 November 2026, confirmed by the users). Generated with `prisma migrate diff`
-- (`migrate dev --create-only` made no folder; its shadow database cannot replay the hand-made loan search
-- trigram indexes). The "drop index" lines for Loan_borrowerName_trgm_idx and Loan_pn_trgm_idx are left out.
--
-- Labels are not used in the LA and DP flow. Sending to DP depends only on the paper rules. The paper's
-- own Document ID stays (search, stage, DP verification, reuse between loans use it). A QR code for
-- Archiving and Warehousing (vault, box, part, numbers) is a later phase, not built.
--
-- History is kept: old LABEL_PRINTED custody rows and labels_printed audit rows stay (append-only) and
-- are no longer shown in the Journey.

-- AlterTable
ALTER TABLE "DocumentItem" DROP COLUMN "labelPrintedAt";

-- AlterTable
ALTER TABLE "DpAssignment" DROP COLUMN "labelsConfirmedAt";

-- AlterTable
ALTER TABLE "LoanTransaction" DROP COLUMN "labelsPrintedAt";

-- The "Print labels" tick (labels:print) is gone from every role. It granted nothing else, so no role loses any other step.
UPDATE "Role" SET "permissions" = array_remove("permissions", 'labels:print'), "updatedAt" = CURRENT_TIMESTAMP
WHERE 'labels:print' = ANY("permissions");

-- The turnaround target of the label step (Settings > Turnaround times). Step 3.2 is now automatic (Document IDs only).
DELETE FROM "TatRule" WHERE "key" = 'P3_LABELS';
