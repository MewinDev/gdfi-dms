import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { reasonReport, tatReport } from "@/lib/services/tat-report";
import { FUNDS_LABEL } from "@/lib/funds/rules";
import { businessDate } from "@/lib/time";

/** CSV of the TAT and problems report: needs the report and the export permission. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, PERMISSIONS.REPORTS_TAT) || !can(user, PERMISSIONS.LOANS_EXPORT)) return NextResponse.json({ error: "You do not have permission to export." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const f = { branch: sp.get("branch") || undefined, type: sp.get("type") || undefined, show: sp.get("show") || undefined, outside: sp.get("outside") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined };
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  if (sp.get("kind") === "reasons") {
    const reasons = await reasonReport(user, f);
    const out = [["Type", "Reason", "Number", "Open", "Average business days", "Outside our control"].join(",")]
      .concat(reasons.map((r) => [r.type, r.reason, r.count, r.open, r.avgDays, r.outside ?? ""].map(esc).join(",")));
    await prisma.auditLog.create({ data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "tat_report_exported", entityType: "Report", summary: `Exported problems and holds by reason (${reasons.length} row(s))`, details: f } });
    return new NextResponse("\ufeff" + out.join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gdfi-dms-reasons-${businessDate(new Date())}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const { rows } = await tatReport(user, f);
  const header = ["PN", "Borrower", "Branch", "Transaction", "Processor", "Job", "TAT", "Late", "Funds", "Type", "Open problem", "Problem days", "Outside our control", "Open hold", "Hold days", "Attempts"];
  const lines = [header.join(",")].concat(rows.map((r) => [
    r.pn, r.borrower, r.branch, r.typeName, r.dpName, r.tab, r.tat?.text ?? "", r.tat?.lateText ?? "", FUNDS_LABEL[r.funds], r.problem ? "Problem" : r.hold ? "Hold" : "", r.problem?.reason ?? "", r.problemDaysTotal, r.problem?.outsideControl ? "Yes" : "No", r.hold?.reason ?? "", r.holdDaysTotal, r.attempts,
  ].map(esc).join(",")));
  await prisma.auditLog.create({ data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "tat_report_exported", entityType: "Report", summary: `Exported the TAT and problems report (${rows.length} row(s))`, details: f } });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gdfi-dms-tat-${businessDate(new Date())}.csv"`, "Cache-Control": "no-store" },
  });
}
