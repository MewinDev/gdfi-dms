import { prisma } from "@/lib/db";
import { health } from "@/lib/health";

/** Health check for the host: ok, environment, database up or down, build version. Nothing else. */
export async function GET() {
  const h = await health(() => prisma.$queryRaw`SELECT 1`);
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
