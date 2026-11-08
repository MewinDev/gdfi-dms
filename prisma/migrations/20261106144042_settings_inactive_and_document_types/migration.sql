-- CreateEnum
CREATE TYPE "DefaultOriginality" AS ENUM ('ORIGINAL', 'COPY', 'EITHER');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "CashAdvanceRule" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "ChecklistRule" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "DocumentType" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT,
ADD COLUMN     "defaultOriginality" "DefaultOriginality" NOT NULL DEFAULT 'EITHER',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "HolidayCalendar" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "LoanType" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "LtoOffice" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "TransactionType" ADD COLUMN     "builtIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- Data: the four types the automation rules create are built in (never inactive, code fixed).
UPDATE "TransactionType" SET "builtIn" = true, "active" = true WHERE "code" IN ('NOTARY', 'EDST', 'PPSR', 'MORTGAGE');

-- Data: a document type's default "original or copy" follows its checklist items when they all agree.
UPDATE "DocumentType" d SET "defaultOriginality" = CAST(x.o AS TEXT)::"DefaultOriginality"
FROM (
  SELECT "documentTypeId", MIN("originality"::text) AS o
  FROM "ChecklistRule" GROUP BY "documentTypeId" HAVING COUNT(DISTINCT "originality") = 1
) x
WHERE d."id" = x."documentTypeId";
