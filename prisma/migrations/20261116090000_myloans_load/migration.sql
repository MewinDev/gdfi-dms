-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "syncTier" TEXT;

-- AlterTable
ALTER TABLE "LoanSourceSnapshot" ADD COLUMN     "kind" TEXT;

-- Due loans: WHERE "syncTier" IS NOT NULL AND "nextCheckAt" <= now ORDER BY "nextCheckAt" LIMIT cap.
-- Partial: closed and cancelled loans (syncTier NULL) are not in the index at all.
CREATE INDEX "Loan_due_idx" ON "Loan" ("nextCheckAt") WHERE "syncTier" IS NOT NULL;

-- Local search (Find loan): trigram indexes on PN and borrower name (prefix first, then contains).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Loan_pn_trgm_idx" ON "Loan" USING gin ("pn" gin_trgm_ops);
CREATE INDEX "Loan_borrowerName_trgm_idx" ON "Loan" USING gin ("borrowerName" gin_trgm_ops);

-- Tiers for the loans already open (A work in progress, B not yet sent, C finished steps not closed).
UPDATE "Loan" SET
  "syncTier" = CASE
    WHEN "stage" IN ('Assigned to DP', 'In process', 'Awaiting LA acceptance') THEN 'A'
    WHEN "stage" IN ('Opened', 'For checklist', 'No DP assignment required') THEN 'B'
    ELSE 'C' END,
  "nextCheckAt" = NOW()
WHERE "cancelledAt" IS NULL AND "closedAt" IS NULL AND "archivedAt" IS NULL AND "disposedAt" IS NULL
  AND "stage" NOT IN ('Closed', 'Archived', 'Disposed', 'Cancelled in MyLoans');

-- Snapshots made so far: the first of each loan is the base copy.
UPDATE "LoanSourceSnapshot" s SET "kind" = 'BASE'
WHERE s."id" IN (SELECT DISTINCT ON ("loanId") "id" FROM "LoanSourceSnapshot" ORDER BY "loanId", "retrievedAt" ASC);
