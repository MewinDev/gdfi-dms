-- Hold owner: the only person who can resume. Starts as the person who put it on hold.
ALTER TABLE "Hold" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Hold" ADD COLUMN "ownerLabel" TEXT;
UPDATE "Hold" SET "ownerId" = "raisedById", "ownerLabel" = "raisedByLabel" WHERE "raisedById" IS NOT NULL;
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hold transfers (append-only history).
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
CREATE INDEX "HoldTransfer_holdId_idx" ON "HoldTransfer"("holdId");
ALTER TABLE "HoldTransfer" ADD CONSTRAINT "HoldTransfer_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "Hold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Return to LA: papers handed over by the DP, confirmed back by the LA.
ALTER TABLE "DpAssignment" ADD COLUMN "papersHandedAt" TIMESTAMP(3);
ALTER TABLE "DpAssignment" ADD COLUMN "papersReceivedAt" TIMESTAMP(3);
ALTER TABLE "DpAssignment" ADD COLUMN "papersReceivedBy" TEXT;

-- Permissions: "Resume any hold" is removed (only the hold owner resumes); Finance (the role that
-- approves cash advances) may transfer holds. Admin gets every non-workflow switch automatically.
UPDATE "Role" SET "permissions" = array_remove("permissions", 'holds:resolve_any') WHERE 'holds:resolve_any' = ANY("permissions");
UPDATE "Role" SET "permissions" = array_append("permissions", 'holds:transfer') WHERE "key" = 'FIN' AND NOT ('holds:transfer' = ANY("permissions"));
