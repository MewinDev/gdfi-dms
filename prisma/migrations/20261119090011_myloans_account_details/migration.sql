-- MyLoans account details (docs/myloans/field-map.md). Made with prisma migrate diff; the trigram
-- "drop index" lines (Loan_pn_trgm_idx, Loan_borrowerName_trgm_idx) removed.

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "productCode" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MyLoans',
ADD COLUMN     "sourceAreaId" TEXT,
ADD COLUMN     "sourceAreaName" TEXT,
ADD COLUMN     "sourceBranchCode" TEXT,
ADD COLUMN     "sourceBranchName" TEXT,
ADD COLUMN     "sourceCompanyId" TEXT,
ADD COLUMN     "sourceCompanyName" TEXT,
ADD COLUMN     "sourceDivisionId" TEXT,
ADD COLUMN     "sourceDivisionName" TEXT,
ADD COLUMN     "sourceIsActive" BOOLEAN,
ADD COLUMN     "sourceStatusId" TEXT,
ADD COLUMN     "sourceStatusName" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LoanSourceSnapshot" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MyLoans';

