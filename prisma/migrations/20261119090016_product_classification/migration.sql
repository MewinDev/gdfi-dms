-- D-031 (17 November 2026): product classification by keywords.
-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "classificationNow" "Classification",
ADD COLUMN     "classifiedByDefault" BOOLEAN NOT NULL DEFAULT false;

-- New permission keys on the built-in roles (the defaults in lib/auth/permissions.ts):
-- "settings:classification" for Admin and Superadmin; "loans:reclassify" for Admin and the LA Supervisor/Head.
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings:classification')
WHERE "key" IN ('ADMIN', 'SUPERADMIN') AND NOT ('settings:classification' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'loans:reclassify')
WHERE "key" IN ('ADMIN', 'SUP') AND NOT ('loans:reclassify' = ANY("permissions"));
