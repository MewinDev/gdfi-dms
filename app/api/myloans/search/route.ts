import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { findLoans } from "@/lib/myloans/find";

/** Find loan suggestions: at most 10, at least 3 characters, live from MyLoans. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, PERMISSIONS.LOANS_SEARCH)) return NextResponse.json({ error: "You do not have permission to search MyLoans." }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  return NextResponse.json(await findLoans(user, q), { headers: { "cache-control": "no-store" } });
}
