-- Funds follow-ups (10 November 2026). Written by hand, like 20261119090007: Prisma's shadow database cannot
-- replay the hand-made loan search (trigram) indexes, and its "drop index" lines for them are left out.
-- Safe on a database with data; each step does nothing when it was already done.

-- 1. The per-type Edit tick becomes two ticks, exactly as before the per-type split:
--    Edit lines: everyone who had Approve or Release (they had funds:ca_edit / funds:ft_edit).
--    Change type: only who had Release (they have funds:ca_release / funds:ft_release).
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_edit_lines') WHERE 'funds:ca_edit' = ANY("permissions") AND NOT ('funds:ca_edit_lines' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_edit_lines') WHERE 'funds:ft_edit' = ANY("permissions") AND NOT ('funds:ft_edit_lines' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ca_change_type') WHERE 'funds:ca_edit' = ANY("permissions") AND 'funds:ca_release' = ANY("permissions") AND NOT ('funds:ca_change_type' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:ft_change_type') WHERE 'funds:ft_edit' = ANY("permissions") AND 'funds:ft_release' = ANY("permissions") AND NOT ('funds:ft_change_type' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_remove(array_remove("permissions", 'funds:ca_edit'), 'funds:ft_edit'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE "permissions" && ARRAY['funds:ca_edit', 'funds:ft_edit']::text[];

-- 2. "See funds status" (funds:view) was checked nowhere: funds status shows to everyone who can open
--    the loan file. The tick is removed from every role.
UPDATE "Role" SET "permissions" = array_remove("permissions", 'funds:view'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE 'funds:view' = ANY("permissions");

-- 3. Several roles can share one approval band (the same type and amount): each of them approves it.
DROP INDEX IF EXISTS "ApprovalBand_fundsTypeId_fromCents_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalBand_fundsTypeId_fromCents_roleId_key" ON "ApprovalBand"("fundsTypeId", "fromCents", "roleId");
