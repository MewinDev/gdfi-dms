-- Piece 4 (D-018, D-041, 17 November 2026): one working-days calendar, office closures, "Pauses TAT",
-- saved due dates and their change log. Made with prisma migrate diff; the trigram DROP INDEX lines removed.
-- CreateEnum
CREATE TYPE "CalendarEntryKind" AS ENUM ('HOLIDAY', 'CLOSURE');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('REGULAR', 'SPECIAL_NON_WORKING', 'LOCAL');

-- DropIndex
DROP INDEX "HolidayCalendar_date_key";

-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "liquidationDueFrom" TEXT;

-- AlterTable
ALTER TABLE "DpAssignment" ADD COLUMN     "dueBranchId" TEXT,
ADD COLUMN     "dueDate" TEXT,
ADD COLUMN     "targetDays" INTEGER;

-- AlterTable
ALTER TABLE "HoldReason" ADD COLUMN     "pausesTat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HolidayCalendar" ADD COLUMN     "allBranches" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "CalendarEntryKind" NOT NULL DEFAULT 'HOLIDAY',
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "type" "HolidayType" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "HolidayBranch" (
    "holidayId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "HolidayBranch_pkey" PRIMARY KEY ("holidayId","branchId")
);

-- CreateTable
CREATE TABLE "DueDateChange" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "loanId" TEXT,
    "pn" TEXT,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "calendarEntryId" TEXT,
    "wasOverdue" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "byId" TEXT,
    "byLabel" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueDateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolidayBranch_branchId_idx" ON "HolidayBranch"("branchId");

-- CreateIndex
CREATE INDEX "DueDateChange_subjectType_subjectId_idx" ON "DueDateChange"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "DueDateChange_at_idx" ON "DueDateChange"("at");

-- CreateIndex
CREATE INDEX "HolidayCalendar_date_idx" ON "HolidayCalendar"("date");

-- AddForeignKey
ALTER TABLE "HolidayBranch" ADD CONSTRAINT "HolidayBranch_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "HolidayCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayBranch" ADD CONSTRAINT "HolidayBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data (D-041): the seed used to load 13 real-looking 2026 holidays (guessed). Only sample dates are seeded now;
-- the official list is entered from the government proclamation. Rows exactly as the old seed made them go.
DELETE FROM "HolidayCalendar" h
USING (VALUES
  ('2026-01-01', 'New Year''s Day'), ('2026-04-02', 'Maundy Thursday'), ('2026-04-03', 'Good Friday'),
  ('2026-04-09', 'Araw ng Kagitingan'), ('2026-05-01', 'Labor Day'), ('2026-06-12', 'Independence Day'),
  ('2026-08-31', 'National Heroes Day'), ('2026-11-30', 'Bonifacio Day'), ('2026-12-08', 'Feast of the Immaculate Conception'),
  ('2026-12-24', 'Christmas Eve'), ('2026-12-25', 'Christmas Day'), ('2026-12-30', 'Rizal Day'), ('2026-12-31', 'Last Day of the Year')
) AS old(d, n)
WHERE h."date" = old.d AND h."name" = old.n;

-- "Pauses TAT" on by default for reasons outside the person's control (D-032 Q-N7): waiting on the client,
-- another department or MyLoans. Not for "No available DP" or "Other".
UPDATE "HoldReason" SET "pausesTat" = true
WHERE "code" IN ('CLIENT-PAPERS', 'CLIENT-DECISION', 'CLIENT-CORRECTIONS', 'BRANCH-HEAD', 'FUNDS', 'MYLOANS-UPDATE');
