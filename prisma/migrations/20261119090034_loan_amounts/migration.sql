-- D-062: the new tick "See loan amounts" (loans:view_amounts). On by default for the Loan Associate, the LA
-- Supervisor/Head, Finance, Admin and the Superadmin; off for the Document Processor, Custodian, Digicur, QA,
-- Archiver and Monitoring. Only built-in roles that do not have it yet; per-person overrides are kept.
UPDATE "Role" SET "permissions" = array_append("permissions", 'loans:view_amounts')
WHERE "key" IN ('LA', 'SUP', 'FIN', 'ADMIN', 'SUPERADMIN') AND NOT ('loans:view_amounts' = ANY("permissions"));
