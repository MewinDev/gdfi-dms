-- Hold: a copy of the reason name when the hold started (reports stay right after a rename).
ALTER TABLE "Hold" ADD COLUMN "reasonName" TEXT NOT NULL DEFAULT '';
UPDATE "Hold" h SET "reasonName" = r."name" FROM "HoldReason" r WHERE r."id" = h."reasonId" AND h."reasonName" = '';

-- Hold reasons: seeded defaults are "Proposed, to be confirmed with the team" until Admin saves them.
ALTER TABLE "HoldReason" ADD COLUMN "proposed" BOOLEAN NOT NULL DEFAULT false;

-- The hold reasons list now has its own switch: settings:hold_reasons becomes holds:manage.
UPDATE "Role" SET "permissions" = array_replace("permissions", 'settings:hold_reasons', 'holds:manage') WHERE 'settings:hold_reasons' = ANY("permissions");

-- The proposed hold reasons ("Proposed, to be confirmed with the team"). Existing rows are kept.
INSERT INTO "HoldReason" ("id", "code", "name", "sortOrder", "active", "proposed", "createdAt", "updatedAt") VALUES
  ('hr_' || md5('NO-DP'), 'NO-DP', 'No available DP', 1, true, true, now(), now()),
  ('hr_' || md5('CLIENT-PAPERS'), 'CLIENT-PAPERS', 'Waiting for the client''s papers', 2, true, true, now(), now()),
  ('hr_' || md5('CLIENT-DECISION'), 'CLIENT-DECISION', 'Waiting for the client''s decision', 3, true, true, now(), now()),
  ('hr_' || md5('BRANCH-HEAD'), 'BRANCH-HEAD', 'Waiting for the branch head''s approval', 4, true, true, now(), now()),
  ('hr_' || md5('FUNDS'), 'FUNDS', 'Waiting for funds or payment', 5, true, true, now(), now()),
  ('hr_' || md5('CLIENT-CORRECTIONS'), 'CLIENT-CORRECTIONS', 'Waiting for corrections from the client', 6, true, true, now(), now()),
  ('hr_' || md5('MYLOANS-UPDATE'), 'MYLOANS-UPDATE', 'Waiting for a MyLoans update', 7, true, true, now(), now())
ON CONFLICT ("code") DO NOTHING;
UPDATE "HoldReason" SET "sortOrder" = 8, "proposed" = true, "name" = 'Other' WHERE "code" = 'OTHER';

-- The testing reasons are switched off (they stay on the holds that used them).
UPDATE "HoldReason" SET "active" = false, "deactivatedAt" = now() WHERE "code" IN ('BORROWER', 'OTHER-TEAM', 'LTO-SCHEDULE') AND "active" = true;
