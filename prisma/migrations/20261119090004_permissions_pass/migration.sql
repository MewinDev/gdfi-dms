-- Permissions pass: every feature is a tick on a role ("roles are just ticks").
-- No table changes: Role.permissions is a text[] of keys (lib/auth/permissions.ts). This migration only
-- renames three keys and gives every existing role (built-in and custom) the new ticks for what it can
-- already do, so nobody gains or loses anything. Prisma's generated "drop index" lines for the loan
-- search (trigram) indexes were removed: those indexes are made by hand in 20261116090000_myloans_load.

-- 1. Renamed keys (same meaning, the area:action naming of the new groups).
UPDATE "Role" SET "permissions" = array_replace("permissions", 'source:review', 'myloans:review');
UPDATE "Role" SET "permissions" = array_replace("permissions", 'source:manage', 'myloans:manage');
UPDATE "Role" SET "permissions" = array_replace("permissions", 'settings:branches', 'branches:manage');

-- 2. New ticks, given to the roles that could already do the thing.
-- "MyLoans · Last checked" on a loan file: everyone who sees loan files saw it.
UPDATE "Role" SET "permissions" = array_append("permissions", 'myloans:view')
  WHERE 'loans:view' = ANY("permissions") AND NOT ('myloans:view' = ANY("permissions"));
-- Refresh from MyLoans: shown to everyone who saw the loan file, except Finance and the Approvers
-- (as the business asked). LA, the Branch Supervisor and other custom roles, DP, Vault, DIG, QA keep it.
UPDATE "Role" SET "permissions" = array_append("permissions", 'loans:refresh')
  WHERE 'loans:view' = ANY("permissions") AND NOT ('loans:refresh' = ANY("permissions"))
    AND NOT ("builtIn" AND "key" IN ('FIN', 'APPR'));
-- Run the MyLoans sync now: was part of the sync settings tick.
UPDATE "Role" SET "permissions" = array_append("permissions", 'myloans:sync')
  WHERE 'myloans:manage' = ANY("permissions") AND NOT ('myloans:sync' = ANY("permissions"));
-- Branches: see the list (either old tick showed it); import and the Branch review were source:manage.
UPDATE "Role" SET "permissions" = array_append("permissions", 'branches:view')
  WHERE ('branches:manage' = ANY("permissions") OR 'myloans:manage' = ANY("permissions")) AND NOT ('branches:view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'branches:import')
  WHERE 'myloans:manage' = ANY("permissions") AND NOT ('branches:import' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'branches:review')
  WHERE 'myloans:manage' = ANY("permissions") AND NOT ('branches:review' = ANY("permissions"));
-- A person's branch access was part of editing users.
UPDATE "Role" SET "permissions" = array_append("permissions", 'access:manage')
  WHERE 'users:edit' = ANY("permissions") AND NOT ('access:manage' = ANY("permissions"));
-- The PN format was part of the system switches.
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings:pn_format')
  WHERE 'settings:system' = ANY("permissions") AND NOT ('settings:pn_format' = ANY("permissions"));
-- The TAT report download needed both the report and the loan export.
UPDATE "Role" SET "permissions" = array_append("permissions", 'reports:tat_export')
  WHERE 'reports:tat' = ANY("permissions") AND 'loans:export' = ANY("permissions") AND NOT ('reports:tat_export' = ANY("permissions"));
-- Seeing the email settings was part of changing them.
UPDATE "Role" SET "permissions" = array_append("permissions", 'email:view')
  WHERE 'email:manage' = ANY("permissions") AND NOT ('email:view' = ANY("permissions"));
-- LTO advisory notifications went to the Operations Monitor role by its key.
UPDATE "Role" SET "permissions" = array_append("permissions", 'ltoreports:notify')
  WHERE "builtIn" AND "key" = 'MONITOR' AND NOT ('ltoreports:notify' = ANY("permissions"));

-- 3. Admin was locked in code (every key except the loan-file work steps, whatever was stored). It is now
-- an ordinary role: store exactly what it could do, so its ticks are the truth from now on.
UPDATE "Role" SET "permissions" = ARRAY[
  'loans:view', 'loans:search', 'loans:export', 'rules:override', 'funds:view_all', 'problems:resolve_any',
  'problems:mark_outside_control', 'holds:transfer', 'journey:view_amounts', 'reports:tat', 'reports:tat_export',
  'monitor:dp', 'monitor:lto', 'ltoreports:create', 'ltoreports:manage', 'dpcapacity:manage', 'settings:loan_types',
  'settings:transaction_types', 'settings:document_types', 'settings:checklist', 'settings:tat', 'settings:holidays',
  'settings:cash_advance', 'settings:lto', 'settings:system', 'settings:pn_format', 'settings:problem_reasons',
  'holds:manage', 'settings:return_reasons', 'stages:manage', 'fundtypes:manage', 'settings:import', 'email:view',
  'email:manage', 'myloans:view', 'loans:refresh', 'myloans:review', 'myloans:manage', 'myloans:sync',
  'branches:view', 'branches:manage', 'branches:import', 'branches:review', 'users:view', 'users:edit',
  'access:manage', 'roles:manage', 'audit:view', 'simulator:use', 'testdata:reset'
]::text[], "branchAccess" = 'ALL'
  WHERE "builtIn" AND "key" = 'ADMIN';

-- Admin's people had All branches in code; store it on each person (nothing in code reads the role's name).
UPDATE "User" u SET "allBranches" = true
  FROM "Role" r WHERE u."roleId" = r."id" AND r."builtIn" AND r."key" = 'ADMIN' AND NOT u."allBranches";
DELETE FROM "user_branch_access" a USING "User" u WHERE a."userId" = u."id" AND u."allBranches";
