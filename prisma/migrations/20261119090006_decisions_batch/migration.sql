-- Decisions batch (10 November 2026): "Print liquidation report" tick, the built-in Branch Supervisor
-- role, Finance no longer moves holds, and request numbers by type (CA- for Cash advance, FT- for Fund
-- transfer, each with its own running number per year).
-- Written by hand: `prisma migrate dev --create-only` could not replay the earlier migrations on its
-- shadow database (the loan search trigram indexes are made by hand in 20261116090000_myloans_load), and
-- Prisma's generated "drop index" lines for those indexes are left out on purpose.

-- 1. The numbers a request had before ("Formerly CA-2026-0008"); search finds them.
ALTER TABLE "CashAdvance" ADD COLUMN "formerNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 2. "Print liquidation report" (funds:print): every role that can see the Funds page and its reports
-- today (funds:view_all: Finance, Admin, custom approver roles) gets it, so nothing changes today.
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:print'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE 'funds:view_all' = ANY("permissions") AND NOT ('funds:print' = ANY("permissions"));

-- 3. Moving a hold to another person (holds:transfer): the built-in Finance role no longer has it. Admin
-- keeps it; custom roles that have it keep it.
UPDATE "Role" SET "permissions" = array_remove("permissions", 'holds:transfer'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE "builtIn" AND "key" = 'FIN' AND 'holds:transfer' = ANY("permissions");

-- 4. The built-in Branch Supervisor (also used for an area supervisor: the same role with Area access on
-- the person). Created only when no role of that name exists (a role made by hand, such as the Manual
-- Test Kit's, is kept as it is) and no role has the key yet. Same ticks as ROLE_DEFAULTS.SUP.
INSERT INTO "Role" ("id", "key", "name", "description", "permissions", "canSignIn", "sortOrder", "builtIn", "branchAccess", "active", "createdAt", "updatedAt")
SELECT 'role_sup', 'SUP', 'Branch Supervisor',
  'Sees the loans of their branches, moves holds to another person, resolves any problem there, the Monitoring pages and the TAT report. No money, Settings, users or roles.',
  ARRAY['loans:view', 'loans:search', 'problems:resolve_any', 'holds:transfer', 'reports:tat', 'monitor:dp', 'monitor:lto', 'myloans:view', 'loans:refresh']::text[],
  true, 10, true, 'ASSIGNED', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE lower("name") = 'branch supervisor' OR "key" = 'SUP');

-- 5. Request numbers follow the type. A request whose number does not start with its type's code (a
-- Fund transfer numbered CA-2026-0010) gets the next number of its own prefix and year, in order of
-- creation. Every stored copy of the old number that is not a reference by id is changed with it:
-- notification titles, bodies and links, audit summaries and their before/after/details, the email
-- outbox (not yet sent), request notes and release references, line notes, exception reasons. The old
-- number is kept in "formerNumbers" and a history row says "formerly ...".
-- Only rows written since the request was made are changed: "Reset test data" deletes requests but keeps
-- audit rows, notifications and emails, so an older row with the same number is about another request
-- that no longer exists and is left as it is.
-- Safety: a request whose old number is in an email that was already SENT, or still sits in any other
-- column after the update, is NOT renumbered (its changes are undone) and is listed with the reason.
-- Re-runnable without harm (SELECT * FROM dms_renumber_advances()): a renumbered request already starts
-- with its code, so a second run finds nothing to do.
CREATE OR REPLACE FUNCTION dms_renumber_advances()
RETURNS TABLE (old_number text, new_number text, outcome text, reason text)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
  a record;
  c record;
  prefix text;
  yr text;
  nxt int;
  newn text;
  pat text;
  leftover bigint;
  since timestamp;
  timecol text;
