-- D-051: the borrower's address and contact number are removed completely (data minimization, RA 10173; as the
-- birth date, D-037). The columns go, and so do the values kept inside the saved myloans copies and the review items.
-- The audit log is append-only and is not rewritten.

-- AlterTable
ALTER TABLE "Loan" DROP COLUMN "borrowerAddress",
DROP COLUMN "borrowerContactNo";

-- Saved myloans copies: the record ({ loan: ... } or the old flat shape), the tracked fields and the changes.
UPDATE "LoanSourceSnapshot"
SET "payload" = ("payload"::jsonb #- '{loan,address}' #- '{loan,contactNo}') - 'address' - 'contactNo'
WHERE "payload"::text LIKE '%"address"%' OR "payload"::text LIKE '%"contactNo"%';

UPDATE "LoanSourceSnapshot"
SET "tracked" = "tracked"::jsonb - 'address' - 'contactNo'
WHERE "tracked" IS NOT NULL AND ("tracked"::text LIKE '%"address"%' OR "tracked"::text LIKE '%"contactNo"%');

UPDATE "LoanSourceSnapshot"
SET "changes" = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements("changes"::jsonb) e WHERE e ->> 'field' NOT IN ('address', 'contactNo'))
WHERE "changes" IS NOT NULL AND jsonb_typeof("changes"::jsonb) = 'array' AND ("changes"::text LIKE '%"address"%' OR "changes"::text LIKE '%"contactNo"%');

-- Review items: the changes, and each earlier detection kept in history.
UPDATE "SourceChange"
SET "changes" = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements("changes"::jsonb) e WHERE e ->> 'field' NOT IN ('address', 'contactNo'))
WHERE jsonb_typeof("changes"::jsonb) = 'array' AND ("changes"::text LIKE '%"address"%' OR "changes"::text LIKE '%"contactNo"%');

UPDATE "SourceChange"
SET "history" = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(h -> 'changes') = 'array'
      THEN jsonb_set(h, '{changes}', (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM jsonb_array_elements(h -> 'changes') c WHERE c ->> 'field' NOT IN ('address', 'contactNo')))
      ELSE h END), '[]'::jsonb)
  FROM jsonb_array_elements("history"::jsonb) h)
WHERE jsonb_typeof("history"::jsonb) = 'array' AND ("history"::text LIKE '%"address"%' OR "history"::text LIKE '%"contactNo"%');
