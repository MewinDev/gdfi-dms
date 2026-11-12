-- =============================================================================================
-- Baseline (squash, 12 November 2026). Builds the whole database in one step.
-- It replaces the 32 earlier migrations, 20261106060100_init to 20261119090013_myloans_shared_limits
-- (kept outside the project in gdfi-dms-backup/migrations-before-squash; see docs/db/squash-notes.md
-- and docs/db/migration-inventory.md). Proved the same as those 32 applied in order: Prisma's own diff
-- prints no change, and a schema-only pg_dump of both matches apart from column order.
-- New migrations start after this one (20261119090015_<name>, and so on), made with prisma migrate diff
-- only, never prisma migrate dev (CLAUDE.md).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Extension. pg_trgm powers the two loan-search indexes in block 3 (Find a loan: PN and
--    borrower name, prefix then contains). Was in 20261116090000_myloans_load.
-- ---------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------------------------
-- 2. Tables, enums, indexes and foreign keys, generated from prisma/schema.prisma with
--    prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
--    (the generated "CREATE SCHEMA IF NOT EXISTS public" line is left out: the schema always exists).
-- ---------------------------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('FINANCING', 'REFINANCING');

-- CreateEnum
CREATE TYPE "FinancingType" AS ENUM ('UNDERTAKING', 'NON_UNDERTAKING');

-- CreateEnum
CREATE TYPE "OrcrStatus" AS ENUM ('TRANSFERRED', 'UNTRANSFERRED');

