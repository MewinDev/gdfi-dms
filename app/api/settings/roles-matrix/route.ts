import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { accessMatrixCsv } from "@/lib/services/roles";

/** Download access matrix: one row per permission, one column per role, Yes/No. Read-only (no import for roles). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user, PERMISSIONS.ROLES_MANAGE)) return new NextResponse("Your role does not allow this download.", { status: 403 });
  return new NextResponse(await accessMatrixCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gdfi-dms-access-matrix.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
