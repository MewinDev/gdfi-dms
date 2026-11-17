import type { Metadata } from "next";
import Link from "next/link";
import { can, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/basics";
import { Chip } from "@/components/chips";
import { AuditTabs } from "@/components/audit-tabs";
import { FILE_LOG_ACTIONS, FILE_LOG_TYPES, cleanFilters, fileLogPage, seesExports, type FileLogType } from "@/lib/services/file-access-log";

export const metadata: Metadata = { title: "File Access Log" };

const PAGE = 50;

/**
 * Audit, File access log (D-019, D-039): every view and download of a receipt, stage evidence or LTO proof,
 * and every export of this log. Filters: user, branch, PN #, file type, date range (Philippine dates).
 * Download CSV exports the filtered rows; the export is logged too.
 */
export default async function FileAccessLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission(PERMISSIONS.FILES_LOG_VIEW);
  const sp = await searchParams;
  const f = cleanFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, branches, branchName } = await fileLogPage(user, f, page, PAGE);
  const filterQs = new URLSearchParams(f as Record<string, string>).toString();
  const qs = (p: number) => { const u = new URLSearchParams(f as Record<string, string>); u.set("page", String(p)); return `?${u}`; };
  const loanLinks = can(user, PERMISSIONS.LOANS_VIEW);
  const types = (Object.keys(FILE_LOG_TYPES) as FileLogType[]).filter((t) => t !== "FILE_ACCESS_LOG" || seesExports(user));

  return (
    <div className="w-full space-y-6">
      <AuditTabs current="files" audit={can(user, PERMISSIONS.AUDIT_VIEW)} files />
      <PageHeader title="File Access Log" help="Append-only. Who opened or downloaded each receipt, stage evidence and LTO proof, and when. Each CSV export is recorded here too." />
      <form method="get" className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 md:grid-cols-6" aria-label="File access log filters">
        <div><label htmlFor="f-user" className="label">User</label><input id="f-user" name="user" defaultValue={f.user} className="input" placeholder="Name or email" /></div>
        <div>
          <label htmlFor="f-branch" className="label">Branch</label>
          <select id="f-branch" name="branchId" defaultValue={f.branchId ?? ""} className="input">
            <option value="">All your branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="f-pn" className="label">PN #</label><input id="f-pn" name="pn" defaultValue={f.pn} className="input" /></div>
        <div>
          <label htmlFor="f-type" className="label">File type</label>
          <select id="f-type" name="type" defaultValue={f.type ?? ""} className="input">
            <option value="">All</option>
            {types.map((t) => <option key={t} value={t}>{FILE_LOG_TYPES[t]}</option>)}
          </select>
        </div>
        <div><label htmlFor="f-from" className="label">From</label><input id="f-from" name="from" type="date" defaultValue={f.from} className="input" /></div>
        <div><label htmlFor="f-to" className="label">To</label><input id="f-to" name="to" type="date" defaultValue={f.to} className="input" /></div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 md:col-span-6">
          <button type="submit" className="btn-primary">Search</button>
          <Link href="/admin/audit/files" className="btn-secondary">Clear</Link>
          {/* A plain link (no prefetch): every export writes a log row. */}
          {total > 0
            ? <a href={`/api/audit/files${filterQs ? `?${filterQs}` : ""}`} className="btn-secondary" data-file-log-export>Download CSV</a>
            : <button type="button" className="btn-secondary" disabled title="Nothing matches these filters." aria-describedby="f-nothing">Download CSV</button>}
          <span id="f-nothing" className="ml-auto text-xs text-ink-2" data-file-log-total>{total === 0 ? "Nothing matches these filters, so there is nothing to download." : `${total} entr${total === 1 ? "y" : "ies"}`}</span>
        </div>
      </form>
      <div className="card relative overflow-x-auto">
        <table className="table" data-file-log>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>File type</th><th>File</th><th>PN #</th><th>Branch</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="text-ink-2">No file was opened that matches these filters.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-file-log-row>
                <td className="whitespace-nowrap">{fmtDateTime(r.at)}</td>
                <td>{r.user.name}<span className="block text-xs text-ink-2">{r.user.email}</span></td>
                <td><Chip tone={r.action === "EXPORT" ? "warn" : r.action === "DOWNLOAD" ? "info" : "neutral"}>{FILE_LOG_ACTIONS[r.action as keyof typeof FILE_LOG_ACTIONS] ?? r.action}</Chip></td>
                <td className="whitespace-nowrap">{FILE_LOG_TYPES[r.entityType as FileLogType] ?? r.entityType}</td>
                <td className="break-all">{r.fileName || "-"}</td>
                <td className="mono whitespace-nowrap">{r.pn ? (loanLinks ? <Link href={`/loans/${r.pn}`} className="text-navy underline">{r.pn}</Link> : r.pn) : "-"}</td>
                <td className="whitespace-nowrap">{r.branchId ? branchName.get(r.branchId) ?? "-" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pages" className="flex items-center justify-between">
        {page > 1 ? <Link href={qs(page - 1)} className="btn-secondary btn-sm">Previous</Link> : <span />}
        <span className="text-xs text-ink-2">Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
        {page * PAGE < total ? <Link href={qs(page + 1)} className="btn-secondary btn-sm">Next</Link> : <span />}
      </nav>
    </div>
  );
}
