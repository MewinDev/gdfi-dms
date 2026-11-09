import { NextResponse } from "next/server";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { branchTemplateCsv } from "@/lib/branches/file";

/** Settings, Branches, Import from MyLoans: the template (the MyLoans columns, with a header row). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user, PERMISSIONS.BRANCHES_IMPORT)) return new NextResponse("Your role does not allow this.", { status: 403 });
  return new NextResponse(branchTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="gdfi-dms-template-myloans-branches.csv"',
      "Cache-Control": "no-store",
    },
  });
}
