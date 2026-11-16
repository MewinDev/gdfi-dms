import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mayOpenStageFile } from "@/lib/services/file-access";
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
  // See loan files (loans:view), and the job or the loan file in the person's branches (lib/services/file-access.ts).
  if (!st || !mayOpenStageFile(user, st.assignment)) return new Response("Not found.", { status: 404 });
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
