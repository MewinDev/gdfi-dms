import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listOutbox } from "@/lib/email/outbox";
import { EMAIL_EVENTS, type EmailEventKey } from "@/lib/email/templates";
import { fmtDateTime } from "@/lib/time";

/** Recent emails as CSV: needs Manage email notifications and Import data (export). No message bodies. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, PERMISSIONS.EMAIL_VIEW) || !can(user, PERMISSIONS.SETTINGS_IMPORT)) return NextResponse.json({ error: "You do not have permission to export." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const rows = await listOutbox({ status: sp.get("status") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }, 5000);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["Time (PHT)", "Event", "To", "Address", "Status", "Reason", "Subject", "Attempts"];
  const lines = [header.join(",")].concat(rows.map((r) => [
    fmtDateTime(r.createdAt), r.event === "test" ? "Test email" : EMAIL_EVENTS[r.event as EmailEventKey]?.label ?? r.event, r.toName, r.toAddress ?? r.intendedAddress,
    r.status, r.lastError ?? "", r.subject, r.attempts,
  ].map(esc).join(",")));
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="gdfi-dms-recent-emails.csv"' },
  });
}
