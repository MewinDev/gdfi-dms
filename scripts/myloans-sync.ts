/**
 * npm run myloans:sync: one background MyLoans refresh now (same as the cron endpoint, without the
 * every-N-minutes and business-hours checks). Never prints the MyLoans address or key.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { prisma } from "@/lib/db";
import { runMyLoansSync } from "@/lib/services/source-sync";

checkEnvOrExit();
runMyLoansSync({ trigger: "script", force: true })
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
