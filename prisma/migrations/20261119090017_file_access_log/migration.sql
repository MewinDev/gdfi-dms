-- Piece 3 (D-019, D-039, 17 November 2026): the file access log, append-only.
-- CreateTable
CREATE TABLE "FileAccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "loanId" TEXT,
    "pn" TEXT,
    "branchId" TEXT,
    "fileKey" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "FileAccessLog_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "FileAccessLog_at_idx" ON "FileAccessLog"("at");
-- CreateIndex
CREATE INDEX "FileAccessLog_userId_at_idx" ON "FileAccessLog"("userId", "at");
-- CreateIndex
CREATE INDEX "FileAccessLog_branchId_at_idx" ON "FileAccessLog"("branchId", "at");
-- CreateIndex
CREATE INDEX "FileAccessLog_pn_idx" ON "FileAccessLog"("pn");
-- AddForeignKey
ALTER TABLE "FileAccessLog" ADD CONSTRAINT "FileAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: no row is ever changed or removed (the database refuses it). Prisma cannot express this.
CREATE OR REPLACE FUNCTION dms_file_access_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FileAccessLog is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FileAccessLog_append_only" BEFORE UPDATE OR DELETE ON "FileAccessLog"
  FOR EACH ROW EXECUTE FUNCTION dms_file_access_log_append_only();

-- "View file access log" on the built-in Admin and Superadmin roles (the defaults in lib/auth/permissions.ts).
UPDATE "Role" SET "permissions" = array_append("permissions", 'audit:files')
WHERE "key" IN ('ADMIN', 'SUPERADMIN') AND NOT ('audit:files' = ANY("permissions"));
