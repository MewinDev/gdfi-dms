-- D-056: Phase A go-live gaps.

-- The processor's receiving account at request (cleared at release) and the receipt confirmation.
ALTER TABLE "CashAdvance" ADD COLUMN     "accountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "receiptConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "receiptConfirmedById" TEXT,
ADD COLUMN     "receiptMismatchAt" TIMESTAMP(3),
ADD COLUMN     "receiptMismatchNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "receiptResolveNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "receiptResolvedAt" TIMESTAMP(3),
ADD COLUMN     "receiptResolvedById" TEXT;

-- The new tick "Cancel transaction": on by default for the LA Supervisor/Head and Admin.
UPDATE "Role" SET "permissions" = array_append("permissions", 'transactions:cancel')
WHERE "key" IN ('SUP', 'ADMIN') AND NOT ('transactions:cancel' = ANY("permissions"));

-- TAT working defaults (D-056 item 9): LA 1, DP 5, Finance 1. Only rows still at the earlier seeded value change,
-- so a value an Admin set in Settings is kept.
UPDATE "TatRule" SET "businessDays" = 1 WHERE "key" = 'P3_CHECKLIST' AND "businessDays" = 2;
UPDATE "TatRule" SET "businessDays" = 1 WHERE "key" = 'P3_ASSIGN' AND "businessDays" = 2;
UPDATE "TatRule" SET "businessDays" = 5 WHERE "key" = 'P4_NOTARY' AND "businessDays" = 3;
UPDATE "TatRule" SET "businessDays" = 5 WHERE "key" = 'P4_MORTGAGE' AND "businessDays" = 10;
-- Their old notes ("Day 2 from release") are shown instead of the number; they no longer fit.
UPDATE "TatRule" SET "note" = '' WHERE "key" IN ('P3_CHECKLIST', 'P3_ASSIGN') AND "note" = 'Day 2 from release';
