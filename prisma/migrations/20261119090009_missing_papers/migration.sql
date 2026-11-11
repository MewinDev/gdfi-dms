-- Missing papers with reasons (10 November 2026). Generated with `prisma migrate diff` (the shadow database
-- of `migrate dev --create-only` cannot replay the hand-made loan search trigram indexes; its "drop index"
-- lines for Loan_borrowerName_trgm_idx and Loan_pn_trgm_idx are left out). Safe on a database with data.
--
-- A missing paper no longer blocks the file: the LA marks it Missing with a reason and remarks, and the
-- file goes on. Optional papers count only when "Include in this file" is ticked.

-- CreateEnum
CREATE TYPE "PaperMissingState" AS ENUM ('MISSING', 'RECEIVED_LATE');

-- AlterTable
ALTER TABLE "ChecklistCheck" ADD COLUMN     "includedInFile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "missingAt" TIMESTAMP(3),
ADD COLUMN     "missingById" TEXT,
ADD COLUMN     "missingByLabel" TEXT,
ADD COLUMN     "missingReasonId" TEXT,
ADD COLUMN     "missingRemarks" TEXT,
ADD COLUMN     "missingState" "PaperMissingState",
ADD COLUMN     "receivedLateAt" TIMESTAMP(3),
ADD COLUMN     "receivedLateBy" TEXT,
ADD COLUMN     "receivedLateById" TEXT,
ADD COLUMN     "receivedLateOn" TEXT,
ADD COLUMN     "remarksAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MissingPaperReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissingPaperReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperEvent" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reasonName" TEXT,
    "oldText" TEXT,
    "newText" TEXT,
    "receivedOn" TEXT,
    "byId" TEXT,
    "byLabel" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissingPaperReason_code_key" ON "MissingPaperReason"("code");

-- CreateIndex
CREATE INDEX "PaperEvent_checkId_at_idx" ON "PaperEvent"("checkId", "at");

-- CreateIndex
CREATE INDEX "PaperEvent_loanId_idx" ON "PaperEvent"("loanId");

-- CreateIndex
CREATE INDEX "ChecklistCheck_missingState_idx" ON "ChecklistCheck"("missingState");

-- AddForeignKey
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missingReasonId_fkey" FOREIGN KEY ("missingReasonId") REFERENCES "MissingPaperReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperEvent" ADD CONSTRAINT "PaperEvent_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ChecklistCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The missing state can never disagree with the tick: Missing is not in hand, Received late is in hand.
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_state_check"
  CHECK ("missingState" IS NULL OR ("missingState" = 'MISSING' AND NOT "checked") OR ("missingState" = 'RECEIVED_LATE' AND "checked"));

-- Remarks are 5 to 500 characters once saved (the server checks it too, with a plain message).
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_remarks_check"
  CHECK ("missingRemarks" IS NULL OR char_length("missingRemarks") BETWEEN 5 AND 500);

-- Optional papers already ticked, and "Other" papers the LA added, are part of the file.
UPDATE "ChecklistCheck" SET "includedInFile" = true WHERE NOT "required" AND ("checked" OR "ruleId" IS NULL);

-- The reasons list (Settings > Missing paper reasons). Existing codes are kept as they are.
INSERT INTO "MissingPaperReason" ("id", "code", "name", "sortOrder", "active", "createdAt", "updatedAt") VALUES
  ('mpr_later', 'LATER', 'Borrower to submit later', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mpr_not_issued', 'NOT_ISSUED', 'Not yet issued by the agency', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mpr_lost', 'LOST', 'Lost or unavailable', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mpr_na', 'NOT_APPLICABLE', 'Not applicable to this loan', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mpr_other', 'OTHER', 'Other', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Permission ticks (roles are just ticks; nothing checks a role's name):
--   papers:mark_missing   every role that can tick papers;
--   papers:receive_late   every role that can tick papers, and the Admin role;
--   settings:missing_reasons   every role that can change the return reasons (the Admin role by default).
UPDATE "Role" SET "permissions" = array_append("permissions", 'papers:mark_missing'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE 'checklist:tick' = ANY("permissions") AND NOT ('papers:mark_missing' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'papers:receive_late'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE ('checklist:tick' = ANY("permissions") OR "key" = 'ADMIN') AND NOT ('papers:receive_late' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings:missing_reasons'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE ('settings:return_reasons' = ANY("permissions") OR "key" = 'ADMIN') AND NOT ('settings:missing_reasons' = ANY("permissions"));
