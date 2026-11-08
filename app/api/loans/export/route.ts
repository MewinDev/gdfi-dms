import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listLoans } from "@/lib/services/queries";
import { TAT_LABEL, businessDate } from "@/lib/time";

/** CSV export of the Loans list. Admin only (enforced here, not just by hiding the button). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, PERMISSIONS.LOANS_EXPORT)) return NextResponse.json({ error: "You do not have permission to export." }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const get = (k: string) => sp.get(k) || undefined;
  const rows = await listLoans(user, {
    tab: get("tab") ?? "all", stage: get("stage"), classification: get("classification"), branch: get("branch"),
    loanType: get("loanType"), tat: get("tat"), needsAction: get("needsAction"), q: get("q"),
  });
  const header = ["PN", "Borrower", "Loan Type", "Product", "Branch", "Released at", "Total Released Amount", "Classification", "Stage", "TAT", "Next step", "Open exceptions"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    // Prevent spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [r.pn, r.borrowerName, r.loanType, r.productName, r.branch, businessDate(r.releasedAt), r.amount.toFixed(2), r.classification, r.stage, r.tat ? TAT_LABEL[r.tat.badge] : "", r.nextStep.label, r.openExceptions]
        .map(esc)
        .join(","),
    ),
  );
  await prisma.auditLog.create({
    data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "loans_exported", entityType: "Loan", summary: `Exported ${rows.length} Loan File(s) to CSV`, details: Object.fromEntries(sp.entries()) },
  });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gdfi-dms-loans-${businessDate(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
