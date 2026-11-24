import { NextResponse, type NextRequest } from "next/server";
import { cronAllowed } from "@/lib/email/cron-auth";
import { runScheduled } from "@/lib/services/myloans-sync";
import { runScheduledBranchSync } from "@/lib/services/branches";

/**
 * The myloans sync for a scheduler (docs/SCHEDULER.md): call it every few minutes with the CRON_SECRET header. Each
 * call runs the daily catch-up when it is due, else a change run when the interval (Settings, MyLoans sync) passed,
 * else nothing. Runs never overlap. The same call runs the branch list once a day at its set time (Settings,
 * Branches); that part never makes the loan sync fail.
 */
export async function POST(req: NextRequest) {
  if (!cronAllowed(req.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  let branches: unknown;
  try {
    const loans = await runScheduled("schedule");
    branches = await runScheduledBranchSync().catch(() => ({ skipped: "the branch run failed; nothing was changed" }));
    return NextResponse.json({ ok: loans.ok !== false, ...loans, branches }, { status: loans.ok === false ? 502 : 200 });
  } catch {
    branches ??= await runScheduledBranchSync().catch(() => ({ skipped: "the branch run failed; nothing was changed" }));
    return NextResponse.json({ ok: false, error: "The MyLoans sync could not run. Try again later.", branches }, { status: 500 });
  }
}