BEGIN
  FOR a IN
    SELECT ca."id", ca."number", ca."fundsTypeCode", ca."fundsTypeName"
    FROM "CashAdvance" ca
    WHERE ca."number" ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
      AND split_part(ca."number", '-', 1) <> upper(regexp_replace(ca."fundsTypeCode", '[^A-Za-z0-9]', '', 'g'))
    ORDER BY ca."createdAt", ca."number"
  LOOP
    old_number := a."number";
    new_number := NULL;
    prefix := upper(regexp_replace(a."fundsTypeCode", '[^A-Za-z0-9]', '', 'g'));
    yr := split_part(a."number", '-', 2);
    pat := '\y' || a."number" || '\y';
    since := (SELECT x."createdAt" FROM "CashAdvance" x WHERE x."id" = a."id") - interval '1 minute';
    IF prefix = '' THEN
      outcome := 'skipped'; reason := 'The funds type has no usable code.'; RETURN NEXT; CONTINUE;
    END IF;
    -- An email that already went out carries the old number: it cannot be changed.
    IF EXISTS (SELECT 1 FROM "EmailOutbox" e WHERE e."status" = 'SENT' AND e."createdAt" >= since
               AND (e."subject" ~ pat OR e."headline" ~ pat OR e."text" ~ pat OR e."html" ~ pat OR coalesce(e."link", '') ~ pat)) THEN
      outcome := 'skipped'; reason := 'An email with this number was already sent; it cannot be changed.'; RETURN NEXT; CONTINUE;
    END IF;
    SELECT coalesce(max(substring(s.n FROM '^' || prefix || '-' || yr || '-([0-9]+)$')::int), 0) + 1 INTO nxt
      FROM (SELECT x."number" AS n FROM "CashAdvance" x UNION ALL SELECT unnest(x."formerNumbers") FROM "CashAdvance" x) s;
    newn := prefix || '-' || yr || '-' || lpad(nxt::text, 4, '0');
    BEGIN
      UPDATE "CashAdvance" SET "number" = newn, "formerNumbers" = array_append("formerNumbers", a."number"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = a."id";
      UPDATE "CashAdvance" SET "note" = regexp_replace("note", pat, newn, 'g') WHERE "note" ~ pat;
      UPDATE "CashAdvance" SET "releaseRef" = regexp_replace("releaseRef", pat, newn, 'g') WHERE "releaseRef" ~ pat;
      UPDATE "CashAdvanceTopUp" SET "releaseRef" = regexp_replace("releaseRef", pat, newn, 'g') WHERE "releaseRef" ~ pat;
      UPDATE "CashAdvanceLine" SET "note" = regexp_replace("note", pat, newn, 'g') WHERE "note" ~ pat;
      UPDATE "LoanException" SET "reason" = regexp_replace("reason", pat, newn, 'g') WHERE "reason" ~ pat AND "raisedAt" >= since;
      UPDATE "Notification" SET
          "title" = regexp_replace("title", pat, newn, 'g'),
          "body" = regexp_replace("body", pat, newn, 'g'),
          "link" = CASE WHEN "link" IS NULL THEN NULL ELSE regexp_replace("link", pat, newn, 'g') END
        WHERE "createdAt" >= since AND ("title" ~ pat OR "body" ~ pat OR coalesce("link", '') ~ pat);
      UPDATE "AuditLog" SET
          "summary" = regexp_replace("summary", pat, newn, 'g'),
          "before" = CASE WHEN "before"::text ~ pat THEN regexp_replace("before"::text, pat, newn, 'g')::jsonb ELSE "before" END,
          "after" = CASE WHEN "after"::text ~ pat THEN regexp_replace("after"::text, pat, newn, 'g')::jsonb ELSE "after" END,
          "details" = CASE WHEN "details"::text ~ pat THEN regexp_replace("details"::text, pat, newn, 'g')::jsonb ELSE "details" END
        WHERE "at" >= since AND ("summary" ~ pat OR "before"::text ~ pat OR "after"::text ~ pat OR "details"::text ~ pat);
      UPDATE "EmailOutbox" SET
          "subject" = regexp_replace("subject", pat, newn, 'g'),
          "headline" = regexp_replace("headline", pat, newn, 'g'),
          "text" = regexp_replace("text", pat, newn, 'g'),
          "html" = regexp_replace("html", pat, newn, 'g'),
          "link" = CASE WHEN "link" IS NULL THEN NULL ELSE regexp_replace("link", pat, newn, 'g') END
        WHERE "status" <> 'SENT' AND "createdAt" >= since AND ("subject" ~ pat OR "headline" ~ pat OR "text" ~ pat OR "html" ~ pat OR coalesce("link", '') ~ pat);
      -- Nothing may still point at the old number (only formerNumbers keeps it): otherwise undo.
      FOR c IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
          AND table_name <> '_prisma_migrations'
      LOOP
        IF c.table_name = 'CashAdvance' AND c.column_name = 'formerNumbers' THEN CONTINUE; END IF;
        -- Rows older than the request in the history tables are about another request (see above).
        timecol := CASE c.table_name WHEN 'AuditLog' THEN 'at' WHEN 'Notification' THEN 'createdAt' WHEN 'EmailOutbox' THEN 'createdAt' WHEN 'LoanException' THEN 'raisedAt' ELSE NULL END;
        IF timecol IS NULL THEN
          EXECUTE format('SELECT count(*) FROM %I WHERE %I::text ~ %L', c.table_name, c.column_name, pat) INTO leftover;
        ELSE
          EXECUTE format('SELECT count(*) FROM %I WHERE %I::text ~ %L AND %I >= %L', c.table_name, c.column_name, pat, timecol, since) INTO leftover;
        END IF;
        IF leftover > 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format('The old number is also stored in %s.%s (%s row(s)), which is not changed automatically.', c.table_name, c.column_name, leftover);
        END IF;
      END LOOP;
      INSERT INTO "AuditLog" ("id", "at", "actorLabel", "mode", "action", "entityType", "entityId", "summary", "details")
      VALUES ('renum_' || md5(a."id" || newn), CURRENT_TIMESTAMP, 'System', 'AUTOMATIC', 'advance_renumbered', 'CashAdvance', a."id",
        newn || ': numbered as a ' || a."fundsTypeName" || ' (formerly ' || a."number" || ')',
        jsonb_build_object('formerNumber', a."number", 'number', newn));
      new_number := newn; outcome := 'renumbered'; reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      new_number := NULL; outcome := 'skipped'; reason := SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END
$fn$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM dms_renumber_advances() LOOP
    RAISE NOTICE 'Request %: % %', r.old_number, r.outcome, coalesce('as ' || r.new_number, '(' || r.reason || ')');
  END LOOP;
END $$;
