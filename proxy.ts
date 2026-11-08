import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Redirects unauthenticated users to /login. This is a first gate only: every page, server action
 * and route handler checks the user and permissions again on the server.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The host's health check: no session, no data (app/api/health/route.ts).
  if (pathname === "/api/health") return NextResponse.next();
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }
  // Scheduled jobs have no session: the route checks the CRON_SECRET header itself.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.jpg|robots.txt).*)"],
};
