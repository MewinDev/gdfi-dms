-- CreateEnum
CREATE TYPE "CashReturnKind" AS ENUM ('CASH', 'HANDOVER');

-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CashReturn" ADD COLUMN     "kind" "CashReturnKind" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "toLineId" TEXT;

-- CreateTable
CREATE TABLE "PasuyoEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "fromLabel" TEXT,
    "toUserId" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "byUserId" TEXT,
    "byLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "funds" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasuyoEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasuyoEvent_assignmentId_createdAt_idx" ON "PasuyoEvent"("assignmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "PasuyoEvent" ADD CONSTRAINT "PasuyoEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Second processor (Pasuyo) on a job: the DP may pass a job on (not Admin: it is a work step).
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['jobs:pasuyo']) k ORDER BY k) WHERE "key" = 'DP';

-- History for jobs that already have a second processor chosen at Send.
INSERT INTO "PasuyoEvent" ("id", "assignmentId", "toUserId", "toLabel", "byUserId", "byLabel", "reason", "createdAt")
SELECT 'pe_' || a."id", a."id", a."secondaryDpUserId", u."name", a."assignedById", b."name", COALESCE(a."pasuyoReason", ''), a."endorsedAt"
FROM "DpAssignment" a JOIN "User" u ON u."id" = a."secondaryDpUserId" JOIN "User" b ON b."id" = a."assignedById"
WHERE a."secondaryDpUserId" IS NOT NULL;
