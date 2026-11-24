-- D-052: "Manage product classification" (settings:classification) is on by default for the LA Supervisor/Head only.
-- Admin and Superadmin lose it here; the Superadmin can grant it to anyone in the permission matrix.
UPDATE "Role" SET "permissions" = array_remove("permissions", 'settings:classification') WHERE "key" IN ('ADMIN', 'SUPERADMIN');
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings:classification')
WHERE "key" = 'SUP' AND NOT ('settings:classification' = ANY("permissions"));
