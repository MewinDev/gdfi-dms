-- CreateTable
CREATE TABLE "HoldReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoldReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hold" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "expectedResumeOn" TEXT,
    "raisedById" TEXT,
    "raisedByLabel" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedById" TEXT,
    "resumedByLabel" TEXT,
    "resumedAt" TIMESTAMP(3),
    "resumeNote" TEXT NOT NULL DEFAULT '',
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HoldReason_code_key" ON "HoldReason"("code");

-- CreateIndex
CREATE INDEX "Hold_transactionId_resumedAt_idx" ON "Hold"("transactionId", "resumedAt");

-- CreateIndex
CREATE INDEX "Hold_loanId_idx" ON "Hold"("loanId");

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "HoldReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_resumedById_fkey" FOREIGN KEY ("resumedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one open hold per transaction (several holds over time are fine).
CREATE UNIQUE INDEX "Hold_one_open_per_transaction" ON "Hold"("transactionId") WHERE "resumedAt" IS NULL;

-- Hold reasons (Settings list, same pattern as Problem reasons).
INSERT INTO "HoldReason" ("id", "code", "name", "sortOrder", "updatedAt") VALUES
  ('hr_borrower', 'BORROWER', 'Waiting on borrower', 1, CURRENT_TIMESTAMP),
  ('hr_team', 'OTHER-TEAM', 'Waiting on another team', 2, CURRENT_TIMESTAMP),
  ('hr_lto', 'LTO-SCHEDULE', 'Waiting on LTO appointment or schedule', 3, CURRENT_TIMESTAMP),
  ('hr_other', 'OTHER', 'Other', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Holds: the LA and the DP put their own work on hold and resume it (work steps: not Admin).
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['holds:raise', 'holds:resolve']) k ORDER BY k) WHERE "key" IN ('LA', 'DP');
-- Hold reasons are changed by whoever may change problem reasons.
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['settings:hold_reasons']) k ORDER BY k) WHERE 'settings:problem_reasons' = ANY("permissions");
