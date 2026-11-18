-- Piece 10a (D-050): the myloans identity of a loan file, the PN search log, one active transaction per type.

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "externalLoanId" INTEGER;

-- CreateTable
CREATE TABLE "LoanSourceIdentity" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "externalLoanId" INTEGER NOT NULL,
    "cin" TEXT,
    "pnNo" TEXT,
    "contentHash" TEXT,
    "feedState" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanSourceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnSearchLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userLabel" TEXT NOT NULL,
    "searcherBranchId" TEXT,
    "pn" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "statusId" TEXT,
    "feedState" TEXT,
    "loanBranchId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnSearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanSourceIdentity_externalLoanId_idx" ON "LoanSourceIdentity"("externalLoanId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanSourceIdentity_loanId_externalLoanId_key" ON "LoanSourceIdentity"("loanId", "externalLoanId");

-- CreateIndex
CREATE INDEX "PnSearchLog_at_idx" ON "PnSearchLog"("at");

-- CreateIndex
CREATE INDEX "PnSearchLog_pn_idx" ON "PnSearchLog"("pn");

-- CreateIndex
CREATE INDEX "PnSearchLog_loanBranchId_at_idx" ON "PnSearchLog"("loanBranchId", "at");

-- CreateIndex
CREATE INDEX "PnSearchLog_searcherBranchId_at_idx" ON "PnSearchLog"("searcherBranchId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_externalLoanId_key" ON "Loan"("externalLoanId");

-- AddForeignKey
ALTER TABLE "LoanSourceIdentity" ADD CONSTRAINT "LoanSourceIdentity_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- D-050 item c: one active (not cancelled) transaction of each type per loan file. Prisma does not see partial
-- indexes: never drop it (CLAUDE.md lists it with the others).
CREATE UNIQUE INDEX "LoanTransaction_one_active_per_type" ON "LoanTransaction"("loanId", "typeId") WHERE "status" <> 'CANCELLED';

-- D-050 item b: "See PN searches" on the built-in Admin and LA Supervisor/Head roles.
UPDATE "Role" SET "permissions" = array_append("permissions", 'reports:pnsearch')
WHERE "key" IN ('ADMIN', 'SUP') AND NOT ('reports:pnsearch' = ANY("permissions"));
