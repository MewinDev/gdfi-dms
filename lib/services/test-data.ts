import { refuseInProduction } from "@/lib/env";
import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isTestMode } from "@/lib/test-mode";
import { resetLoanData, type ResetCounts } from "@/lib/test-data/reset-core";
import { UserError } from "./errors";

/**
 * Reset test data (Admin, TEST_MODE only). Removes every Loan File and its dependent rows in one
 * transaction and writes one audit row "Test data reset" with the counts removed.
 */
export async function resetTestData(user: CurrentUser): Promise<ResetCounts> {
  refuseInProduction("Reset test data");
  if (!isTestMode()) throw new UserError("Reset test data is only available in test mode.");
  if (!can(user, PERMISSIONS.TESTDATA_RESET)) throw new UserError("Your role does not allow resetting test data.");
  return prisma.$transaction(
    async (tx) => {
      const counts = await resetLoanData(tx);
      await writeAudit(tx, {
        actor: { id: user.id, label: user.name },
        mode: "MANUAL",
        action: "test_data_reset",
        entityType: "TestData",
        summary: `Test data reset: removed ${counts.loanFiles} loan file(s) and their records`,
        details: counts,
      });
      return counts;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
