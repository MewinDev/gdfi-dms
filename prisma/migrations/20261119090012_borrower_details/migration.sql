-- Borrower details: a review class of its own (decided by branch supervisors and approvers), the
-- borrower's address and contact number as the DMS shows them, and the new tick source:review_borrower.

-- AlterEnum
ALTER TYPE "SourceChangeCategory" ADD VALUE 'BORROWER';

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "borrowerAddress" TEXT,
ADD COLUMN     "borrowerContactNo" TEXT;

-- Backfill: what the DMS already showed for these loans is the latest MyLoans copy (minor changes used to
-- update it silently), so a copy saved before this change does not count as changed.
UPDATE "Loan" AS l
SET "borrowerAddress" = NULLIF(BTRIM(COALESCE(s."tracked"->>'address', s."payload"->'loan'->>'address')), ''),
    "borrowerContactNo" = NULLIF(BTRIM(COALESCE(s."tracked"->>'contactNo', s."payload"->'loan'->>'contactNo')), '')
FROM (
  SELECT DISTINCT ON ("loanId") "loanId", "tracked", "payload"
  FROM "LoanSourceSnapshot"
  ORDER BY "loanId", "retrievedAt" DESC
) AS s
WHERE s."loanId" = l."id";

-- The new tick, on by default for the Branch Supervisor, Admin and every role that approves funds.
UPDATE "Role"
SET "permissions" = array_append("permissions", 'source:review_borrower'), "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ('source:review_borrower' = ANY("permissions"))
  AND ("key" IN ('SUP', 'ADMIN') OR "permissions" && ARRAY['funds:ca_approve', 'funds:ft_approve']::text[]);
