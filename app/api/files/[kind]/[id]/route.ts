import { getCurrentUser } from "@/lib/auth/current-user";
import { isFileKind, logFileAccess, resolveFile } from "@/lib/services/files";
import { receiptStore } from "@/lib/storage/receipts";

/**
 * The one file route (piece 3, D-019, D-039): receipts, stage evidence and LTO proof. A session is required;
 * the parent record is checked against the person's branches; anything else is "not found" (404). Every
 * view (or ?download=1) is written to the file access log. Served with no-store, nosniff and a sandbox CSP,
 * never as HTML.
 */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { kind, id } = await ctx.params;
  if (!isFileKind(kind)) return new Response("Not found.", { status: 404 });
  const url = new URL(req.url);
  const file = await resolveFile(user, kind, id, url.searchParams.get("field"));
  if (!file) return new Response("Not found.", { status: 404 });
  let bytes: Uint8Array;
  try {
    bytes = await receiptStore.get(file.key);
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  const download = url.searchParams.get("download") === "1";
  await logFileAccess(user, file, download ? "DOWNLOAD" : "VIEW", { ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: req.headers.get("user-agent") });
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
