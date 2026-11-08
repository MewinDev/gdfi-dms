import "server-only";
import { notFound } from "next/navigation";
import { UserError } from "@/lib/services/errors";
import { kitRefusal } from "./guard";

/**
 * The Test kit screens (Settings > Test kit, the test sheet) and their server actions. Checked on the
 * server on every request and call, from the server's own environment: APP_ENV=local, TEST_MODE=true,
 * the sample MyLoans and the database gdfi_dms on this PC. On staging and production the card is not
 * listed, the pages are "not found" and the actions refuse, even for Admin and even when called directly.
 */
export const kitScreensAvailable = () => kitRefusal() === null;

/** Pages: not found unless the kit is available. */
export function kitPageOrNotFound(): void {
  if (!kitScreensAvailable()) notFound();
}

/** Server actions: a plain refusal unless the kit is available. */
export function assertKitAction(): void {
  const why = kitRefusal();
  if (why) throw new UserError(why);
}
