import { prisma } from "@/lib/db";
import { can, getCurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { receiptStore } from "@/lib/storage/receipts";

/**
 * A receipt file. Only the processor who owns the advance, and people who may see all funds
 * (Finance, Admin), can open it. Served inline with its checked content type, never as HTML.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id } = await ctx.params;
  const r = await prisma.receipt.findUnique({ where: { id }, include: { line: { include: { advance: { select: { requestedById: true } } } } } });
  const allowed = r && (r.line.advance.requestedById === user.id || can(user, PERMISSIONS.FUNDS_VIEW_ALL));
  if (!r || !allowed || !r.fileKey) return new Response("Not found.", { status: 404 });
  let bytes: Uint8Array;
  try {
    bytes = await receiptStore.get(r.fileKey);
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  const safeName = (r.fileName || `receipt-${r.number}`).replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": r.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
