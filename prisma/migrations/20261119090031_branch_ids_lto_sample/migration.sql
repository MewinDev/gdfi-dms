-- D-054: pool candidates keep myloans' BranchID (every branch match uses it; the code is for display).
ALTER TABLE "SourceLoanCandidate" ADD COLUMN     "myloansBranchId" INTEGER;

-- D-020: a sample LTO office (seeded with a sample distance) shows a warning badge.
ALTER TABLE "LtoOffice" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sampleNote" TEXT NOT NULL DEFAULT '';
UPDATE "LtoOffice" SET "isSample" = true, "sampleNote" = 'Sample. Verify with Operations' WHERE "code" = 'LTO-PASIG';
