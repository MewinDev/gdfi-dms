-- CreateEnum
CREATE TYPE "BranchAccess" AS ENUM ('ASSIGNED', 'ALL');

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "branchAccess" "BranchAccess" NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "builtIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- Data: the seeded roles are built in.
UPDATE "Role" SET "builtIn" = true WHERE "key" IN ('LA', 'ADMIN', 'DP', 'FIN', 'VAULT', 'DIG', 'QA', 'APPR');

-- Data: "see every branch" becomes the role's Branch access.
UPDATE "Role" SET "branchAccess" = 'ALL' WHERE 'loans:view_all' = ANY("permissions");

-- Data: the old coarse keys become the new, specific keys (same abilities as before).
--   workflow:la    -> tick papers, print labels, add a transaction, mark as done, send to a processor, accept returned papers
--   workflow:dp    -> receive and process transactions
--   admin:users    -> see users, add or edit users, manage roles and access
--   admin:settings -> every Settings switch, import data, reset test data
--   loans:view_all -> Branch access = All branches (above)
--   notifications:view, workflow:fin/vault/dig/qa/appr were never checked anywhere: dropped.
UPDATE "Role" SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM unnest(
    ARRAY(SELECT x FROM unnest("permissions") x WHERE x IN ('loans:view', 'loans:search', 'loans:open', 'loans:export', 'rules:override', 'audit:view', 'simulator:use'))
    || CASE WHEN 'workflow:la' = ANY("permissions") THEN ARRAY['checklist:tick', 'labels:print', 'transactions:add', 'transactions:complete', 'processing:send', 'processing:accept_returns'] ELSE ARRAY[]::text[] END
    || CASE WHEN 'workflow:dp' = ANY("permissions") THEN ARRAY['processing:receive'] ELSE ARRAY[]::text[] END
    || CASE WHEN 'admin:users' = ANY("permissions") THEN ARRAY['users:view', 'users:edit', 'roles:manage'] ELSE ARRAY[]::text[] END
    || CASE WHEN 'admin:settings' = ANY("permissions") THEN ARRAY['settings:branches', 'settings:loan_types', 'settings:transaction_types', 'settings:document_types', 'settings:checklist', 'settings:tat', 'settings:holidays', 'settings:cash_advance', 'settings:lto', 'settings:system', 'settings:import', 'testdata:reset'] ELSE ARRAY[]::text[] END
  ) AS k ORDER BY k
);
