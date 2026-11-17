import "server-only";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { mayOpenReceipt, mayOpenStageFile } from "./file-access";

/**
 * Piece 3 (D-019, D-039): the ONE way a stored file is opened. `/api/files/[kind]/[id]` resolves the file
 * here, checks the parent record against the person's branch scope (404 otherwise), and writes a
 * FileAccessLog row for every view or download. Files are never served from public/ or a static URL.
 *
 *   receipt     a funds receipt (id = Receipt.id)
 *   stage       a stage evidence file (id = JobStage.id, ?field=<evidence field>)
 *   lto-proof   the same, for a stage at the LTO (drop-off or pick-up); refused for any other stage
 */
export const FILE_KINDS = ["receipt", "stage", "lto-proof"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const isFileKind = (k: string): k is FileKind => (FILE_KINDS as readonly string[]).includes(k);

export interface ResolvedFile {
  key: string; name: string; mime: string;
  log: { entityType: "RECEIPT" | "STAGE_EVIDENCE" | "LTO_PROOF"; entityId: string; loanId: string | null; pn: string | null; branchId: string | null };
}

/** The file, or null when it does not exist or the person may not open it (the route answers 404 either way). */
export async function resolveFile(user: CurrentUser, kind: FileKind, id: string, field?: string | null): Promise<ResolvedFile | null> {
  if (kind === "receipt") {
    const r = await prisma.receipt.findUnique({
      where: { id },
      include: { line: { include: { transaction: { include: { loan: { select: { id: true, pn: true, branchId: true } } } }, advance: { select: { requestedById: true, fundsTypeId: true, branchId: true, lines: { select: { transaction: { select: { loan: { select: { branchId: true } } } } } } } } } } },
    });
    if (!r || !r.fileKey) return null;
    const adv = r.line.advance;
    if (!mayOpenReceipt(user, { ...adv, lineBranchIds: adv.lines.map((l) => l.transaction?.loan.branchId) })) return null;
    const loan = r.line.transaction?.loan ?? null;
    return { key: r.fileKey, name: r.fileName || "receipt", mime: r.mime, log: { entityType: "RECEIPT", entityId: r.id, loanId: loan?.id ?? null, pn: loan?.pn ?? null, branchId: loan?.branchId ?? adv.branchId } };
  }
  const st = await prisma.jobStage.findUnique({ where: { id }, include: { assignment: { include: { loan: { select: { id: true, pn: true, branchId: true } } } } } });
  if (!st || !field || !mayOpenStageFile(user, st.assignment)) return null;
  const lto = st.kind === "LTO_DROP" || st.kind === "LTO_PICKUP";
  if (kind === "lto-proof" && !lto) return null;
  const file = ((st.evidence ?? {}) as Record<string, unknown>)[field] as { key?: string; name?: string; mime?: string } | undefined;
  if (!file?.key) return null;
  const loan = st.assignment.loan;
  return { key: file.key, name: file.name || "evidence", mime: file.mime || "application/octet-stream", log: { entityType: lto ? "LTO_PROOF" : "STAGE_EVIDENCE", entityId: `${st.id}:${field}`, loanId: loan.id, pn: loan.pn, branchId: loan.branchId } };
}

/** One row per view or download (append-only; the database refuses updates and deletes). */
export async function logFileAccess(user: CurrentUser, f: ResolvedFile, action: "VIEW" | "DOWNLOAD", meta: { ip?: string | null; userAgent?: string | null } = {}) {
  await prisma.fileAccessLog.create({
    data: { userId: user.id, ...f.log, fileKey: f.key, fileName: f.name, action, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
}

/** The link to open a file (the only file URL the app builds). */
export function fileHref(kind: FileKind, id: string, field?: string): string {
  return `/api/files/${kind}/${encodeURIComponent(id)}${field ? `?field=${encodeURIComponent(field)}` : ""}`;
}
