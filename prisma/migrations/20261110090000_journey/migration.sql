-- Custody trail: who did each movement (as shown) and where the paper is afterwards.
ALTER TABLE "DocumentMovement" ADD COLUMN "actorLabel" TEXT,
ADD COLUMN "location" TEXT;

-- Past movements: fill the name from the user (where known). Rows are never changed otherwise.
UPDATE "DocumentMovement" m SET "actorLabel" = u."name" FROM "User" u WHERE m."actorId" = u."id" AND m."actorLabel" IS NULL;

-- Cash amounts in the Journey: Finance and the Approver roles (Admin has it through its locked set).
-- A normal switch in Roles and access afterwards.
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT k FROM unnest("permissions" || ARRAY['journey:view_amounts']) k ORDER BY k) WHERE "key" IN ('FIN', 'APPR');
