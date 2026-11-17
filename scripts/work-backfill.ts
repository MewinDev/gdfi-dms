/**
 * npm run work:backfill (D-046 item 7): existing open work becomes inbox items from the recorded times. Items with a
 * missing time are marked "Migrated" (left out of TAT performance reports). Safe to run again.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { prisma } from "@/lib/db";
import { backfillWorkItems } from "@/lib/work/backfill";

checkEnvOrExit();
backfillWorkItems(prisma)
  .then((c) => console.log(`Inbox items made: ${c.made} (${c.migrated} marked Migrated). Already there: ${c.skipped}.`))
  .catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
