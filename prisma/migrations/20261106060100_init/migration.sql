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
CREATE TYPE "DocumentStage" AS ENUM ('EXPECTED', 'AT_BRANCH', 'IN_TRANSIT', 'WITH_DP', 'IN_SAFEKEEPING', 'PULLED_OUT', 'RELEASED', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "DpAssignmentStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FundStatus" AS ENUM ('NOT_REQUIRED', 'FOR_FUNDING', 'FUNDED');

-- CreateEnum
CREATE TYPE "CashAdvanceStatus" AS ENUM ('REQUESTED', 'RELEASED', 'REJECTED', 'LIQUIDATED', 'CANCELLED');

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

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[],
    "canSignIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
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
    "roleId" TEXT NOT NULL,
    "externalId" TEXT,
    "isTestUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "TransactionType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "requiresDp" BOOLEAN NOT NULL DEFAULT true,
    "ownerRole" TEXT NOT NULL DEFAULT 'DP',
    "tatDays" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
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
    "originality" "Originality" NOT NULL DEFAULT 'ORIGINAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
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
    "purpose" TEXT NOT NULL,
    "suggestedAmount" DECIMAL(14,2) NOT NULL,
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "liquidationDays" INTEGER NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
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
    "branchId" TEXT NOT NULL,
    "loanType" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT '',
    "totalReleasedAmount" DECIMAL(14,2) NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "sourceStatus" TEXT NOT NULL,
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
    "payload" JSONB NOT NULL,
    "changes" JSONB,

    CONSTRAINT "LoanSourceSnapshot_pkey" PRIMARY KEY ("id")
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
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
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
    "labelPrintedAt" TIMESTAMP(3),
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
    "fundStatus" "FundStatus" NOT NULL,
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
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DpAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT,
    "requestedById" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "accounts" TEXT NOT NULL,
    "status" "CashAdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvanceLiquidation" (
    "id" TEXT NOT NULL,
    "cashAdvanceId" TEXT NOT NULL,
    "amountSpent" DECIMAL(14,2) NOT NULL,
    "amountReturned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receipts" TEXT NOT NULL DEFAULT '',
    "liquidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liquidatedBy" TEXT NOT NULL,

    CONSTRAINT "CashAdvanceLiquidation_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

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
CREATE INDEX "LoanSourceSnapshot_loanId_retrievedAt_idx" ON "LoanSourceSnapshot"("loanId", "retrievedAt");

-- CreateIndex
CREATE INDEX "LoanTransaction_loanId_status_idx" ON "LoanTransaction"("loanId", "status");

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
CREATE INDEX "AuditLog_pn_idx" ON "AuditLog"("pn");

-- CreateIndex
CREATE INDEX "AuditLog_loanId_at_idx" ON "AuditLog"("loanId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRule" ADD CONSTRAINT "ChecklistRule_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRule" ADD CONSTRAINT "ChecklistRule_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceRule" ADD CONSTRAINT "CashAdvanceRule_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "TransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanSourceSnapshot" ADD CONSTRAINT "LoanSourceSnapshot_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpAssignment" ADD CONSTRAINT "DpAssignment_receivingLaId_fkey" FOREIGN KEY ("receivingLaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceLiquidation" ADD CONSTRAINT "CashAdvanceLiquidation_cashAdvanceId_fkey" FOREIGN KEY ("cashAdvanceId") REFERENCES "CashAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
