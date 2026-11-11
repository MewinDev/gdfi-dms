-- MyLoans calls counted in one place for every server instance, the cron endpoint and the console script,
-- and the circuit breaker shared the same way. Also: the tick source:review_borrower is renamed
-- myloans:review_borrower, like the other MyLoans keys (the same method as 20261119090004_permissions_pass).

-- CreateTable
CREATE TABLE "MyLoansCallHour" (
    "hour" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyLoansCallHour_pkey" PRIMARY KEY ("hour")
);

-- CreateTable
CREATE TABLE "MyLoansBreaker" (
    "id" TEXT NOT NULL DEFAULT 'myloans',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "openUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyLoansBreaker_pkey" PRIMARY KEY ("id")
);

-- Rename the tick on every role that holds it (no role keeps the old key; a role holding both keeps one).
UPDATE "Role" SET "permissions" = array_replace("permissions", 'source:review_borrower', 'myloans:review_borrower'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE 'source:review_borrower' = ANY("permissions") AND NOT ('myloans:review_borrower' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_remove("permissions", 'source:review_borrower'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE 'source:review_borrower' = ANY("permissions");
