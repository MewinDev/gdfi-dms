-- Piece 8 (D-004, D-010 to D-013, D-053): Open Items per field replace the per-loan review item (SourceChange).

-- CreateEnum
CREATE TYPE "OpenItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'REVERTED');

-- CreateTable
CREATE TABLE "OpenItem" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "groupKey" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'LOAN',
    "oldValue" TEXT,
    "newValue" TEXT,
    "oldRaw" JSONB,
    "newRaw" JSONB,
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncRunId" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OpenItemStatus" NOT NULL DEFAULT 'PENDING',
    "supersededById" TEXT,
    "decidedById" TEXT,
    "decidedByLabel" TEXT,
    "decidedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OpenItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenItemCounter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OpenItemCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "ReferenceChange" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "loanCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReferenceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenItem_number_key" ON "OpenItem"("number");
CREATE INDEX "OpenItem_status_raisedAt_idx" ON "OpenItem"("status", "raisedAt");
CREATE INDEX "OpenItem_loanId_status_idx" ON "OpenItem"("loanId", "status");
CREATE INDEX "OpenItem_branchId_status_idx" ON "OpenItem"("branchId", "status");
CREATE INDEX "ReferenceChange_at_idx" ON "ReferenceChange"("at");

-- AddForeignKey
ALTER TABLE "OpenItem" ADD CONSTRAINT "OpenItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma cannot express it; never drop it): one PENDING Open Item per loan and field.
CREATE UNIQUE INDEX "OpenItem_one_pending_per_field" ON "OpenItem"("loanId", "field") WHERE "status" = 'PENDING';

-- The development review items move to Open Items: one per changed field of each open item (the status fields
-- become one "status" item; area, division, company and vehicle details are lookup data and are dropped, D-053).
WITH elems AS (
  SELECT sc."id" AS sc_id, sc."loanId", l."branchId", sc."firstSeenAt", sc."simulated", e.ord,
         e.value->>'field' AS f, e.value->'was' AS was, e.value->'now' AS now
  FROM "SourceChange" sc
  JOIN "Loan" l ON l."id" = sc."loanId"
  CROSS JOIN LATERAL jsonb_array_elements(sc."changes"::jsonb) WITH ORDINALITY AS e(value, ord)
  WHERE sc."state" = 'OPEN'
), mapped AS (
  SELECT *,
    CASE
      WHEN f IN ('status', 'statusId', 'statusName', 'isActive', 'previousPn') THEN 'status'
      WHEN f IN ('productName', 'productCode') THEN 'productCode'
      WHEN f IN ('branchName', 'branchCode') THEN 'branchCode'
      WHEN f IN ('borrowerName', 'cif', 'cin', 'loanType', 'amount', 'releaseDate', 'sourceLoanId') THEN f
      ELSE NULL
    END AS field
  FROM elems
), one AS (
  SELECT DISTINCT ON ("loanId", field) * FROM mapped WHERE field IS NOT NULL ORDER BY "loanId", field, "firstSeenAt" DESC, ord
), numbered AS (
  SELECT one.*, EXTRACT(YEAR FROM ("firstSeenAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila'))::int AS yr,
         row_number() OVER (PARTITION BY EXTRACT(YEAR FROM ("firstSeenAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')) ORDER BY "firstSeenAt", sc_id, ord) AS n
  FROM one
)
INSERT INTO "OpenItem" ("id", "number", "loanId", "branchId", "field", "fieldLabel", "groupKey", "audience", "oldValue", "newValue", "oldRaw", "newRaw", "raisedAt", "status", "simulated")
SELECT 'oim' || substr(md5(sc_id || field), 1, 22), 'OI-' || yr || '-' || lpad(n::text, 6, '0'), "loanId", "branchId", field,
  CASE field WHEN 'status' THEN 'Status in myloans' WHEN 'productCode' THEN 'Product' WHEN 'branchCode' THEN 'Branch' WHEN 'borrowerName' THEN 'Borrower name'
    WHEN 'cif' THEN 'CIF' WHEN 'cin' THEN 'CIN' WHEN 'loanType' THEN 'Loan type' WHEN 'amount' THEN 'Amount' WHEN 'releaseDate' THEN 'Release date' ELSE 'Source loan ID' END,
  CASE WHEN field IN ('loanType', 'amount', 'productCode', 'releaseDate') THEN 'rules' ELSE NULL END,
  CASE WHEN field IN ('borrowerName', 'cif', 'cin') THEN 'BORROWER' ELSE 'LOAN' END,
  was #>> '{}', now #>> '{}', was, now, "firstSeenAt", 'PENDING', "simulated"
FROM numbered;

INSERT INTO "OpenItemCounter" ("year", "last")
SELECT EXTRACT(YEAR FROM ("raisedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila'))::int, COUNT(*) FROM "OpenItem" GROUP BY 1;

-- DropForeignKey
ALTER TABLE "SourceChange" DROP CONSTRAINT "SourceChange_loanId_fkey";

-- DropTable
DROP TABLE "SourceChange";

-- DropEnum
DROP TYPE "SourceChangeCategory";
DROP TYPE "SourceChangeState";
