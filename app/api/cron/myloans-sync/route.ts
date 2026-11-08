import { NextResponse, type NextRequest } from "next/server";
import { cronAllowed } from "@/lib/email/cron-auth";
import { runMyLoansSync } from "@/lib/services/source-sync";

/**
 * Background MyLoans refresh, called by a scheduler (for example every 15 minutes; the run itself
 * keeps to Settings: every N minutes, business hours, a cap per run). Needs the CRON_SECRET header.
 */
export async function POST(req: NextRequest) {
  if (!cronAllowed(req.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runMyLoansSync({ trigger: "cron" })) });
  } catch {
    return NextResponse.json({ ok: false, error: "The MyLoans sync could not run. Try again later." }, { status: 500 });
  }
}
