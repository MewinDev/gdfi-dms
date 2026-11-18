import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/import/csv";
import { PN_OUTCOMES, pnSearchCsvRows, type PnOutcome } from "@/lib/services/pn-search-log";

/** Reports, PN searches, Download CSV (D-050): the filtered rows within the person's branches. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(user, PERMISSIONS.REPORTS_PNSEARCH)) return new NextResponse("Not found.", { status: 404 });
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const rows = await pnSearchCsvRows(user, { from: q.from, to: q.to, pn: q.pn, outcome: q.outcome, who: q.who });
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const csv = toCsv(["when_pht", "pn", "outcome", "who", "myloans_status_id", "feed_state"], rows.map((r) => ({
    when_pht: fmt.format(r.at).replace(",", ""), pn: r.pn, outcome: PN_OUTCOMES[r.outcome as PnOutcome] ?? r.outcome, who: r.userLabel,
    myloans_status_id: r.statusId ?? "", feed_state: r.feedState ?? "",
  })));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"pn-searches.csv\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
