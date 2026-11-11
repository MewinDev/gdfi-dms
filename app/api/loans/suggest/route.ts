import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { suggestLoans } from "@/lib/services/find-local";

/** Find loan suggestions while typing: loan files saved in the DMS only (never MyLoans), at most 8. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, PERMISSIONS.LOANS_VIEW)) return NextResponse.json({ error: "You do not have permission to see loan files." }, { status: 403 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await suggestLoans(user, q), { headers: { "cache-control": "no-store" } });
}
