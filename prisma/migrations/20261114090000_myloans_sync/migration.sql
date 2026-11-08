-- CreateEnum
CREATE TYPE "SourceChangeCategory" AS ENUM ('MATERIAL', 'STATUS', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "SourceChangeState" AS ENUM ('OPEN', 'APPLIED', 'KEPT', 'CLOSED_CANCELLED');

-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "movedFromLineId" TEXT;

-- AlterTable
ALTER TABLE "ChecklistRule" ADD COLUMN     "reusable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "replacedByPn" TEXT,
ADD COLUMN     "replacesPn" TEXT;

-- AlterTable
ALTER TABLE "LoanSourceSnapshot" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "tracked" JSONB;

-- CreateTable
CREATE TABLE "SourceChange" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "SourceChangeCategory" NOT NULL,
    "changes" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "hash" TEXT NOT NULL,
    "candidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "SourceChangeState" NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedByLabel" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SourceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceChange_loanId_state_idx" ON "SourceChange"("loanId", "state");

-- CreateIndex
CREATE INDEX "SourceChange_state_idx" ON "SourceChange"("state");

-- CreateIndex
CREATE INDEX "Loan_lastCheckedAt_idx" ON "Loan"("lastCheckedAt");

-- AddForeignKey
ALTER TABLE "SourceChange" ADD CONSTRAINT "SourceChange_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MyLoans sync: review and settings, Admin only for now (other roles can be given them in Settings).
UPDATE "Role" SET "permissions" = array_append("permissions", 'source:review') WHERE "key" = 'ADMIN' AND NOT ('source:review' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'source:manage') WHERE "key" = 'ADMIN' AND NOT ('source:manage' = ANY("permissions"));

-- Papers that belong to the borrower can be reused on a replacement PN: valid IDs and the SPA.
UPDATE "ChecklistRule" SET "reusable" = true
WHERE "documentTypeId" IN (SELECT "id" FROM "DocumentType" WHERE "code" IN ('ID', 'SPA'));
