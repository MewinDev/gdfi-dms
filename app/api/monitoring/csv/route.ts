import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/time";
import { dpByDay, dpMonitor, ltoByDay, ltoMonitor, parseMonitorQuery, type ByDay, type MonitorSearch } from "@/lib/services/monitoring";
import { AVAILABILITY_LABEL } from "@/lib/monitoring/rules";

/**
 * Monitoring CSV: the tab and the view on screen (Totals or By day), with the same filters. Needs the
 * tab's permission (monitor:dp or monitor:lto); amounts only with journey:view_amounts.
 */
const esc = (v: unknown) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (xs: unknown[]) => xs.map(esc).join(",");
const days = (d: number | null) => (d === null ? "" : d);

function byDayLines(d: ByDay): string[] {
  const out = [line(["Group", d.unit === "day" ? "Day" : "Week (from)", ...d.columns.map((c) => c.label)])];
  for (const g of d.groups) {
    for (const r of g.rows) out.push(line([g.label, r.key, ...d.columns.map((c) => r.counts[c.key])]));
    out.push(line([g.label, "Subtotal", ...d.columns.map((c) => g.sub[c.key])]));
  }
  out.push(line(["Total", "", ...d.columns.map((c) => d.total[c.key])]));
  return out;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries()) as MonitorSearch;
  const tab = sp.tab === "lto" ? "lto" : sp.tab === "dp" ? "dp" : can(user, PERMISSIONS.MONITOR_DP) ? "dp" : "lto";
  if (!can(user, tab === "dp" ? PERMISSIONS.MONITOR_DP : PERMISSIONS.MONITOR_LTO)) return NextResponse.json({ error: "You do not have permission to see this monitor." }, { status: 403 });
  const q = { ...parseMonitorQuery({ ...sp, tab }, user), tab } as ReturnType<typeof parseMonitorQuery>;
  const head = [line([`Monitoring, ${tab === "dp" ? "DPs" : "LTO offices"}`, q.range.label, "Includes time on hold", "Business days, Philippine time"])];
  let lines: string[];
  if (q.view === "day") {
    lines = byDayLines(tab === "dp" ? await dpByDay(user, q) : await ltoByDay(user, q));
  } else if (tab === "dp") {
    const m = await dpMonitor(user, q);
    lines = [line(["Area", "Branch", "Processor", "Branch codes", "Assigned (now)", "In process (now)", "On hold (now)", "Overdue (now)", "Declined", "Returned", "Avg days to accept", "Jobs", "Avg processing days", "Jobs", "Avg total days", "Jobs", "Capacity", "Open jobs", "Availability %", "Status"])];
    for (const g of m.groups) {
      for (const r of g.rows) {
        lines.push(line([g.label, r.branchGroup, r.name, r.branches.map((b) => /\((\d{3})\)$/.exec(b)?.[1] ?? "").filter(Boolean).join(" "), r.assigned, r.inProcess, r.onHold, r.overdue, r.declined, r.returned, days(r.accept.days), r.accept.n, days(r.processing.days), r.processing.n, days(r.total.days), r.total.n, r.avail.capacity, r.open, r.avail.pct, AVAILABILITY_LABEL[r.avail.status]]));
      }
      if (g.branches.length > 1) {
        for (const bg of g.branches) lines.push(line([g.label, bg.label, "Subtotal", "", bg.sub.assigned, bg.sub.inProcess, bg.sub.onHold, bg.sub.overdue, bg.sub.declined, bg.sub.returned, days(bg.sub.accept.days), bg.sub.accept.n, days(bg.sub.processing.days), bg.sub.processing.n, days(bg.sub.total.days), bg.sub.total.n, "", bg.sub.open, bg.sub.availPct ?? "", ""]));
      }
      lines.push(line([g.label, "", "Subtotal", "", g.sub.assigned, g.sub.inProcess, g.sub.onHold, g.sub.overdue, g.sub.declined, g.sub.returned, days(g.sub.accept.days), g.sub.accept.n, days(g.sub.processing.days), g.sub.processing.n, days(g.sub.total.days), g.sub.total.n, "", g.sub.open, g.sub.availPct ?? "", ""]));
    }
  } else {
    const m = await ltoMonitor(user, q);
    const amounts = m.showAmounts;
    lines = [line(["Area", "Office", "Distance km", "Transactions", "At the LTO now", "Avg days at the LTO", "Jobs", "Active advisories", "Latest advisory", ...(amounts ? ["Estimated travel cash (PHP)", "Actual spent (PHP)"] : [])])];
    for (const g of m.groups) {
      for (const r of g.rows) {
        lines.push(line([g.label, r.name, r.distanceKm ?? "", r.used, r.atNow, days(r.avgAt.days), r.avgAt.n, r.activeAdvisories, r.latest?.warning ?? "",
          ...(r.money ? [r.money.estimateCents === null ? "" : (r.money.estimateCents / 100).toFixed(2), (r.money.spentCents / 100).toFixed(2)] : [])]));
      }
      lines.push(line([g.label, "Subtotal", "", g.sub.used, g.sub.atNow, days(g.sub.avgAt.days), g.sub.avgAt.n, g.sub.activeAdvisories, "",
        ...(amounts ? [g.sub.estimateCents === null ? "" : (g.sub.estimateCents / 100).toFixed(2), (g.sub.spentCents / 100).toFixed(2)] : [])]));
    }
  }
  await prisma.auditLog.create({ data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "monitoring_exported", entityType: "Report", summary: `Exported Monitoring, ${tab === "dp" ? "DPs" : "LTO offices"} (${q.view === "day" ? "by day" : "totals"}, ${q.range.label})`, details: { ...sp, tab } } });
  return new NextResponse("﻿" + [...head, ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gdfi-dms-monitoring-${tab}-${q.view}-${businessDate(new Date())}.csv"`, "Cache-Control": "no-store" },
  });
}
