import { prisma } from "@/lib/db";
import { getCurrentUser, inScope } from "@/lib/auth/current-user";
import { canSeeJob } from "@/lib/services/jobs";
import { receiptStore } from "@/lib/storage/receipts";

/**
 * A file recorded as stage evidence (for example the PPSR certificate). Only people who can see the
 * job or the loan file may open it. Served inline with its checked content type, never as HTML.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; field: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id, field } = await ctx.params;
  const st = await prisma.jobStage.findUnique({ where: { id }, include: { assignment: { include: { loan: { select: { branchId: true } } } } } });
  if (!st || !(canSeeJob(user, st.assignment) || inScope(user, st.assignment.loan.branchId))) return new Response("Not found.", { status: 404 });
  const file = ((st.evidence ?? {}) as Record<string, unknown>)[field] as { key?: string; name?: string; mime?: string } | undefined;
  if (!file?.key) return new Response("Not found.", { status: 404 });
  let bytes: Uint8Array;
  try {
    bytes = await receiptStore.get(file.key);
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  const safeName = (file.name || "evidence").replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
