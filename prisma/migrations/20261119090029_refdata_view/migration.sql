-- Piece 8 (D-012, D-053): "See reference data changes" for Admin and the LA Supervisor/Head by default.
UPDATE "Role" SET "permissions" = array_append("permissions", 'refdata:view')
WHERE "key" IN ('ADMIN', 'SUP') AND NOT ('refdata:view' = ANY("permissions"));
