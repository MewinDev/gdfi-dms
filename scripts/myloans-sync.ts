/**
 * npm run sync:myloans: the myloans sync for any scheduler (docs/SCHEDULER.md). Never prints the address or key.
 *   (no flag)     what is due: the daily catch-up at its time, else a change run when the interval passed
 *   --now         a change run now (since the checkpoint), whatever the interval
 *   --catchup     the catch-up now (the last N hours; never moves the checkpoint back)
 *   --first-load  pool mode: released loans from the branch-pool cutoff
 * Exit code 0: ran or nothing was due; 1: the run failed (the checkpoint was kept); 2: another run holds the lock.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { prisma } from "@/lib/db";
import { runMyLoansSync, runScheduled } from "@/lib/services/myloans-sync";

checkEnvOrExit();
const has = (f: string) => process.argv.includes(f);
const run = has("--first-load") ? runMyLoansSync({ mode: "FIRST_LOAD", trigger: "script" })
  : has("--catchup") ? runMyLoansSync({ mode: "CATCHUP", trigger: "script" })
  : has("--now") ? runMyLoansSync({ mode: "CHANGE", trigger: "script" })
  : runScheduled("script");
run
  .then((r) => {
    console.log(JSON.stringify(r));
    if (r.ok === false) process.exitCode = 1;
    else if (r.skipped === "Another MyLoans sync is running.") process.exitCode = 2;
  })
  .catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
