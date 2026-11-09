-- Monitoring: processor capacity and On leave, the default capacity setting, LTO advisories and the
-- indexes the Monitoring page counts with. The Operations Monitor role and "File an LTO advisory" for
-- the built-in Document Processor role. No data is removed.
-- (The Loan trigram search indexes are kept: they are not in the Prisma schema on purpose.)

-- CreateEnum
CREATE TYPE "LtoAdvisoryType" AS ENUM ('SYSTEM_DOWN', 'OFFICE_CLOSED', 'LONG_QUEUE', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dpCapacity" INTEGER,
ADD COLUMN     "dpLeaveUntil" TEXT,
ADD COLUMN     "dpOnLeave" BOOLEAN NOT NULL DEFAULT false;

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

-- CreateIndex
CREATE INDEX "LtoAdvisory_ltoOfficeId_resolvedAt_idx" ON "LtoAdvisory"("ltoOfficeId", "resolvedAt");

-- CreateIndex
CREATE INDEX "LtoAdvisory_resolvedAt_idx" ON "LtoAdvisory"("resolvedAt");

-- CreateIndex
CREATE INDEX "DpAssignment_status_endorsedAt_idx" ON "DpAssignment"("status", "endorsedAt");

-- CreateIndex
CREATE INDEX "DpAssignment_decidedAt_idx" ON "DpAssignment"("decidedAt");

-- CreateIndex
CREATE INDEX "DpAssignment_returnedAt_idx" ON "DpAssignment"("returnedAt");

-- CreateIndex
CREATE INDEX "JobStage_kind_finishedAt_idx" ON "JobStage"("kind", "finishedAt");

-- AddForeignKey
ALTER TABLE "LtoAdvisory" ADD CONSTRAINT "LtoAdvisory_ltoOfficeId_fkey" FOREIGN KEY ("ltoOfficeId") REFERENCES "LtoOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtoAdvisory" ADD CONSTRAINT "LtoAdvisory_filedById_fkey" FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The default capacity of a processor (open jobs), changed in Settings, Processor capacity.
INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('dp.defaultCapacity', '10'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- The built-in Document Processor role files LTO advisories (existing roles keep their other switches).
UPDATE "Role" SET "permissions" = array_append("permissions", 'ltoreports:create'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'DP' AND "builtIn" = true AND NOT ('ltoreports:create' = ANY("permissions"));

-- Operations Monitor: read-only, all branches (the seed refreshes its name; switches are kept after that).
INSERT INTO "Role" ("id", "key", "name", "description", "permissions", "canSignIn", "sortOrder", "builtIn", "branchAccess", "active", "createdAt", "updatedAt")
VALUES ('role_monitor', 'MONITOR', 'Operations Monitor', 'Watches processors and LTO offices (Monitoring page) and resolves LTO advisories. Read-only.',
  ARRAY['monitor:dp', 'monitor:lto', 'ltoreports:manage']::text[], true, 9, true, 'ALL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
