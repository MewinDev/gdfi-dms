-- AlterEnum
ALTER TYPE "DpAssignmentStatus" ADD VALUE 'PULLED_BACK';

-- AlterTable
ALTER TABLE "DpAssignment" ADD COLUMN     "returnReasonId" TEXT;

-- CreateTable
CREATE TABLE "ReturnReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReason_code_key" ON "ReturnReason"("code");

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_returnReasonId_fkey" FOREIGN KEY ("returnReasonId") REFERENCES "ReturnReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Return reasons (Settings list, same pattern as Problem and Hold reasons).
INSERT INTO "ReturnReason" ("id", "code", "name", "sortOrder", "updatedAt") VALUES
  ('rr_missing', 'MISSING', 'Missing paper', 1, CURRENT_TIMESTAMP),
  ('rr_wrong', 'WRONG', 'Wrong or unclear paper', 2, CURRENT_TIMESTAMP),
  ('rr_other_txn', 'OTHER-TXN', 'Needs another transaction first', 3, CURRENT_TIMESTAMP),
  ('rr_other', 'OTHER', 'Other', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- The processor returns an accepted job to the LA for papers (a DP work step: not Admin, not LA).
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['jobs:return_to_la']) k ORDER BY k) WHERE "key" = 'DP';
-- Return reasons are changed by whoever may change problem reasons.
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['settings:return_reasons']) k ORDER BY k) WHERE 'settings:problem_reasons' = ANY("permissions");
