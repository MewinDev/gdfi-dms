-- Piece 5 (D-017, D-044, 18 November 2026): the liquidation due date counts from the last LTO pickup, N working
-- days per funds type (default 2); the late record. Made with prisma migrate diff; the trigram DROP INDEX lines
-- removed.

-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "daysLate" INTEGER,
ADD COLUMN     "fallbackNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "liquidatedAt" TIMESTAMP(3),
ADD COLUMN     "liquidationBasis" TEXT,
ADD COLUMN     "liquidationCountFrom" TIMESTAMP(3),
ADD COLUMN     "liquidationNote" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CashAdvanceRule" DROP COLUMN "liquidationDays";

-- AlterTable
ALTER TABLE "FundsType" ADD COLUMN     "liquidationDueDays" INTEGER NOT NULL DEFAULT 2;

-- Data (D-017): the three old sources of the liquidation days are gone. Existing advances keep their saved
-- liquidationDueAt (counted from the release under the old rule).
DELETE FROM "Setting" WHERE "key" = 'funds.liquidationDueDays';
DELETE FROM "TatRule" WHERE "key" = 'P4_LIQUIDATE';
