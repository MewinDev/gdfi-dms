-- Piece 2, permission core (D-008, D-009). Created with prisma migrate diff (CLAUDE.md); the two
-- loan-search trigram "drop index" lines were removed. Nothing else is dropped.
-- Per-user permission overrides (GRANT / DENY) and the Finance "Handles CA" / "Handles FT" ticks.

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('GRANT', 'DENY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "handlesCa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handlesFt" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "setById" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermissionOverride_key_idx" ON "UserPermissionOverride"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_key_key" ON "UserPermissionOverride"("userId", "key");

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (D-009): nobody changes behaviour. A person handles a fund type when their role has any of
-- that type's funds keys today. New people start with neither tick.
UPDATE "User" u SET "handlesCa" = true FROM "Role" r
 WHERE r."id" = u."roleId"
   AND r."permissions" && ARRAY['funds:ca_view','funds:ca_approve','funds:ca_release','funds:ca_settle','funds:ca_edit_lines','funds:ca_change_type','funds:ca_print']::text[];
UPDATE "User" u SET "handlesFt" = true FROM "Role" r
 WHERE r."id" = u."roleId"
   AND r."permissions" && ARRAY['funds:ft_view','funds:ft_approve','funds:ft_release','funds:ft_settle','funds:ft_edit_lines','funds:ft_change_type','funds:ft_print']::text[];
