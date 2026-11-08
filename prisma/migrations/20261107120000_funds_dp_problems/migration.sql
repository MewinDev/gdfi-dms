-- Keep the old single-loan cash advances: they become the transaction's funds flag (with the old
-- amount in a note) at the end of this migration. No data is lost.
CREATE TABLE "_old_cash_advance" AS
  SELECT ca."id", ca."loanId", ca."transactionId", ca."amount", ca."purpose", ca."status"::text AS "status"
  FROM "CashAdvance" ca;
DELETE FROM "CashAdvanceLiquidation";
DELETE FROM "CashAdvance";

-- CreateEnum
CREATE TYPE "FundsNeeded" AS ENUM ('UNANSWERED', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('NOTARY_FEE', 'PPSR_FEE', 'LTO_FEE', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'RELEASED', 'FOR_LIQUIDATION', 'PARTIALLY_LIQUIDATED', 'LIQUIDATED', 'CLOSED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('DONE', 'NOT_PROCESSED');

-- CreateEnum
CREATE TYPE "RestDecision" AS ENUM ('CARRY_OVER', 'RETURN', 'NONE');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "CarryOverStatus" AS ENUM ('AUTO', 'PENDING', 'APPROVED', 'DENIED');

-- DropForeignKey
ALTER TABLE "CashAdvance" DROP CONSTRAINT "CashAdvance_loanId_fkey";

-- DropForeignKey
ALTER TABLE "CashAdvance" DROP CONSTRAINT "CashAdvance_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "CashAdvanceLiquidation" DROP CONSTRAINT "CashAdvanceLiquidation_cashAdvanceId_fkey";

-- AlterTable
ALTER TABLE "CashAdvance" DROP COLUMN "accounts",
DROP COLUMN "amount",
DROP COLUMN "decidedAt",
DROP COLUMN "decidedBy",
DROP COLUMN "decisionNote",
DROP COLUMN "loanId",
DROP COLUMN "purpose",
DROP COLUMN "requestedAt",
DROP COLUMN "transactionId",
ADD COLUMN     "approvalNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedCents" INTEGER,
ADD COLUMN     "branchId" TEXT NOT NULL,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "deniedReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "exceptionId" TEXT,
ADD COLUMN     "liquidationDueAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "releaseRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "releasedById" TEXT,
ADD COLUMN     "releasedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requestedCents" INTEGER NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "AdvanceStatus" NOT NULL DEFAULT 'REQUESTED';

-- AlterTable
ALTER TABLE "CashAdvanceRule" ADD COLUMN     "kind" "ExpenseKind" NOT NULL DEFAULT 'OTHER',
ALTER COLUMN "suggestedAmount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DpAssignment" ADD COLUMN     "labelsConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "returnReasons" TEXT,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ALTER COLUMN "fundStatus" SET DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "LoanTransaction" ADD COLUMN     "fundsFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "fundsKinds" "ExpenseKind"[],
ADD COLUMN     "fundsNeeded" "FundsNeeded" NOT NULL DEFAULT 'UNANSWERED',
ADD COLUMN     "fundsNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "labelsPrintedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "CashAdvanceLiquidation";

-- DropEnum
DROP TYPE "CashAdvanceStatus";

-- CreateTable
CREATE TABLE "CashAdvanceLine" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "transactionId" TEXT,
    "kind" "ExpenseKind" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "overMaxReason" TEXT NOT NULL DEFAULT '',
    "requestedCents" INTEGER NOT NULL,
    "approvedCents" INTEGER,
    "releasedCents" INTEGER NOT NULL DEFAULT 0,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvanceTopUp" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "extraCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvedCents" INTEGER,
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "releasedCents" INTEGER NOT NULL DEFAULT 0,
    "releasedAt" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvanceTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAttempt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "dpUserId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "reasonId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "restDecision" "RestDecision" NOT NULL DEFAULT 'NONE',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "correctsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptSpend" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,

    CONSTRAINT "AttemptSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "uploadedById" TEXT NOT NULL,
    "correctsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReturn" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "lineId" TEXT,
    "cents" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarryOver" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "attemptId" TEXT,
    "cents" INTEGER NOT NULL,
    "status" "CarryOverStatus" NOT NULL,
    "businessDays" INTEGER NOT NULL DEFAULT 0,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarryOver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundsException" (
    "id" TEXT NOT NULL,
    "dpUserId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FundsException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalBand" (
    "id" TEXT NOT NULL,
    "fromCents" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "raisedById" TEXT,
    "raisedByLabel" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedByLabel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "outsideControl" BOOLEAN NOT NULL DEFAULT false,
    "outsideMarkedById" TEXT,
    "outsideMarkedAt" TIMESTAMP(3),
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionAttempt_transactionId_createdAt_idx" ON "TransactionAttempt"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalBand_fromCents_key" ON "ApprovalBand"("fromCents");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemReason_code_key" ON "ProblemReason"("code");

-- CreateIndex
CREATE INDEX "Problem_transactionId_resolvedAt_idx" ON "Problem"("transactionId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_number_key" ON "CashAdvance"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_exceptionId_key" ON "CashAdvance"("exceptionId");

-- CreateIndex
CREATE INDEX "CashAdvance_requestedById_status_idx" ON "CashAdvance"("requestedById", "status");

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "FundsException"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "CashAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceTopUp" ADD CONSTRAINT "CashAdvanceTopUp_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_dpUserId_fkey" FOREIGN KEY ("dpUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ProblemReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSpend" ADD CONSTRAINT "AttemptSpend_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TransactionAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSpend" ADD CONSTRAINT "AttemptSpend_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReturn" ADD CONSTRAINT "CashReturn_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "CashAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReturn" ADD CONSTRAINT "CashReturn_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryOver" ADD CONSTRAINT "CarryOver_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalBand" ADD CONSTRAINT "ApprovalBand_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ProblemReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- Old cash advances become "needs funds" on their transaction (or on the loan's processor transactions).
UPDATE "LoanTransaction" t SET "fundsNeeded" = 'YES',
  "fundsNote" = 'Old cash advance: PHP ' || o."amount"::text || ' for ' || o."purpose" || ' (' || o."status" || ')'
FROM "_old_cash_advance" o
WHERE (o."transactionId" = t."id")
   OR (o."transactionId" IS NULL AND o."loanId" = t."loanId" AND t."typeId" IN (SELECT "id" FROM "TransactionType" WHERE "requiresDp"));
DROP TABLE "_old_cash_advance";

-- Transactions already sent keep their answer: a funded or for-funding assignment means "needs funds".
UPDATE "LoanTransaction" t SET "fundsNeeded" = CASE WHEN a."fundStatus" = 'NOT_REQUIRED' THEN 'NO'::"FundsNeeded" ELSE 'YES'::"FundsNeeded" END
FROM "DpAssignment" a WHERE a."transactionId" = t."id" AND t."fundsNeeded" = 'UNANSWERED';

-- Labels printed: the earliest label printed on the transaction's papers.
UPDATE "LoanTransaction" t SET "labelsPrintedAt" = x.p
FROM (SELECT "transactionId", MIN("labelPrintedAt") AS p FROM "DocumentItem" WHERE "labelPrintedAt" IS NOT NULL AND "transactionId" IS NOT NULL GROUP BY "transactionId") x
WHERE x."transactionId" = t."id";

-- Cash-advance rules: the expense kind follows the transaction type.
UPDATE "CashAdvanceRule" r SET "kind" = CASE tt."code" WHEN 'NOTARY' THEN 'NOTARY_FEE'::"ExpenseKind" WHEN 'PPSR' THEN 'PPSR_FEE'::"ExpenseKind" WHEN 'MORTGAGE' THEN 'LTO_FEE'::"ExpenseKind" ELSE 'OTHER'::"ExpenseKind" END
FROM "TransactionType" tt WHERE tt."id" = r."transactionTypeId";

-- New permission keys for the built-in roles (Admin is locked in code).
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['funds:flag', 'funds:view', 'problems:raise', 'problems:resolve']) k ORDER BY k) WHERE "key" = 'LA';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['jobs:work', 'funds:request', 'funds:liquidate', 'problems:raise', 'problems:resolve']) k ORDER BY k) WHERE "key" = 'DP';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['funds:approve', 'funds:release', 'funds:view_all', 'funds:exception']) k ORDER BY k), "branchAccess" = 'ALL' WHERE "key" = 'FIN';

-- Default approval band: any amount, Finance.
INSERT INTO "ApprovalBand" ("id", "fromCents", "roleId", "updatedAt")
SELECT 'band_default_any', 0, r."id", now() FROM "Role" r WHERE r."key" = 'FIN'
ON CONFLICT DO NOTHING;

-- Problem reasons (also the result of an attempt that was not processed).
INSERT INTO "ProblemReason" ("id", "code", "name", "sortOrder", "updatedAt") VALUES
  ('pr_lto_down', 'LTO_DOWN', 'LTO maintenance or system down', 1, now()),
  ('pr_lto_closed', 'LTO_CLOSED', 'LTO closed or holiday', 2, now()),
  ('pr_queue', 'LONG_QUEUE', 'Long queue', 3, now()),
  ('pr_missing', 'MISSING_PAPER', 'Missing paper', 4, now()),
  ('pr_wrong', 'WRONG_PAPER', 'Wrong paper', 5, now()),
  ('pr_waiting', 'WAITING', 'Waiting on borrower or another team', 6, now()),
  ('pr_other', 'OTHER', 'Other', 7, now())
ON CONFLICT DO NOTHING;
