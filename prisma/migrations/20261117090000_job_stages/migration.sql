-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OWN', 'LTO_DROP', 'LTO_PICKUP', 'VERIFY');

-- CreateEnum
CREATE TYPE "JobStageStatus" AS ENUM ('LATER', 'STARTED', 'DONE');



-- AlterTable
ALTER TABLE "DpAssignment" ADD COLUMN     "receivingBranchId" TEXT;

-- AlterTable
ALTER TABLE "Hold" ADD COLUMN     "jobStageId" TEXT;

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "jobStageId" TEXT;

-- AlterTable
ALTER TABLE "TransactionAttempt" ADD COLUMN     "jobStageId" TEXT;

-- CreateTable
CREATE TABLE "ProcessingStage" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'OWN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "targetDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStage" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "stageId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "targetDays" INTEGER,
    "status" "JobStageStatus" NOT NULL DEFAULT 'LATER',
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "startedByLabel" TEXT,
    "finishedAt" TIMESTAMP(3),
    "finishedById" TEXT,
    "finishedByLabel" TEXT,
    "evidence" JSONB,
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStage_typeId_code_key" ON "ProcessingStage"("typeId", "code");

-- CreateIndex
CREATE INDEX "JobStage_assignmentId_sortOrder_idx" ON "JobStage"("assignmentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "JobStage_assignmentId_code_key" ON "JobStage"("assignmentId", "code");

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_receivingBranchId_fkey" FOREIGN KEY ("receivingBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingStage" ADD CONSTRAINT "ProcessingStage_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStage" ADD CONSTRAINT "JobStage_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStage" ADD CONSTRAINT "JobStage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProcessingStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Proposed default stages (editable in Settings > Processing stages; to confirm with Collateral and Mortgage).
-- Notary: Notarization. Entry of PPSR: PPSR registration. Mortgage: no stage of its own (its work is the LTO stages).
-- Every type with a processor: LTO drop off and LTO pickup (used only while Needs LTO processing is on) and Check and verify (last).
-- ---------------------------------------------------------------------------
INSERT INTO "ProcessingStage" ("id", "typeId", "code", "name", "kind", "sortOrder", "fields", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'NOTARIZATION', 'Notarization', 'OWN', 1, '[{"key": "name", "label": "Notary name", "type": "text", "required": true}, {"key": "docNo", "label": "Document", "type": "text", "required": true}, {"key": "pageNo", "label": "Page number", "type": "text", "required": true}, {"key": "bookNo", "label": "Book number", "type": "text", "required": true}, {"key": "series", "label": "Series", "type": "text", "required": true}]'::jsonb, now() FROM "TransactionType" t WHERE t."code" = 'NOTARY' AND t."requiresDp";
INSERT INTO "ProcessingStage" ("id", "typeId", "code", "name", "kind", "sortOrder", "fields", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'PPSR-REG', 'PPSR registration', 'OWN', 1, '[{"key": "filedOn", "label": "Filed on", "type": "date", "required": true}, {"key": "registrationDate", "label": "Registered on", "type": "date", "required": true}, {"key": "registrationNo", "label": "Registration number", "type": "text", "required": true}, {"key": "certificate", "label": "Certificate", "type": "file", "required": true}]'::jsonb, now() FROM "TransactionType" t WHERE t."code" = 'PPSR' AND t."requiresDp";
INSERT INTO "ProcessingStage" ("id", "typeId", "code", "name", "kind", "sortOrder", "fields", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'LTO-DROP', 'LTO drop off', 'LTO_DROP', 1000, '[{"key": "droppedAt", "label": "Dropped on", "type": "date", "required": true}, {"key": "office", "label": "LTO office", "type": "text", "required": true}, {"key": "orNumber", "label": "Official receipt number", "type": "text", "required": true}]'::jsonb, now() FROM "TransactionType" t WHERE t."requiresDp";
INSERT INTO "ProcessingStage" ("id", "typeId", "code", "name", "kind", "sortOrder", "fields", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'LTO-PICKUP', 'LTO pickup', 'LTO_PICKUP', 1001, '[{"key": "pickedUpAt", "label": "Picked up on", "type": "date", "required": true}, {"key": "annotatedOrCr", "label": "Annotated OR/CR received", "type": "tick", "required": true}]'::jsonb, now() FROM "TransactionType" t WHERE t."requiresDp";
INSERT INTO "ProcessingStage" ("id", "typeId", "code", "name", "kind", "sortOrder", "fields", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'VERIFY', 'Check and verify', 'VERIFY', 1002, '[]'::jsonb, now() FROM "TransactionType" t WHERE t."requiresDp";

-- ---------------------------------------------------------------------------
-- Jobs completed before stages existed: every stage Done, from the stored references (nothing is
-- removed; DpAssignment.processing stays). Jobs in progress get no rows: they start at the first stage.
-- ---------------------------------------------------------------------------
INSERT INTO "JobStage" ("id", "assignmentId", "stageId", "code", "name", "kind", "sortOrder", "fields", "targetDays", "status",
  "finishedAt", "finishedById", "finishedByLabel", "evidence", "migrated", "simulated")
SELECT gen_random_uuid()::text, a."id", ps."id", ps."code", ps."name", ps."kind", ps."sortOrder", ps."fields", ps."targetDays", 'DONE',
  COALESCE((a."processing"->>'processedAt')::timestamptz, a."forwardedAt", a."updatedAt"), a."dpUserId", u."name",
  CASE ps."kind"
    WHEN 'OWN' THEN COALESCE(CASE ps."code" WHEN 'NOTARIZATION' THEN a."processing"->'notary' WHEN 'PPSR-REG' THEN a."processing"->'ppsr' END, '{}'::jsonb)
    WHEN 'LTO_DROP' THEN jsonb_strip_nulls(jsonb_build_object('droppedAt', a."processing"->'lto'->'droppedAt', 'office', COALESCE(a."processing"->'lto'->'office', a."processing"->'notary'->'office', a."processing"->'ppsr'->'office', a."processing"->'done'->'office')))
    WHEN 'LTO_PICKUP' THEN jsonb_strip_nulls(jsonb_build_object('pickedUpAt', a."processing"->'lto'->'pickedUpAt', 'annotatedOrCr', a."processing"->'lto'->'annotatedOrCr'))
    ELSE jsonb_build_object('papers', '{}'::jsonb, 'note', 'Completed before Check and verify existed.')
  END,
  true, false
FROM "DpAssignment" a
JOIN "LoanTransaction" t ON t."id" = a."transactionId"
JOIN "TransactionType" tt ON tt."id" = t."typeId"
JOIN "ProcessingStage" ps ON ps."typeId" = tt."id" AND ps."active" AND (ps."kind" IN ('OWN', 'VERIFY') OR tt."needsLto")
JOIN "User" u ON u."id" = a."dpUserId"
WHERE a."processing" IS NOT NULL;
