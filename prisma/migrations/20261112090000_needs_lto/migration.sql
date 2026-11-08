-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "usualLtoOfficeId" TEXT;

-- AlterTable
ALTER TABLE "CashAdvanceLine" ADD COLUMN     "ltoOfficeId" TEXT;

-- AlterTable
ALTER TABLE "LtoOffice" ADD COLUMN     "distanceKm" DOUBLE PRECISION,
ADD COLUMN     "suggestedTransportCents" INTEGER,
ADD COLUMN     "travelHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TransactionType" ADD COLUMN     "needsLto" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_usualLtoOfficeId_fkey" FOREIGN KEY ("usualLtoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_ltoOfficeId_fkey" FOREIGN KEY ("ltoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Defaults: Notary, Entry of PPSR and Mortgage are processed at the LTO; EDST is not. Editable in Settings.
UPDATE "TransactionType" SET "needsLto" = true WHERE "code" IN ('NOTARY', 'PPSR', 'MORTGAGE');
