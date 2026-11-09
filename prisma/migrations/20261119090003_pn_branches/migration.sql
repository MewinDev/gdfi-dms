-- The real PN format, branch codes, areas and divisions from MyLoans, the branch review, and branch
-- access per user (grants and exceptions, with the derived table user_branch_access).
-- Nothing is deleted. A branch code that is not the 3-digit MyLoans code moves to legacyCode and the
-- branch shows "Code needed" (codes are never guessed). Existing users keep exactly what they had:
-- their current branch becomes their home branch and a single-branch grant; users whose role gives
-- all branches (Admin, Finance, Operations Monitor) get "All branches".
-- (The Loan trigram search indexes are kept: they are not in the Prisma schema on purpose.)

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MYLOANS', 'DMS');

-- CreateEnum
CREATE TYPE "AccessGrantKind" AS ENUM ('DIVISION', 'AREA', 'BRANCH');

-- CreateEnum
CREATE TYPE "BranchReviewKind" AS ENUM ('NEW_BRANCH', 'RENAMED', 'CODE_CHANGED', 'MOVED', 'DETAILS_CHANGED', 'CLOSED', 'REOPENED', 'NOT_IN_LIST', 'UNKNOWN_CODE', 'NEW_AREA', 'RENAMED_AREA', 'NEW_DIVISION', 'RENAMED_DIVISION');

-- CreateEnum
CREATE TYPE "BranchReviewState" AS ENUM ('OPEN', 'ACCEPTED', 'IGNORED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "divisionId" TEXT,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenById" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "legacyCode" TEXT,
ADD COLUMN     "myloansBranchId" INTEGER,
ADD COLUMN     "myloansUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'DMS',
ADD COLUMN     "syncHash" TEXT,
ALTER COLUMN "code" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allBranches" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "homeBranchId" TEXT;

-- The old assigned branches become the derived access table (rows kept; renamed, not dropped).
ALTER TABLE "UserBranch" RENAME TO "user_branch_access";
ALTER TABLE "user_branch_access" RENAME CONSTRAINT "UserBranch_pkey" TO "user_branch_access_pkey";
ALTER TABLE "user_branch_access" RENAME CONSTRAINT "UserBranch_userId_fkey" TO "user_branch_access_userId_fkey";
ALTER TABLE "user_branch_access" RENAME CONSTRAINT "UserBranch_branchId_fkey" TO "user_branch_access_branchId_fkey";

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

-- CreateIndex
CREATE UNIQUE INDEX "Division_myloansId_key" ON "Division"("myloansId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_myloansId_key" ON "Area"("myloansId");

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
CREATE UNIQUE INDEX "Branch_myloansBranchId_key" ON "Branch"("myloansBranchId");

-- CreateIndex
CREATE INDEX "Branch_areaId_idx" ON "Branch"("areaId");

-- CreateIndex
CREATE INDEX "Branch_divisionId_idx" ON "Branch"("divisionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- Data: branch codes. Only the 3-digit MyLoans codes (100 to 999) stay; the rest are kept as legacyCode.
UPDATE "Branch" SET "legacyCode" = "code", "code" = NULL WHERE "code" IS NOT NULL AND "code" !~ '^[1-9][0-9]{2}$';

-- Data: home branch = the user's current branch (the first by name when there are several).
UPDATE "User" u SET "homeBranchId" = (
  SELECT a."branchId" FROM "user_branch_access" a JOIN "Branch" b ON b."id" = a."branchId"
  WHERE a."userId" = u."id" ORDER BY b."name" LIMIT 1
);

-- Data: "All branches" for users whose role gave all branches (and Admin, always All).
UPDATE "User" u SET "allBranches" = true FROM "Role" r WHERE r."id" = u."roleId" AND (r."branchAccess" = 'ALL' OR r."key" = 'ADMIN');

-- Data: everyone else keeps their branches as single-branch grants.
INSERT INTO "UserAccessGrant" ("id", "userId", "kind", "branchId", "exclude", "createdAt")
SELECT 'grant_' || md5(a."userId" || ':' || a."branchId"), a."userId", 'BRANCH', a."branchId", false, CURRENT_TIMESTAMP
FROM "user_branch_access" a JOIN "User" u ON u."id" = a."userId" WHERE NOT u."allBranches";

-- Data: "All branches" is a flag with no rows.
DELETE FROM "user_branch_access" a USING "User" u WHERE u."id" = a."userId" AND u."allBranches";
