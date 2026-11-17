import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cleanFilters, exportFileLog } from "@/lib/services/file-access-log";

/**
 * Audit, File access log, Download CSV (D-039): the filtered rows within the person's branches. The export
 * is itself written to the file access log (FILE_ACCESS_LOG, EXPORT) before the file is sent.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(user, PERMISSIONS.FILES_LOG_VIEW)) return new NextResponse("Not found.", { status: 404 });
  const f = cleanFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { csv, name } = await exportFileLog(user, f, { ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: req.headers.get("user-agent") });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
