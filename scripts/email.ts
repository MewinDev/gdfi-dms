/**
 * Server console commands (scripts/server-only-stub.cjs lets the server modules load outside Next.js):
 *   npm run email:reminders            reminders, then the sender worker (same as the cron endpoint)
 *   npm run email:test -- name@gdfi.ph one test email (works while emails are Not active)
 * Reads .env and .env.local. Never prints a secret or a token.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { prisma } from "@/lib/db";
import { runEmailReminders } from "@/lib/email/reminders";
import { sendTestFromConsole } from "@/lib/email/outbox";
import { graphConfig } from "@/lib/email/graph";

async function main() {
  checkEnvOrExit();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "reminders") {
    console.log(JSON.stringify(await runEmailReminders()));
  } else if (cmd === "test") {
    if (!arg) throw new Error("Give the address: npm run email:test -- name@gdfi.ph");
    const c = graphConfig();
    console.log(c.configured ? `Sender: ${c.sender}` : "Email is not set up (GRAPH_* variables missing).");
    const r = await sendTestFromConsole(arg);
    console.log(r.ok ? r.message : `Not sent: ${r.message}`);
    process.exitCode = r.ok ? 0 : 1;
  } else {
    console.log("Use: email:reminders | email:test -- name@gdfi.ph");
    process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Failed.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
