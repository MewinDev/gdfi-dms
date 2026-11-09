-- Funds types: Cash advance (CA) and Fund transfer (FT) on the same funds flow.
-- Every existing cash advance and top-up becomes Cash advance; no data is removed.
-- (The Loan trigram search indexes are kept: they are not in the Prisma schema on purpose.)

-- CreateTable
CREATE TABLE "FundsType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
    "needsReference" BOOLEAN NOT NULL DEFAULT false,
    "needsAccount" BOOLEAN NOT NULL DEFAULT false,
    "mustLiquidate" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundsType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundsType_code_key" ON "FundsType"("code");

-- The two seeded types, "Proposed, to be confirmed with Finance" until Admin saves them.
INSERT INTO "FundsType" ("id", "code", "name", "sortOrder", "active", "proposed", "needsReference", "needsAccount", "mustLiquidate", "updatedAt")
VALUES
  ('fundstype_ca', 'CA', 'Cash advance', 1, true, true, false, false, true, CURRENT_TIMESTAMP),
  ('fundstype_ft', 'FT', 'Fund transfer', 2, true, true, true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- AlterTable: the type and the release details, filled for the existing rows, then required.
ALTER TABLE "CashAdvance" ADD COLUMN     "accountLast4" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "accountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "accountProvider" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fundsTypeCode" TEXT,
ADD COLUMN     "fundsTypeId" TEXT,
ADD COLUMN     "fundsTypeName" TEXT,
ADD COLUMN     "transferDate" TEXT NOT NULL DEFAULT '';

ALTER TABLE "CashAdvanceTopUp" ADD COLUMN     "accountLast4" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "accountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "accountProvider" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fundsTypeCode" TEXT,
ADD COLUMN     "fundsTypeId" TEXT,
ADD COLUMN     "fundsTypeName" TEXT,
ADD COLUMN     "releaseRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "transferDate" TEXT NOT NULL DEFAULT '';

-- Backfill: every existing record is a Cash advance.
UPDATE "CashAdvance" SET "fundsTypeId" = t."id", "fundsTypeCode" = t."code", "fundsTypeName" = t."name"
FROM "FundsType" t WHERE t."code" = 'CA' AND "CashAdvance"."fundsTypeId" IS NULL;
UPDATE "CashAdvanceTopUp" SET "fundsTypeId" = t."id", "fundsTypeCode" = t."code", "fundsTypeName" = t."name"
FROM "FundsType" t WHERE t."code" = 'CA' AND "CashAdvanceTopUp"."fundsTypeId" IS NULL;

ALTER TABLE "CashAdvance" ALTER COLUMN "fundsTypeCode" SET NOT NULL, ALTER COLUMN "fundsTypeId" SET NOT NULL, ALTER COLUMN "fundsTypeName" SET NOT NULL;
ALTER TABLE "CashAdvanceTopUp" ALTER COLUMN "fundsTypeCode" SET NOT NULL, ALTER COLUMN "fundsTypeId" SET NOT NULL, ALTER COLUMN "fundsTypeName" SET NOT NULL;

-- New rows default to Cash advance (the app always sets the type; the default covers direct inserts).
ALTER TABLE "CashAdvance" ALTER COLUMN "fundsTypeId" SET DEFAULT 'fundstype_ca', ALTER COLUMN "fundsTypeCode" SET DEFAULT 'CA', ALTER COLUMN "fundsTypeName" SET DEFAULT 'Cash advance';
ALTER TABLE "CashAdvanceTopUp" ALTER COLUMN "fundsTypeId" SET DEFAULT 'fundstype_ca', ALTER COLUMN "fundsTypeCode" SET DEFAULT 'CA', ALTER COLUMN "fundsTypeName" SET DEFAULT 'Cash advance';

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceTopUp" ADD CONSTRAINT "CashAdvanceTopUp_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Settings > Funds types: Admin only by default (the built-in Admin role is locked to every Admin permission; the stored list follows).
UPDATE "Role" SET "permissions" = array_append("permissions", 'fundtypes:manage') WHERE "key" = 'ADMIN' AND NOT ('fundtypes:manage' = ANY("permissions"));
