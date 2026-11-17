-- D-042 (18 November 2026): a holiday or closure made inactive undoes only its own due-date extensions, and an
-- admin may correct one saved due date. Made with prisma migrate diff; the trigram DROP INDEX lines removed.

-- AlterTable
ALTER TABLE "DueDateChange" ADD COLUMN     "reversesChangeId" TEXT;

-- "Correct due dates" on the built-in Admin and Superadmin roles (the defaults in lib/auth/permissions.ts).
UPDATE "Role" SET "permissions" = array_append("permissions", 'duedates:correct')
WHERE "key" IN ('ADMIN', 'SUPERADMIN') AND NOT ('duedates:correct' = ANY("permissions"));