-- CreateEnum
CREATE TYPE "MortgageResult" AS ENUM ('MORTGAGE', 'NOT_MORTGAGE', 'NOT_EVALUATED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('FOR_CHECKLIST', 'READY', 'ASSIGNED', 'RETURNED', 'IN_PROCESS', 'FORWARDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('REQUIRED', 'ONE_OF', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "Originality" AS ENUM ('ORIGINAL', 'COPY');

-- CreateEnum
CREATE TYPE "BranchAccess" AS ENUM ('ASSIGNED', 'ALL');

-- CreateEnum
CREATE TYPE "DefaultOriginality" AS ENUM ('ORIGINAL', 'COPY', 'EITHER');

-- CreateEnum
CREATE TYPE "DocumentStage" AS ENUM ('EXPECTED', 'AT_BRANCH', 'IN_TRANSIT', 'WITH_DP', 'IN_SAFEKEEPING', 'PULLED_OUT', 'RELEASED', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "DpAssignmentStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CLOSED', 'PULLED_BACK');

-- CreateEnum
CREATE TYPE "FundStatus" AS ENUM ('NOT_REQUIRED', 'FOR_FUNDING', 'FUNDED');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AuditMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "TransmittalStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY');

-- CreateEnum
CREATE TYPE "PullOutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED', 'RELEASED', 'RETURNED', 'OVERDUE', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "DigitalRecordStatus" AS ENUM ('FOR_SCANNING', 'SCANNED', 'QC_FAILED', 'INDEXED', 'UPLOADED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "QaFindingStatus" AS ENUM ('OPEN', 'ENDORSED', 'CORRECTIVE_ACTION', 'VALIDATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisposalBatchStatus" AS ENUM ('DRAFT', 'FOR_APPROVAL', 'APPROVED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MYLOANS', 'DMS');

-- CreateEnum
CREATE TYPE "AccessGrantKind" AS ENUM ('DIVISION', 'AREA', 'BRANCH');

-- CreateEnum
CREATE TYPE "BranchReviewKind" AS ENUM ('NEW_BRANCH', 'RENAMED', 'CODE_CHANGED', 'MOVED', 'DETAILS_CHANGED', 'CLOSED', 'REOPENED', 'NOT_IN_LIST', 'UNKNOWN_CODE', 'NEW_AREA', 'RENAMED_AREA', 'NEW_DIVISION', 'RENAMED_DIVISION');

-- CreateEnum
CREATE TYPE "BranchReviewState" AS ENUM ('OPEN', 'ACCEPTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SourceChangeCategory" AS ENUM ('MATERIAL', 'STATUS', 'REPLACEMENT', 'BORROWER');

-- CreateEnum
CREATE TYPE "SourceChangeState" AS ENUM ('OPEN', 'APPLIED', 'KEPT', 'CLOSED_CANCELLED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FundsNeeded" AS ENUM ('UNANSWERED', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "ExpenseAmountMode" AS ENUM ('TYPED', 'SUGGESTED', 'FIXED');

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

-- CreateEnum
CREATE TYPE "CashReturnKind" AS ENUM ('CASH', 'HANDOVER');

-- CreateEnum
CREATE TYPE "PaperMissingState" AS ENUM ('MISSING', 'RECEIVED_LATE');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OWN', 'LTO_DROP', 'LTO_PICKUP', 'VERIFY');

-- CreateEnum
CREATE TYPE "JobStageStatus" AS ENUM ('LATER', 'STARTED', 'DONE');

-- CreateEnum
CREATE TYPE "LtoAdvisoryType" AS ENUM ('SYSTEM_DOWN', 'OFFICE_CLOSED', 'LONG_QUEUE', 'OTHER');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[],
    "canSignIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "branchAccess" "BranchAccess" NOT NULL DEFAULT 'ASSIGNED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "roleId" TEXT NOT NULL,
    "externalId" TEXT,
    "isTestUser" BOOLEAN NOT NULL DEFAULT false,
    "emailNonUrgent" BOOLEAN NOT NULL DEFAULT true,
    "dpCapacity" INTEGER,
    "dpOnLeave" BOOLEAN NOT NULL DEFAULT false,
    "dpLeaveUntil" TEXT,
    "allBranches" BOOLEAN NOT NULL DEFAULT false,
    "homeBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "myloansId" INTEGER,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "RecordSource" NOT NULL DEFAULT 'DMS',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "myloansId" INTEGER,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "RecordSource" NOT NULL DEFAULT 'DMS',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "legacyCode" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'DMS',
    "myloansBranchId" INTEGER,
    "divisionId" TEXT,
    "areaId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "myloansUpdatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncHash" TEXT,
    "usualLtoOfficeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "UserAccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AccessGrantKind" NOT NULL,
    "divisionId" TEXT,
    "areaId" TEXT,
    "branchId" TEXT,
    "exclude" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchReview" (
    "id" TEXT NOT NULL,
    "kind" "BranchReviewKind" NOT NULL,
    "state" "BranchReviewState" NOT NULL DEFAULT 'OPEN',
    "branchId" TEXT,
    "myloansBranchId" INTEGER,
    "myloansAreaId" INTEGER,
    "myloansDivisionId" INTEGER,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "runId" TEXT,
    "pn" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedByLabel" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "BranchReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSyncRun" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "changedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "byLabel" TEXT NOT NULL DEFAULT 'System',

    CONSTRAINT "BranchSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "requiresDp" BOOLEAN NOT NULL DEFAULT true,
    "needsLto" BOOLEAN NOT NULL DEFAULT false,
    "ownerRole" TEXT NOT NULL DEFAULT 'DP',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "defaultOriginality" "DefaultOriginality" NOT NULL DEFAULT 'EITHER',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRule" (
    "id" TEXT NOT NULL,
    "transactionTypeId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "oneOfGroup" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "originality" "Originality" NOT NULL DEFAULT 'ORIGINAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtoOffice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "travelHours" DOUBLE PRECISION,
    "suggestedTransportCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtoOffice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TatRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "businessDays" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TatRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvanceRule" (
    "id" TEXT NOT NULL,
    "transactionTypeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "purpose" TEXT NOT NULL,
    "suggestedAmount" DECIMAL(14,2),
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "liquidationDays" INTEGER NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "pn" TEXT NOT NULL,
    "cin" TEXT,
    "cif" TEXT,
    "sourceLoanId" TEXT,
    "borrowerName" TEXT NOT NULL,
    "borrowerAddress" TEXT,
    "borrowerContactNo" TEXT,
    "branchId" TEXT NOT NULL,
    "loanType" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT '',
    "totalReleasedAmount" DECIMAL(14,2) NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "sourceStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MyLoans',
    "productCode" TEXT,
    "sourceBranchCode" TEXT,
    "sourceBranchName" TEXT,
    "sourceAreaId" TEXT,
    "sourceAreaName" TEXT,
    "sourceDivisionId" TEXT,
    "sourceDivisionName" TEXT,
    "sourceCompanyId" TEXT,
    "sourceCompanyName" TEXT,
    "sourceStatusId" TEXT,
    "sourceStatusName" TEXT,
    "sourceIsActive" BOOLEAN,
    "sourceUpdatedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "classification" "Classification" NOT NULL,
    "financingType" "FinancingType",
    "orcrStatus" "OrcrStatus",
    "mortgageResult" "MortgageResult" NOT NULL,
    "ruleFired" TEXT NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL DEFAULT 'Opened',
    "stageSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCurrent" BOOLEAN NOT NULL DEFAULT true,
    "lastRefreshError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "syncTier" TEXT,
    "nextCheckAt" TIMESTAMP(3),
    "replacesPn" TEXT,
    "replacedByPn" TEXT,
    "replacementEvidence" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "disposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanSourceSnapshot" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adapter" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MyLoans',
    "payload" JSONB NOT NULL,
    "changes" JSONB,
    "tracked" JSONB,
    "hash" TEXT,
    "kind" TEXT,

    CONSTRAINT "LoanSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceChange" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "SourceChangeCategory" NOT NULL,
    "changes" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "hash" TEXT NOT NULL,
    "candidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "SourceChangeState" NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedByLabel" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SourceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanTransaction" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'FOR_CHECKLIST',
    "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "checklistSavedAt" TIMESTAMP(3),
    "edstReference" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "fundsNeeded" "FundsNeeded" NOT NULL DEFAULT 'UNANSWERED',
    "fundsKinds" TEXT[],
    "fundsNote" TEXT NOT NULL DEFAULT '',
    "fundsFlaggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistCheck" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "ruleId" TEXT,
    "otherLabel" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "includedInFile" BOOLEAN NOT NULL DEFAULT false,
    "missingState" "PaperMissingState",
    "missingReasonId" TEXT,
    "missingRemarks" TEXT,
    "missingAt" TIMESTAMP(3),
    "missingById" TEXT,
    "missingByLabel" TEXT,
    "remarksAt" TIMESTAMP(3),
    "receivedLateOn" TEXT,
    "receivedLateAt" TIMESTAMP(3),
    "receivedLateById" TEXT,
    "receivedLateBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT,
    "checkId" TEXT,
    "docTypeCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originality" "Originality" NOT NULL DEFAULT 'ORIGINAL',
    "stage" "DocumentStage" NOT NULL DEFAULT 'EXPECTED',
    "custodianLabel" TEXT NOT NULL DEFAULT 'Not yet received',
    "custodianRole" TEXT,
    "custodianUserId" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vaultLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentMovement" (
    "id" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromCustodian" TEXT,
    "toCustodian" TEXT,
    "purpose" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "location" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "correctsId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DpAssignment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "dpBranchId" TEXT NOT NULL,
    "dpUserId" TEXT NOT NULL,
    "secondaryDpUserId" TEXT,
    "pasuyoReason" TEXT,
    "ltoOfficeId" TEXT,
    "fundStatus" "FundStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "returnedAt" TIMESTAMP(3),
    "returnReasons" TEXT,
    "returnReasonId" TEXT,
    "beyondTatReason" TEXT,
    "recommendedDpUserId" TEXT,
    "status" "DpAssignmentStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "endorsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "declineReasons" TEXT,
    "processing" JSONB,
    "forwardedAt" TIMESTAMP(3),
    "receivingLaId" TEXT,
    "receivingBranchId" TEXT,
    "closedAt" TIMESTAMP(3),
    "papersHandedAt" TIMESTAMP(3),
    "papersReceivedAt" TIMESTAMP(3),
    "papersReceivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DpAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanException" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raisedById" TEXT,
    "raisedByLabel" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByLabel" TEXT,
    "resolution" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LoanException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromBranchId" TEXT,
    "toLabel" TEXT NOT NULL DEFAULT 'Main Vault',
    "method" TEXT NOT NULL,
    "status" "TransmittalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransmittalItem" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "received" BOOLEAN NOT NULL DEFAULT false,
    "discrepancy" TEXT,

    CONSTRAINT "TransmittalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultLocation" (
    "id" TEXT NOT NULL,
    "vault" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "box" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "occupied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullOutRequest" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "requestedById" TEXT,
    "purpose" TEXT NOT NULL,
    "isThirdParty" BOOLEAN NOT NULL DEFAULT false,
    "thirdPartyId" TEXT,
    "expectedReturnDate" TIMESTAMP(3) NOT NULL,
    "status" "PullOutStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvals" JSONB,
    "releasedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullOutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdParty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "idType" TEXT NOT NULL DEFAULT '',
    "idNumber" TEXT NOT NULL DEFAULT '',
    "authorizationLetter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThirdParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalRecord" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "status" "DigitalRecordStatus" NOT NULL DEFAULT 'FOR_SCANNING',
    "pageCount" INTEGER,
    "rescanReason" TEXT,
    "storageKey" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaFinding" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "demerits" INTEGER NOT NULL,
    "isRepeat" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "QaFindingStatus" NOT NULL DEFAULT 'OPEN',
    "raisedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "retentionYears" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisposalBatch" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "DisposalBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "certificate" TEXT,
    "loanIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisposalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "userId" TEXT,
    "toName" TEXT NOT NULL,
    "intendedAddress" TEXT NOT NULL,
    "toAddress" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "link" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmailStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "batchedIntoId" TEXT,
    "dedupeKey" TEXT,
    "loanId" TEXT,
    "transactionId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "mode" "AuditMode" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "loanId" TEXT,
    "pn" TEXT,
    "journeyStep" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseKind" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "amountMode" "ExpenseAmountMode" NOT NULL DEFAULT 'TYPED',
    "amountCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" TEXT NOT NULL,
    "movedFromLineId" TEXT,
    "number" TEXT NOT NULL,
    "formerNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedById" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "approvedCents" INTEGER,
    "releasedCents" INTEGER NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT NOT NULL DEFAULT '',
    "deniedReason" TEXT NOT NULL DEFAULT '',
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseRef" TEXT NOT NULL DEFAULT '',
    "fundsTypeId" TEXT NOT NULL DEFAULT 'fundstype_ca',
    "fundsTypeCode" TEXT NOT NULL DEFAULT 'CA',
    "fundsTypeName" TEXT NOT NULL DEFAULT 'Cash advance',
    "transferDate" TEXT NOT NULL DEFAULT '',
    "accountProvider" TEXT NOT NULL DEFAULT '',
    "accountName" TEXT NOT NULL DEFAULT '',
    "accountLast4" TEXT NOT NULL DEFAULT '',
    "liquidationDueAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "exceptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvanceLine" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "transactionId" TEXT,
    "kind" TEXT NOT NULL,
    "otherDescription" TEXT NOT NULL DEFAULT '',
    "amountSource" TEXT NOT NULL DEFAULT 'TYPED',
    "presetCents" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "overMaxReason" TEXT NOT NULL DEFAULT '',
    "ltoOfficeId" TEXT,
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
    "fundsTypeId" TEXT NOT NULL DEFAULT 'fundstype_ca',
    "fundsTypeCode" TEXT NOT NULL DEFAULT 'CA',
    "fundsTypeName" TEXT NOT NULL DEFAULT 'Cash advance',
    "releaseRef" TEXT NOT NULL DEFAULT '',
    "transferDate" TEXT NOT NULL DEFAULT '',
    "accountProvider" TEXT NOT NULL DEFAULT '',
    "accountName" TEXT NOT NULL DEFAULT '',
    "accountLast4" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvanceTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundsType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
    "needsReference" BOOLEAN NOT NULL DEFAULT false,
    "needsAccount" BOOLEAN NOT NULL DEFAULT false,
    "mustLiquidate" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundsType_pkey" PRIMARY KEY ("id")
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
    "jobStageId" TEXT,
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
    "kind" "CashReturnKind" NOT NULL DEFAULT 'CASH',
    "toLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasuyoEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "fromLabel" TEXT,
    "toUserId" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "byUserId" TEXT,
    "byLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "funds" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasuyoEvent_pkey" PRIMARY KEY ("id")
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
    "fundsTypeId" TEXT NOT NULL DEFAULT 'fundstype_ca',
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
    "jobStageId" TEXT,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
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
    "reasonName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "expectedResumeOn" TEXT,
    "raisedById" TEXT,
    "raisedByLabel" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "ownerLabel" TEXT,
    "resumedById" TEXT,
    "resumedByLabel" TEXT,
    "resumedAt" TIMESTAMP(3),
    "resumeNote" TEXT NOT NULL DEFAULT '',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "jobStageId" TEXT,

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldTransfer" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "fromId" TEXT,
    "fromLabel" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "byLabel" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldTransfer_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ReturnReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnReason_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "LtoAdvisory" (
    "id" TEXT NOT NULL,
    "ltoOfficeId" TEXT NOT NULL,
    "type" "LtoAdvisoryType" NOT NULL,
    "remarks" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "filedById" TEXT,
    "filedByLabel" TEXT NOT NULL,
    "assignmentId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByLabel" TEXT,
    "resolveRemarks" TEXT NOT NULL DEFAULT '',
    "editedAt" TIMESTAMP(3),
    "editedByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtoAdvisory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyLoansCallHour" (
    "hour" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyLoansCallHour_pkey" PRIMARY KEY ("hour")
);

-- CreateTable
CREATE TABLE "MyLoansBreaker" (
    "id" TEXT NOT NULL DEFAULT 'myloans',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "openUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyLoansBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Division_myloansId_key" ON "Division"("myloansId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_myloansId_key" ON "Area"("myloansId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_myloansBranchId_key" ON "Branch"("myloansBranchId");

-- CreateIndex
CREATE INDEX "Branch_areaId_idx" ON "Branch"("areaId");

-- CreateIndex
CREATE INDEX "Branch_divisionId_idx" ON "Branch"("divisionId");

-- CreateIndex
CREATE INDEX "user_branch_access_branchId_idx" ON "user_branch_access"("branchId");

-- CreateIndex
CREATE INDEX "UserAccessGrant_userId_idx" ON "UserAccessGrant"("userId");

-- CreateIndex
CREATE INDEX "UserAccessGrant_areaId_idx" ON "UserAccessGrant"("areaId");

-- CreateIndex
CREATE INDEX "UserAccessGrant_divisionId_idx" ON "UserAccessGrant"("divisionId");

-- CreateIndex
CREATE INDEX "UserAccessGrant_branchId_idx" ON "UserAccessGrant"("branchId");

-- CreateIndex
CREATE INDEX "BranchReview_state_kind_idx" ON "BranchReview"("state", "kind");

-- CreateIndex
CREATE INDEX "BranchReview_branchId_idx" ON "BranchReview"("branchId");

-- CreateIndex
CREATE INDEX "BranchReview_myloansBranchId_idx" ON "BranchReview"("myloansBranchId");

-- CreateIndex
CREATE INDEX "BranchSyncRun_at_idx" ON "BranchSyncRun"("at");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionType_code_key" ON "TransactionType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LoanType_code_key" ON "LoanType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LtoOffice_code_key" ON "LtoOffice"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TatRule_key_key" ON "TatRule"("key");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_date_key" ON "HolidayCalendar"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_pn_key" ON "Loan"("pn");

-- CreateIndex
CREATE INDEX "Loan_branchId_stage_idx" ON "Loan"("branchId", "stage");

-- CreateIndex
CREATE INDEX "Loan_cin_idx" ON "Loan"("cin");

-- CreateIndex
CREATE INDEX "Loan_cif_idx" ON "Loan"("cif");

-- CreateIndex
CREATE INDEX "Loan_lastCheckedAt_idx" ON "Loan"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "LoanSourceSnapshot_loanId_retrievedAt_idx" ON "LoanSourceSnapshot"("loanId", "retrievedAt");

-- CreateIndex
CREATE INDEX "SourceChange_loanId_state_idx" ON "SourceChange"("loanId", "state");

-- CreateIndex
CREATE INDEX "SourceChange_state_idx" ON "SourceChange"("state");

-- CreateIndex
CREATE INDEX "LoanTransaction_loanId_status_idx" ON "LoanTransaction"("loanId", "status");

-- CreateIndex
CREATE INDEX "ChecklistCheck_missingState_idx" ON "ChecklistCheck"("missingState");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistCheck_transactionId_ruleId_key" ON "ChecklistCheck"("transactionId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentItem_documentId_key" ON "DocumentItem"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentItem_checkId_key" ON "DocumentItem"("checkId");

-- CreateIndex
CREATE INDEX "DocumentItem_loanId_idx" ON "DocumentItem"("loanId");

-- CreateIndex
CREATE INDEX "DocumentMovement_documentItemId_createdAt_idx" ON "DocumentMovement"("documentItemId", "createdAt");

-- CreateIndex
CREATE INDEX "DpAssignment_dpUserId_status_idx" ON "DpAssignment"("dpUserId", "status");

-- CreateIndex
CREATE INDEX "DpAssignment_loanId_idx" ON "DpAssignment"("loanId");

-- CreateIndex
CREATE INDEX "DpAssignment_status_endorsedAt_idx" ON "DpAssignment"("status", "endorsedAt");

-- CreateIndex
CREATE INDEX "DpAssignment_decidedAt_idx" ON "DpAssignment"("decidedAt");

-- CreateIndex
CREATE INDEX "DpAssignment_returnedAt_idx" ON "DpAssignment"("returnedAt");

-- CreateIndex
CREATE INDEX "LoanException_loanId_status_idx" ON "LoanException"("loanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_number_key" ON "Transmittal"("number");

-- CreateIndex
CREATE UNIQUE INDEX "TransmittalItem_transmittalId_documentItemId_key" ON "TransmittalItem"("transmittalId", "documentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultLocation_label_key" ON "VaultLocation"("label");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRule_documentTypeId_key" ON "RetentionRule"("documentTypeId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key" ON "EmailOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_createdAt_idx" ON "EmailOutbox"("createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_event_userId_status_idx" ON "EmailOutbox"("event", "userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_pn_idx" ON "AuditLog"("pn");

-- CreateIndex
CREATE INDEX "AuditLog_loanId_at_idx" ON "AuditLog"("loanId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseKind_code_key" ON "ExpenseKind"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseKind_nameKey_key" ON "ExpenseKind"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_number_key" ON "CashAdvance"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_exceptionId_key" ON "CashAdvance"("exceptionId");

-- CreateIndex
CREATE INDEX "CashAdvance_requestedById_status_idx" ON "CashAdvance"("requestedById", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FundsType_code_key" ON "FundsType"("code");

-- CreateIndex
CREATE INDEX "TransactionAttempt_transactionId_createdAt_idx" ON "TransactionAttempt"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "PasuyoEvent_assignmentId_createdAt_idx" ON "PasuyoEvent"("assignmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalBand_fundsTypeId_fromCents_roleId_key" ON "ApprovalBand"("fundsTypeId", "fromCents", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemReason_code_key" ON "ProblemReason"("code");

-- CreateIndex
CREATE INDEX "Problem_transactionId_resolvedAt_idx" ON "Problem"("transactionId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HoldReason_code_key" ON "HoldReason"("code");

-- CreateIndex
CREATE INDEX "Hold_transactionId_resumedAt_idx" ON "Hold"("transactionId", "resumedAt");

-- CreateIndex
CREATE INDEX "Hold_loanId_idx" ON "Hold"("loanId");

-- CreateIndex
CREATE INDEX "HoldTransfer_holdId_idx" ON "HoldTransfer"("holdId");

-- CreateIndex
CREATE UNIQUE INDEX "MissingPaperReason_code_key" ON "MissingPaperReason"("code");

-- CreateIndex
CREATE INDEX "PaperEvent_checkId_at_idx" ON "PaperEvent"("checkId", "at");

-- CreateIndex
CREATE INDEX "PaperEvent_loanId_idx" ON "PaperEvent"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReason_code_key" ON "ReturnReason"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStage_typeId_code_key" ON "ProcessingStage"("typeId", "code");

-- CreateIndex
CREATE INDEX "JobStage_assignmentId_sortOrder_idx" ON "JobStage"("assignmentId", "sortOrder");

-- CreateIndex
CREATE INDEX "JobStage_kind_finishedAt_idx" ON "JobStage"("kind", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobStage_assignmentId_code_key" ON "JobStage"("assignmentId", "code");

-- CreateIndex
CREATE INDEX "LtoAdvisory_ltoOfficeId_resolvedAt_idx" ON "LtoAdvisory"("ltoOfficeId", "resolvedAt");

-- CreateIndex
CREATE INDEX "LtoAdvisory_resolvedAt_idx" ON "LtoAdvisory"("resolvedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_usualLtoOfficeId_fkey" FOREIGN KEY ("usualLtoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessGrant" ADD CONSTRAINT "UserAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessGrant" ADD CONSTRAINT "UserAccessGrant_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessGrant" ADD CONSTRAINT "UserAccessGrant_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessGrant" ADD CONSTRAINT "UserAccessGrant_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchReview" ADD CONSTRAINT "BranchReview_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRule" ADD CONSTRAINT "ChecklistRule_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRule" ADD CONSTRAINT "ChecklistRule_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceRule" ADD CONSTRAINT "CashAdvanceRule_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceRule" ADD CONSTRAINT "CashAdvanceRule_kind_fkey" FOREIGN KEY ("kind") REFERENCES "ExpenseKind"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanSourceSnapshot" ADD CONSTRAINT "LoanSourceSnapshot_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceChange" ADD CONSTRAINT "SourceChange_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ChecklistRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missingReasonId_fkey" FOREIGN KEY ("missingReasonId") REFERENCES "MissingPaperReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ChecklistCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_vaultLocationId_fkey" FOREIGN KEY ("vaultLocationId") REFERENCES "VaultLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentMovement" ADD CONSTRAINT "DocumentMovement_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "DocumentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentMovement" ADD CONSTRAINT "DocumentMovement_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "DocumentMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_dpBranchId_fkey" FOREIGN KEY ("dpBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_dpUserId_fkey" FOREIGN KEY ("dpUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_secondaryDpUserId_fkey" FOREIGN KEY ("secondaryDpUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_ltoOfficeId_fkey" FOREIGN KEY ("ltoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_returnReasonId_fkey" FOREIGN KEY ("returnReasonId") REFERENCES "ReturnReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_receivingLaId_fkey" FOREIGN KEY ("receivingLaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_receivingBranchId_fkey" FOREIGN KEY ("receivingBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanException" ADD CONSTRAINT "LoanException_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanException" ADD CONSTRAINT "LoanException_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanException" ADD CONSTRAINT "LoanException_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanException" ADD CONSTRAINT "LoanException_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalItem" ADD CONSTRAINT "TransmittalItem_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalItem" ADD CONSTRAINT "TransmittalItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalItem" ADD CONSTRAINT "TransmittalItem_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "DocumentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullOutRequest" ADD CONSTRAINT "PullOutRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullOutRequest" ADD CONSTRAINT "PullOutRequest_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "DocumentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullOutRequest" ADD CONSTRAINT "PullOutRequest_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalRecord" ADD CONSTRAINT "DigitalRecord_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalRecord" ADD CONSTRAINT "DigitalRecord_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "DocumentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaFinding" ADD CONSTRAINT "QaFinding_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "FundsException"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "CashAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_kind_fkey" FOREIGN KEY ("kind") REFERENCES "ExpenseKind"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_ltoOfficeId_fkey" FOREIGN KEY ("ltoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceTopUp" ADD CONSTRAINT "CashAdvanceTopUp_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceTopUp" ADD CONSTRAINT "CashAdvanceTopUp_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_dpUserId_fkey" FOREIGN KEY ("dpUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ProblemReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "PasuyoEvent" ADD CONSTRAINT "PasuyoEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryOver" ADD CONSTRAINT "CarryOver_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CashAdvanceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalBand" ADD CONSTRAINT "ApprovalBand_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalBand" ADD CONSTRAINT "ApprovalBand_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ProblemReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "HoldReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_resumedById_fkey" FOREIGN KEY ("resumedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_jobStageId_fkey" FOREIGN KEY ("jobStageId") REFERENCES "JobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldTransfer" ADD CONSTRAINT "HoldTransfer_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "Hold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperEvent" ADD CONSTRAINT "PaperEvent_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ChecklistCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingStage" ADD CONSTRAINT "ProcessingStage_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStage" ADD CONSTRAINT "JobStage_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStage" ADD CONSTRAINT "JobStage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProcessingStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtoAdvisory" ADD CONSTRAINT "LtoAdvisory_ltoOfficeId_fkey" FOREIGN KEY ("ltoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtoAdvisory" ADD CONSTRAINT "LtoAdvisory_filedById_fkey" FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- 3. Raw SQL that schema.prisma cannot express (Prisma ignores these objects, so they never show
--    in prisma migrate diff; never let a generated migration drop them). Copied exactly.
-- ---------------------------------------------------------------------------------------------

-- Only one open hold per transaction (several holds over time are fine). Partial unique index.
-- Was in 20261109090000_holds.
CREATE UNIQUE INDEX "Hold_one_open_per_transaction" ON "Hold"("transactionId") WHERE "resumedAt" IS NULL;

-- Due loans: WHERE "syncTier" IS NOT NULL AND "nextCheckAt" <= now ORDER BY "nextCheckAt" LIMIT cap.
-- Partial: closed and cancelled loans (syncTier NULL) are not in the index at all.
-- Was in 20261116090000_myloans_load.
CREATE INDEX "Loan_due_idx" ON "Loan" ("nextCheckAt") WHERE "syncTier" IS NOT NULL;

-- Local search (Find loan): trigram indexes on PN and borrower name (prefix first, then contains).
-- npm run migrate:check fails when either is missing. Was in 20261116090000_myloans_load.
CREATE INDEX "Loan_pn_trgm_idx" ON "Loan" USING gin ("pn" gin_trgm_ops);
CREATE INDEX "Loan_borrowerName_trgm_idx" ON "Loan" USING gin ("borrowerName" gin_trgm_ops);

-- The missing state can never disagree with the tick: Missing is not in hand, Received late is in hand.
-- Was in 20261119090009_missing_papers.
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_state_check"
  CHECK ("missingState" IS NULL OR ("missingState" = 'MISSING' AND NOT "checked") OR ("missingState" = 'RECEIVED_LATE' AND "checked"));

-- Remarks are 5 to 500 characters once saved (the server checks it too, with a plain message).
-- Was in 20261119090009_missing_papers.
ALTER TABLE "ChecklistCheck" ADD CONSTRAINT "ChecklistCheck_missing_remarks_check"
  CHECK ("missingRemarks" IS NULL OR char_length("missingRemarks") BETWEEN 5 AND 500);

-- dms_renumber_advances(): renumbers a request whose number does not start with its funds type's
-- code (a Fund transfer numbered CA-2026-0010). Was in 20261119090006_decisions_batch, which also ran
-- it once on the data of that day (a DO block, left out here: a new database has no requests).
-- Kept because it is re-runnable by hand (SELECT * FROM dms_renumber_advances()) and
-- tests/integration/decisions-batch.test.ts calls it. The comments of that migration explain each step.
CREATE OR REPLACE FUNCTION dms_renumber_advances()
RETURNS TABLE (old_number text, new_number text, outcome text, reason text)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  c record;
  prefix text;
  yr text;
  nxt int;
  newn text;
  pat text;
  leftover bigint;
  since timestamp;
  timecol text;
BEGIN
  FOR a IN
    SELECT ca."id", ca."number", ca."fundsTypeCode", ca."fundsTypeName"
    FROM "CashAdvance" ca
    WHERE ca."number" ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
      AND split_part(ca."number", '-', 1) <> upper(regexp_replace(ca."fundsTypeCode", '[^A-Za-z0-9]', '', 'g'))
    ORDER BY ca."createdAt", ca."number"
  LOOP
    old_number := a."number";
    new_number := NULL;
    prefix := upper(regexp_replace(a."fundsTypeCode", '[^A-Za-z0-9]', '', 'g'));
    yr := split_part(a."number", '-', 2);
    pat := '\y' || a."number" || '\y';
    since := (SELECT x."createdAt" FROM "CashAdvance" x WHERE x."id" = a."id") - interval '1 minute';
    IF prefix = '' THEN
      outcome := 'skipped'; reason := 'The funds type has no usable code.'; RETURN NEXT; CONTINUE;
    END IF;
    -- An email that already went out carries the old number: it cannot be changed.
    IF EXISTS (SELECT 1 FROM "EmailOutbox" e WHERE e."status" = 'SENT' AND e."createdAt" >= since
               AND (e."subject" ~ pat OR e."headline" ~ pat OR e."text" ~ pat OR e."html" ~ pat OR coalesce(e."link", '') ~ pat)) THEN
      outcome := 'skipped'; reason := 'An email with this number was already sent; it cannot be changed.'; RETURN NEXT; CONTINUE;
    END IF;
    SELECT coalesce(max(substring(s.n FROM '^' || prefix || '-' || yr || '-([0-9]+)$')::int), 0) + 1 INTO nxt
      FROM (SELECT x."number" AS n FROM "CashAdvance" x UNION ALL SELECT unnest(x."formerNumbers") FROM "CashAdvance" x) s;
    newn := prefix || '-' || yr || '-' || lpad(nxt::text, 4, '0');
    BEGIN
      UPDATE "CashAdvance" SET "number" = newn, "formerNumbers" = array_append("formerNumbers", a."number"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = a."id";
      UPDATE "CashAdvance" SET "note" = regexp_replace("note", pat, newn, 'g') WHERE "note" ~ pat;
      UPDATE "CashAdvance" SET "releaseRef" = regexp_replace("releaseRef", pat, newn, 'g') WHERE "releaseRef" ~ pat;
      UPDATE "CashAdvanceTopUp" SET "releaseRef" = regexp_replace("releaseRef", pat, newn, 'g') WHERE "releaseRef" ~ pat;
      UPDATE "CashAdvanceLine" SET "note" = regexp_replace("note", pat, newn, 'g') WHERE "note" ~ pat;
      UPDATE "LoanException" SET "reason" = regexp_replace("reason", pat, newn, 'g') WHERE "reason" ~ pat AND "raisedAt" >= since;
      UPDATE "Notification" SET
          "title" = regexp_replace("title", pat, newn, 'g'),
          "body" = regexp_replace("body", pat, newn, 'g'),
          "link" = CASE WHEN "link" IS NULL THEN NULL ELSE regexp_replace("link", pat, newn, 'g') END
        WHERE "createdAt" >= since AND ("title" ~ pat OR "body" ~ pat OR coalesce("link", '') ~ pat);
      UPDATE "AuditLog" SET
          "summary" = regexp_replace("summary", pat, newn, 'g'),
          "before" = CASE WHEN "before"::text ~ pat THEN regexp_replace("before"::text, pat, newn, 'g')::jsonb ELSE "before" END,
          "after" = CASE WHEN "after"::text ~ pat THEN regexp_replace("after"::text, pat, newn, 'g')::jsonb ELSE "after" END,
          "details" = CASE WHEN "details"::text ~ pat THEN regexp_replace("details"::text, pat, newn, 'g')::jsonb ELSE "details" END
        WHERE "at" >= since AND ("summary" ~ pat OR "before"::text ~ pat OR "after"::text ~ pat OR "details"::text ~ pat);
      UPDATE "EmailOutbox" SET
          "subject" = regexp_replace("subject", pat, newn, 'g'),
          "headline" = regexp_replace("headline", pat, newn, 'g'),
          "text" = regexp_replace("text", pat, newn, 'g'),
          "html" = regexp_replace("html", pat, newn, 'g'),
          "link" = CASE WHEN "link" IS NULL THEN NULL ELSE regexp_replace("link", pat, newn, 'g') END
        WHERE "status" <> 'SENT' AND "createdAt" >= since AND ("subject" ~ pat OR "headline" ~ pat OR "text" ~ pat OR "html" ~ pat OR coalesce("link", '') ~ pat);
      -- Nothing may still point at the old number (only formerNumbers keeps it): otherwise undo.
      FOR c IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
          AND table_name <> '_prisma_migrations'
      LOOP
        IF c.table_name = 'CashAdvance' AND c.column_name = 'formerNumbers' THEN CONTINUE; END IF;
        -- Rows older than the request in the history tables are about another request (see above).
        timecol := CASE c.table_name WHEN 'AuditLog' THEN 'at' WHEN 'Notification' THEN 'createdAt' WHEN 'EmailOutbox' THEN 'createdAt' WHEN 'LoanException' THEN 'raisedAt' ELSE NULL END;
        IF timecol IS NULL THEN
          EXECUTE format('SELECT count(*) FROM %I WHERE %I::text ~ %L', c.table_name, c.column_name, pat) INTO leftover;
        ELSE
          EXECUTE format('SELECT count(*) FROM %I WHERE %I::text ~ %L AND %I >= %L', c.table_name, c.column_name, pat, timecol, since) INTO leftover;
        END IF;
        IF leftover > 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format('The old number is also stored in %s.%s (%s row(s)), which is not changed automatically.', c.table_name, c.column_name, leftover);
        END IF;
      END LOOP;
      INSERT INTO "AuditLog" ("id", "at", "actorLabel", "mode", "action", "entityType", "entityId", "summary", "details")
      VALUES ('renum_' || md5(a."id" || newn), CURRENT_TIMESTAMP, 'System', 'AUTOMATIC', 'advance_renumbered', 'CashAdvance', a."id",
        newn || ': numbered as a ' || a."fundsTypeName" || ' (formerly ' || a."number" || ')',
        jsonb_build_object('formerNumber', a."number", 'number', newn));
      new_number := newn; outcome := 'renumbered'; reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      new_number := NULL; outcome := 'skipped'; reason := SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 4. Data a new, empty database needs. Only the expense kinds: the seed does not create them, and
--    every cash-advance rule and line points at a kind by code (CashAdvanceRule_kind_fkey,
--    CashAdvanceLine_kind_fkey), so without them prisma/seed.ts stops at its cash-advance rules.
--    Same rows and ids as 20261119090005_expense_kinds. Every other data step of the old migrations
--    either fixed old rows (renames, copies, backfills) or is created by prisma/seed.ts (roles,
--    reasons, funds types, approval bands); see docs/db/migration-inventory.md.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "ExpenseKind" ("id", "code", "name", "nameKey", "builtIn", "sortOrder", "updatedAt") VALUES
  ('xk_notary_fee', 'NOTARY_FEE', 'Notary fee', 'notaryfee', false, 1, CURRENT_TIMESTAMP),
  ('xk_ppsr_fee',   'PPSR_FEE',   'PPSR fee',   'ppsrfee',   false, 2, CURRENT_TIMESTAMP),
  ('xk_lto_fee',    'LTO_FEE',    'LTO fee',    'ltofee',    false, 3, CURRENT_TIMESTAMP),
  ('xk_transport',  'TRANSPORT',  'Transport',  'transport', false, 4, CURRENT_TIMESTAMP),
  ('xk_other',      'OTHER',      'Other',      'other',     true,  999, CURRENT_TIMESTAMP);
