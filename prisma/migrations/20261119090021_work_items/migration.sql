-- Piece 9 (D-014, D-015, D-046, 18 November 2026): work items (branch pool, inbox, rounds), their history, and Away.
-- Made with prisma migrate diff; the trigram DROP INDEX lines removed. Existing open work becomes items through
-- npm run work:backfill (it needs the calendar code), not here.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "awayFrom" TEXT,
ADD COLUMN     "awayNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "awayTo" TEXT;

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL DEFAULT '',
    "loanId" TEXT,
    "pn" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "holderUserId" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "dueDate" TEXT,
    "targetDays" INTEGER,
    "overallDueDate" TEXT,
    "measure" TEXT NOT NULL DEFAULT 'TAT',
    "outcome" TEXT,
    "doneAt" TIMESTAMP(3),
    "returnReason" TEXT NOT NULL DEFAULT '',
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "sendInput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkMovement" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "byId" TEXT,
    "byLabel" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT NOT NULL DEFAULT '',
    "waitingDays" INTEGER,
    "tatDaysUsed" INTEGER,
    "isLate" BOOLEAN,

    CONSTRAINT "WorkMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItem_state_branchId_role_idx" ON "WorkItem"("state", "branchId", "role");

-- CreateIndex
CREATE INDEX "WorkItem_holderUserId_state_idx" ON "WorkItem"("holderUserId", "state");

-- CreateIndex
CREATE INDEX "WorkItem_loanId_idx" ON "WorkItem"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_kind_subjectId_round_key" ON "WorkItem"("kind", "subjectId", "round");

-- CreateIndex
CREATE INDEX "WorkMovement_workItemId_idx" ON "WorkMovement"("workItemId");

-- CreateIndex
CREATE INDEX "WorkMovement_at_idx" ON "WorkMovement"("at");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMovement" ADD CONSTRAINT "WorkMovement_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- "Move work items" and "Set who is away" on the built-in Admin and LA Supervisor/Head roles (the defaults in
-- lib/auth/permissions.ts; not the Superadmin: day-to-day work, D-028).
UPDATE "Role" SET "permissions" = array_append("permissions", 'workitems:move')
WHERE "key" IN ('ADMIN', 'SUP') AND NOT ('workitems:move' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'users:away')
WHERE "key" IN ('ADMIN', 'SUP') AND NOT ('users:away' = ANY("permissions"));
