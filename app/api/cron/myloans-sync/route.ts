import { NextResponse, type NextRequest } from "next/server";
import { cronAllowed } from "@/lib/email/cron-auth";
import { runMyLoansSync } from "@/lib/services/source-sync";
import { runScheduledBranchSync } from "@/lib/services/branches";

/**
 * Background MyLoans refresh, called by a scheduler (for example every 15 minutes; the run itself
 * keeps to Settings: every N minutes, business hours, a cap per run). Needs the CRON_SECRET header.
 * The same call runs the branch list from MyLoans once a day at its set time (Settings, Branches);
 * that part never makes the loan sync fail.
 */
export async function POST(req: NextRequest) {
  if (!cronAllowed(req.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  let branches: unknown;
  try {
    const loans = await runMyLoansSync({ trigger: "cron" });
    branches = await runScheduledBranchSync().catch(() => ({ skipped: "the branch run failed; nothing was changed" }));
    return NextResponse.json({ ok: true, ...loans, branches });
  } catch {
    branches ??= await runScheduledBranchSync().catch(() => ({ skipped: "the branch run failed; nothing was changed" }));
    return NextResponse.json({ ok: false, error: "The MyLoans sync could not run. Try again later.", branches }, { status: 500 });
  }
}
