-- Expense kinds become a setting (Settings > Expense kinds). The old enum values stay as the codes of
-- normal kinds (Notary fee, PPSR fee, LTO fee, Transport) and of the built-in Other, so every existing
-- rule, request line and funds flag keeps pointing at the same kind: the columns change type in place
-- (enum -> text, USING the old value), nothing is dropped and recreated. Prisma's generated "drop index"
-- lines for the loan search (trigram) indexes were removed: those indexes are made by hand in
-- 20261116090000_myloans_load. Prisma's generated "drop column / add column" lines were replaced by the
-- in-place type changes below (they would have lost the data).

-- 1. The amount mode of a kind.
CREATE TYPE "ExpenseAmountMode" AS ENUM ('TYPED', 'SUGGESTED', 'FIXED');

-- 2. Rules, request lines and funds flags keep their value, now as the kind's code (first, so the
-- old enum type is gone before the table of the same name is made).
ALTER TABLE "CashAdvanceRule" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "CashAdvanceRule" ALTER COLUMN "kind" TYPE TEXT USING "kind"::text;
ALTER TABLE "CashAdvanceRule" ALTER COLUMN "kind" SET DEFAULT 'OTHER';
ALTER TABLE "CashAdvanceLine" ALTER COLUMN "kind" TYPE TEXT USING "kind"::text;
ALTER TABLE "LoanTransaction" ALTER COLUMN "fundsKinds" TYPE TEXT[] USING "fundsKinds"::text[];
DROP TYPE "ExpenseKind";

-- 3. The kinds table, with the five kinds that existed. All start as "Person enters it" (TYPED), so
-- nothing changes for new requests until someone sets an amount.
CREATE TABLE "ExpenseKind" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "amountMode" "ExpenseAmountMode" NOT NULL DEFAULT 'TYPED',
    "amountCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseKind_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpenseKind_code_key" ON "ExpenseKind"("code");
CREATE UNIQUE INDEX "ExpenseKind_nameKey_key" ON "ExpenseKind"("nameKey");

INSERT INTO "ExpenseKind" ("id", "code", "name", "nameKey", "builtIn", "sortOrder", "updatedAt") VALUES
  ('xk_notary_fee', 'NOTARY_FEE', 'Notary fee', 'notaryfee', false, 1, CURRENT_TIMESTAMP),
  ('xk_ppsr_fee',   'PPSR_FEE',   'PPSR fee',   'ppsrfee',   false, 2, CURRENT_TIMESTAMP),
  ('xk_lto_fee',    'LTO_FEE',    'LTO fee',    'ltofee',    false, 3, CURRENT_TIMESTAMP),
  ('xk_transport',  'TRANSPORT',  'Transport',  'transport', false, 4, CURRENT_TIMESTAMP),
  ('xk_other',      'OTHER',      'Other',      'other',     true,  999, CURRENT_TIMESTAMP);

-- 4. New on each line: the Other description, where the amount came from, the starting value and
-- whether the kind's amount was fixed. Old lines: typed by the person, not locked, no description
-- (an old Other line shows "Other (not described)"; nothing blocks old data).
ALTER TABLE "CashAdvanceLine" ADD COLUMN "otherDescription" TEXT NOT NULL DEFAULT '',
ADD COLUMN "amountSource" TEXT NOT NULL DEFAULT 'TYPED',
ADD COLUMN "presetCents" INTEGER,
ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- 5. Rules and lines point at a kind (a kind is never deleted; a code change follows).
ALTER TABLE "CashAdvanceRule" ADD CONSTRAINT "CashAdvanceRule_kind_fkey" FOREIGN KEY ("kind") REFERENCES "ExpenseKind"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashAdvanceLine" ADD CONSTRAINT "CashAdvanceLine_kind_fkey" FOREIGN KEY ("kind") REFERENCES "ExpenseKind"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. New ticks (lib/auth/permissions.ts, group Funds). Nobody loses anything.
-- "Add and manage expense kinds": Admin, Finance and the Approver role, and any other role that
-- approves cash advances.
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:kinds_manage')
  WHERE (("builtIn" AND "key" IN ('ADMIN', 'FIN', 'APPR')) OR 'funds:approve' = ANY("permissions"))
    AND NOT ('funds:kinds_manage' = ANY("permissions"));
-- "See expense kinds": every role that can see funds (and every role that manages kinds).
UPDATE "Role" SET "permissions" = array_append("permissions", 'funds:kinds_view')
  WHERE ("permissions" && ARRAY['funds:view', 'funds:view_all', 'funds:request', 'funds:approve', 'funds:release', 'funds:kinds_manage']::text[])
    AND NOT ('funds:kinds_view' = ANY("permissions"));
