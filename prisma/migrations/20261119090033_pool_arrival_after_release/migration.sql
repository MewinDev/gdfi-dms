-- D-060 (26 November 2026): a released loan cannot enter the branch pool before it was released.
-- A pool item (WorkItem kind LOAN_CANDIDATE) never has an arrival earlier than the loan's release date in the
-- myloans copy (SourceLoanCandidate, the latest seen for that PN); if it would, the release date is used.
-- The app does the same (lib/work/rules.ts poolArrival); these triggers keep it true for any writer.
-- Prisma does not model triggers or functions: never drop them in a later migration.

CREATE OR REPLACE FUNCTION dms_pool_arrival_after_release() RETURNS trigger AS $$
DECLARE
  rel TIMESTAMP(3);
BEGIN
  IF NEW."kind" = 'LOAN_CANDIDATE' THEN
    SELECT c."releaseDate" INTO rel FROM "SourceLoanCandidate" c WHERE c."pn" = NEW."subjectId" ORDER BY c."lastSeenAt" DESC LIMIT 1;
    IF rel IS NOT NULL AND NEW."arrivedAt" < rel THEN
      NEW."arrivedAt" := rel;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkItem_pool_arrival_after_release"
  BEFORE INSERT OR UPDATE OF "arrivedAt", "kind", "subjectId" ON "WorkItem"
  FOR EACH ROW EXECUTE FUNCTION dms_pool_arrival_after_release();

-- The release date in the myloans copy changed (or arrived after the pool item): move that PN's pool items up.
CREATE OR REPLACE FUNCTION dms_pool_arrival_follows_release() RETURNS trigger AS $$
BEGIN
  UPDATE "WorkItem" SET "arrivedAt" = NEW."releaseDate"
   WHERE "kind" = 'LOAN_CANDIDATE' AND "subjectId" = NEW."pn" AND "arrivedAt" < NEW."releaseDate";
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SourceLoanCandidate_pool_arrival_follows_release"
  AFTER INSERT OR UPDATE OF "releaseDate", "pn" ON "SourceLoanCandidate"
  FOR EACH ROW EXECUTE FUNCTION dms_pool_arrival_follows_release();

-- Rows written before this rule (the kit's demo moved arrivals back without looking at the release date).
UPDATE "WorkItem" w SET "arrivedAt" = c."releaseDate"
  FROM (SELECT DISTINCT ON ("pn") "pn", "releaseDate" FROM "SourceLoanCandidate" ORDER BY "pn", "lastSeenAt" DESC) c
 WHERE w."kind" = 'LOAN_CANDIDATE' AND w."subjectId" = c."pn" AND w."arrivedAt" < c."releaseDate";
