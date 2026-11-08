-- AlterTable
ALTER TABLE "ChecklistCheck" ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ChecklistRule" ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true;

-- Data: keep today's behaviour exactly.
-- 1) Lines that are already optional today (kind OPTIONAL) stay optional. Everything else stays required.
UPDATE "ChecklistRule" SET "required" = false WHERE "kind" = 'OPTIONAL';
-- 2) Open loan files keep the setting their lines were opened with.
UPDATE "ChecklistCheck" c SET "required" = r."required" FROM "ChecklistRule" r WHERE c."ruleId" = r."id";
-- 3) "Others" free-text papers (no rule) are extra papers, never required.
UPDATE "ChecklistCheck" SET "required" = false WHERE "ruleId" IS NULL;
