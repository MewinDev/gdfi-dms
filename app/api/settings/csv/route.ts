import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { LIST_PERMISSION, PERMISSIONS } from "@/lib/auth/permissions";
import { IMPORT_LISTS, dataFileName, templateFileName, type ImportListKey } from "@/lib/import/columns";
import { currentDataCsv, templateCsv } from "@/lib/import/importer";

/** Download template / Download current data for a Settings list (or Users). CSV, UTF-8 with BOM. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const list = req.nextUrl.searchParams.get("list") as ImportListKey | null;
  const mode = req.nextUrl.searchParams.get("mode");
  if (!list || !IMPORT_LISTS[list] || (mode !== "template" && mode !== "data")) return new NextResponse("Unknown list.", { status: 400 });
  // Downloads need the permission for that list (Users: see users).
  const perm = list === "users" ? PERMISSIONS.USERS_VIEW : LIST_PERMISSION[list];
  if (!user || !can(user, perm)) return new NextResponse("Your role does not allow downloading this list.", { status: 403 });
  const body = mode === "template" ? templateCsv(list) : await currentDataCsv(list);
  const name = mode === "template" ? templateFileName(list) : dataFileName(list);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
