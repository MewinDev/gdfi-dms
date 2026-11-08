/**
 * Runs before a destructive npm script (npm run db:reset). Exits with the reason when the database is
 * not a "test" database and ALLOW_DESTRUCTIVE=1 is not set, or when APP_ENV is staging or production.
 * Usage: tsx scripts/guard-destructive.ts "what is about to run"
 */
import { destructiveRefusal } from "../lib/env/destructive";
import { databaseUrlMismatch } from "../lib/env/load-files";

const what = process.argv[2] ?? "This command";
const why = databaseUrlMismatch() ?? destructiveRefusal(what);
if (why) {
  console.error(`Refused: ${why}`);
  process.exit(1);
}
