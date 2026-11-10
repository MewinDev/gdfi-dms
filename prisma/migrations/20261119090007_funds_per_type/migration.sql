-- Cash advances and fund transfers are handled by different people (confirmed by the users on
-- 10 November 2026): every Finance funds step becomes two ticks, one per type, and the approval bands
-- are per type. Nobody loses anything: a role with an old key gets both types' keys, and every band is
-- copied to both types.
-- Written by hand: `prisma migrate dev --create-only` cannot replay the earlier migrations on its shadow
-- database (the loan search trigram indexes are made by hand in 20261116090000_myloans_load); Prisma's
-- generated "drop index" lines for those indexes are left out on purpose. Safe on a database with data,
-- and each step does nothing when it was already done.

-- 1. Approval bands per type: the type column (existing bands are Cash advance), unique per type and amount.
DROP INDEX IF EXISTS "ApprovalBand_fromCents_key";
ALTER TABLE "ApprovalBand" ADD COLUMN IF NOT EXISTS "fundsTypeId" TEXT NOT NULL DEFAULT 'fundstype_ca';
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalBand_fundsTypeId_fromCents_key" ON "ApprovalBand"("fundsTypeId", "fromCents");
ALTER TABLE "ApprovalBand" ADD CONSTRAINT "ApprovalBand_fundsTypeId_fkey" FOREIGN KEY ("fundsTypeId") REFERENCES "FundsType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Copy every band to Fund transfer (same amount, role and status), so the same people approve as today.
INSERT INTO "ApprovalBand" ("id", "fundsTypeId", "fromCents", "roleId", "active", "deactivatedAt", "deactivatedById", "createdAt", "updatedAt")
SELECT 'ftband_' || b."id", 'fundstype_ft', b."fromCents", b."roleId", b."active", b."deactivatedAt", b."deactivatedById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ApprovalBand" b
WHERE b."fundsTypeId" = 'fundstype_ca'
  AND EXISTS (SELECT 1 FROM "FundsType" t WHERE t."id" = 'fundstype_ft')
  AND NOT EXISTS (SELECT 1 FROM "ApprovalBand" x WHERE x."fundsTypeId" = 'fundstype_ft' AND x."fromCents" = b."fromCents");

-- 2. Permissions per type, on every role (built-in and custom) that had the old key; then the old keys go.
--    See all advances (funds:view_all)          -> See cash advances, See fund transfers
--    Approve cash advances (funds:approve)      -> Approve ... of each type, and Edit lines and change type of each type
--    Release funds (funds:release)              -> Release, Settle and close, Edit lines and change type, of each type
--    Print liquidation report (funds:print)     -> Print liquidation report for each type
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_view') WHERE 'funds:view_all' = ANY("permissions") AND NOT ('funds:ca_view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_view') WHERE 'funds:view_all' = ANY("permissions") AND NOT ('funds:ft_view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_approve') WHERE 'funds:approve' = ANY("permissions") AND NOT ('funds:ca_approve' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_approve') WHERE 'funds:approve' = ANY("permissions") AND NOT ('funds:ft_approve' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_release') WHERE 'funds:release' = ANY("permissions") AND NOT ('funds:ca_release' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_release') WHERE 'funds:release' = ANY("permissions") AND NOT ('funds:ft_release' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_settle') WHERE 'funds:release' = ANY("permissions") AND NOT ('funds:ca_settle' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_settle') WHERE 'funds:release' = ANY("permissions") AND NOT ('funds:ft_settle' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_edit') WHERE ('funds:approve' = ANY("permissions") OR 'funds:release' = ANY("permissions")) AND NOT ('funds:ca_edit' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_edit') WHERE ('funds:approve' = ANY("permissions") OR 'funds:release' = ANY("permissions")) AND NOT ('funds:ft_edit' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_print') WHERE 'funds:print' = ANY("permissions") AND NOT ('funds:ca_print' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_print') WHERE 'funds:print' = ANY("permissions") AND NOT ('funds:ft_print' = ANY("permissions"));
-- Every per-type tick needs that type's See tick (as the role editor does).
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_view')
  WHERE "permissions" && ARRAY['funds:ca_approve', 'funds:ca_release', 'funds:ca_settle', 'funds:ca_edit', 'funds:ca_print']::text[] AND NOT ('funds:ca_view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_view')
  WHERE "permissions" && ARRAY['funds:ft_approve', 'funds:ft_release', 'funds:ft_settle', 'funds:ft_edit', 'funds:ft_print']::text[] AND NOT ('funds:ft_view' = ANY("permissions"));
UPDATE "Role" SET
    "permissions" = array_remove(array_remove(array_remove(array_remove("permissions", 'funds:view_all'), 'funds:approve'), 'funds:release'), 'funds:print'),
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "permissions" && ARRAY['funds:view_all', 'funds:approve', 'funds:release', 'funds:print']::text[];
