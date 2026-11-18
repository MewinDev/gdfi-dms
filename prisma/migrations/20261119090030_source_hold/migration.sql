-- D-053: a loan myloans no longer shows as released (NotReleased or Inactive), approved by an approver: on hold
-- (blocked, not closed) until myloans shows it Released again.
ALTER TABLE "Loan" ADD COLUMN     "sourceHold" TEXT,
ADD COLUMN     "sourceHoldSince" TIMESTAMP(3);
