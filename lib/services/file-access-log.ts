import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { branchRowScope, can, hasAllBranches, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDateTime, startOfBusinessDay } from "@/lib/time";
import { looksLikeFormula, toCsv } from "@/lib/import/csv";

/**
 * Audit, File access log (D-019, D-039): who opened or downloaded which receipt, stage evidence or LTO proof,
 * and every CSV export of this log. Read with "View file access log" (`audit:files`), within the person's
 * branch access (an export row has no branch: only someone with All branches sees those). The log is
 * append-only (a database trigger refuses updates and deletes).
 */

export const FILE_LOG_TYPES = {
  RECEIPT: "Receipt",
  STAGE_EVIDENCE: "Stage evidence",
  LTO_PROOF: "LTO proof",
  FILE_ACCESS_LOG: "Export of this log",
} as const;
export type FileLogType = keyof typeof FILE_LOG_TYPES;
export const FILE_LOG_ACTIONS = { VIEW: "Viewed", DOWNLOAD: "Downloaded", EXPORT: "Exported" } as const;

export interface FileLogFilters { user?: string; branchId?: string; pn?: string; type?: string; from?: string; to?: string }

const ymd = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayStart = (d: string, add = 0) => new Date(startOfBusinessDay(d).getTime() + add * 86_400_000);

/** Only the known filters, trimmed (what the page, the CSV link and the export row carry). */
export function cleanFilters(raw: Record<string, string | undefined | null>): FileLogFilters {
  const f: FileLogFilters = {};
  const t = (k: keyof FileLogFilters) => raw[k]?.trim().slice(0, 100) || undefined;
  f.user = t("user");
  f.branchId = t("branchId");
  f.pn = t("pn");
  const type = t("type");
  f.type = type && type in FILE_LOG_TYPES ? type : undefined;
  f.from = ymd(t("from")) ? t("from") : undefined;
  f.to = ymd(t("to")) ? t("to") : undefined;
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as FileLogFilters;
}

/** The where-clause: the person's branch access first, then the filters (Philippine dates, both ends included). */
export function fileLogWhere(u: CurrentUser, f: FileLogFilters): Prisma.FileAccessLogWhereInput {
  const and: Prisma.FileAccessLogWhereInput[] = [loanScope(u)];
  if (f.user) and.push({ user: { OR: [{ name: { contains: f.user, mode: "insensitive" } }, { email: { contains: f.user, mode: "insensitive" } }] } });
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.pn) and.push({ pn: { contains: f.pn, mode: "insensitive" } });
  if (f.type) and.push({ entityType: f.type });
  if (f.from || f.to) and.push({ at: { ...(f.from ? { gte: dayStart(f.from) } : {}), ...(f.to ? { lt: dayStart(f.to, 1) } : {}) } });
  return { AND: and };
}

function requireLog(u: CurrentUser) {
  if (!can(u, PERMISSIONS.FILES_LOG_VIEW)) throw new Error("Ask a Superadmin to turn on \"View file access log\" for your role.");
}

const include = { user: { select: { name: true, email: true } } } satisfies Prisma.FileAccessLogInclude;

/** One page of the log, newest first, with the branch names for display and the branch filter's options. */
export async function fileLogPage(u: CurrentUser, f: FileLogFilters, page: number, size = 50) {
  requireLog(u);
  const where = fileLogWhere(u, f);
  const [rows, total, branches] = await Promise.all([
    prisma.fileAccessLog.findMany({ where, include, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (page - 1) * size, take: size }),
    prisma.fileAccessLog.count({ where }),
    prisma.branch.findMany({ where: branchRowScope(u), orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { rows, total, branches, branchName: new Map(branches.map((b) => [b.id, b.name])) };
}

export const FILE_LOG_CSV_HEADER = ["When (Philippine time)", "User", "Email", "Action", "File type", "File name", "PN #", "Branch", "IP address", "Browser"];
export const MAX_EXPORT_ROWS = 50_000;
/** A cell a spreadsheet could run as a formula gets a leading apostrophe (CSV injection). */
const safe = (v: string | null | undefined) => (v && looksLikeFormula(v) ? `'${v}` : v ?? "");

/**
 * The CSV of the filtered log (at most MAX_EXPORT_ROWS, newest first). The export is itself logged first
 * (entityType FILE_ACCESS_LOG, action EXPORT, with the filters), in the same transaction as the read.
 */
export async function exportFileLog(u: CurrentUser, f: FileLogFilters, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  requireLog(u);
  const now = new Date();
  const name = `file-access-log-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now)}.csv`;
  return prisma.$transaction(async (tx) => {
    const where = fileLogWhere(u, f);
    const [rows, branches] = await Promise.all([
      tx.fileAccessLog.findMany({ where, include, orderBy: [{ at: "desc" }, { id: "desc" }], take: MAX_EXPORT_ROWS }),
      tx.branch.findMany({ select: { id: true, name: true } }),
    ]);
    await tx.fileAccessLog.create({
      data: {
        userId: u.id, entityType: "FILE_ACCESS_LOG", entityId: JSON.stringify({ filters: f, rows: rows.length }).slice(0, 500), action: "EXPORT",
        fileKey: "", fileName: name, loanId: null, pn: f.pn ?? null, branchId: null, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    const bn = new Map(branches.map((b) => [b.id, b.name]));
    const csv = toCsv(FILE_LOG_CSV_HEADER, rows.map((r) => {
      const v = [
        fmtDateTime(r.at), r.user.name, r.user.email, FILE_LOG_ACTIONS[r.action as keyof typeof FILE_LOG_ACTIONS] ?? r.action,
        FILE_LOG_TYPES[r.entityType as FileLogType] ?? r.entityType, r.fileName, r.pn ?? "", r.branchId ? bn.get(r.branchId) ?? "" : "", r.ip ?? "", r.userAgent ?? "",
      ];
      return Object.fromEntries(FILE_LOG_CSV_HEADER.map((h, i) => [h, safe(v[i])]));
    }));
    return { csv, name, count: rows.length };
  });
}

/** Whether export rows (no branch) are visible to this person: only with All branches. */
export const seesExports = (u: CurrentUser) => hasAllBranches(u);
