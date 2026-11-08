import { NextResponse, type NextRequest } from "next/server";
import { cronAllowed } from "@/lib/email/cron-auth";
import { runEmailReminders } from "@/lib/email/reminders";

/**
 * Called by a scheduler (for example every 15 minutes on business days, and once in the morning for
 * the digest). Needs the CRON_SECRET header. Sends nothing while emails are Not active.
 */
export async function POST(req: NextRequest) {
  if (!cronAllowed(req.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runEmailReminders()) });
  } catch {
    return NextResponse.json({ ok: false, error: "The reminders could not run. Try again later." }, { status: 500 });
  }
}
