-- Piece 7 (D-052): the myloans sync on API 2 (run log, lock, released loans not yet in the DMS). The old tiered
-- background refresh is retired: its columns go (and with nextCheckAt its partial index Loan_due_idx).

-- AlterTable
ALTER TABLE "Loan" DROP COLUMN "nextCheckAt",
DROP COLUMN "syncTier";

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "skipped" TEXT,
    "since" TIMESTAMP(3),
    "pages" INTEGER NOT NULL DEFAULT 0,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "checkpointBefore" TIMESTAMP(3),
    "checkpointAfter" TIMESTAMP(3),
    "byLabel" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLease" (
    "id" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLoanCandidate" (
    "id" TEXT NOT NULL,
    "externalLoanId" INTEGER NOT NULL,
    "cin" TEXT,
    "pn" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "branchCode" TEXT,
    "branchName" TEXT,
    "productName" TEXT,
    "amount" TEXT,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceLoanCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLoanCandidate_externalLoanId_key" ON "SourceLoanCandidate"("externalLoanId");

-- CreateIndex
CREATE INDEX "SourceLoanCandidate_pn_idx" ON "SourceLoanCandidate"("pn");

-- CreateIndex
CREATE INDEX "SourceLoanCandidate_branchCode_releaseDate_idx" ON "SourceLoanCandidate"("branchCode", "releaseDate");

