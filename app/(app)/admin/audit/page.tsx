import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDateTime, startOfBusinessDay } from "@/lib/time";
import { PageHeader } from "@/components/ui/basics";
import { Chip } from "@/components/chips";

export const metadata: Metadata = { title: "Audit Log" };

const PAGE = 50;

function diff(before: unknown, after: unknown): { key: string; before: string; after: string }[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const s = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
  return keys.filter((k) => s(b[k]) !== s(a[k])).map((k) => ({ key: k, before: s(b[k]), after: s(a[k]) }));
}

/** Converts a YYYY-MM-DD in the business time zone to a UTC instant at local midnight. */
function startOfDay(ymd: string, addDays = 0) {
  return new Date(startOfBusinessDay(ymd).getTime() + addDays * 86_400_000);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission(PERMISSIONS.AUDIT_VIEW);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.pn) where.pn = { contains: sp.pn.trim(), mode: "insensitive" };
  if (sp.user) where.actorLabel = { contains: sp.user.trim(), mode: "insensitive" };
  if (sp.action) where.action = sp.action;
  if (sp.mode) where.mode = sp.mode as "MANUAL";
  const valid = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (valid(sp.from) || valid(sp.to)) where.at = { ...(valid(sp.from) ? { gte: startOfDay(sp.from!) } : {}), ...(valid(sp.to) ? { lt: startOfDay(sp.to!, 1) } : {}) };

  const [rows, total, actions] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `?${u}`;
  };

  return (
    <div className="w-full space-y-6">
      <PageHeader title="Audit Log" help="Append-only. Every automatic decision and user action, with before and after values." />
      <form method="get" className="card grid grid-cols-2 gap-3 p-3 md:grid-cols-6" aria-label="Audit filters">
        <div><label htmlFor="a-pn" className="label">PN</label><input id="a-pn" name="pn" defaultValue={sp.pn} className="input" /></div>
        <div><label htmlFor="a-user" className="label">User</label><input id="a-user" name="user" defaultValue={sp.user} className="input" placeholder="Name or System" /></div>
        <div>
          <label htmlFor="a-action" className="label">Action</label>
          <select id="a-action" name="action" defaultValue={sp.action ?? ""} className="input">
            <option value="">All</option>
            {actions.map((a) => <option key={a.action} value={a.action}>{a.action.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-mode" className="label">Mode</label>
          <select id="a-mode" name="mode" defaultValue={sp.mode ?? ""} className="input">
            <option value="">All</option><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option><option value="SIMULATED">Simulated</option>
          </select>
        </div>
        <div><label htmlFor="a-from" className="label">From</label><input id="a-from" name="from" type="date" defaultValue={sp.from} className="input" /></div>
        <div><label htmlFor="a-to" className="label">To</label><input id="a-to" name="to" type="date" defaultValue={sp.to} className="input" /></div>
        <div className="col-span-2 flex items-center gap-2 md:col-span-6">
          <button type="submit" className="btn-primary">Search</button>
          <Link href="/admin/audit" className="btn-secondary">Clear</Link>
          <span className="ml-auto text-xs text-ink-2">{total} entr{total === 1 ? "y" : "ies"}</span>
        </div>
      </form>
      <div className="card relative overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Mode</th><th>PN</th><th>Action</th><th>Summary</th><th>Changes</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = diff(r.before, r.after);
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td>{r.actorLabel}</td>
                  <td><Chip tone={r.mode === "AUTOMATIC" ? "info" : r.mode === "SIMULATED" ? "warn" : "neutral"}>{r.mode.toLowerCase()}</Chip></td>
                  <td className="mono whitespace-nowrap">{r.pn ? <Link href={`/loans/${r.pn}?tab=activity`} className="text-navy underline">{r.pn}</Link> : "-"}</td>
                  <td className="whitespace-nowrap">{r.action.replace(/_/g, " ")}</td>
                  <td>{r.summary}</td>
                  <td className="min-w-64">
                    {d.length > 0 || r.details ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-navy">{d.length} field(s) changed</summary>
                        {d.length > 0 && (
                          <table className="mt-1 w-full text-[11px]">
                            <thead><tr><th className="text-left">Field</th><th className="text-left">Before</th><th className="text-left">After</th></tr></thead>
                            <tbody>
                              {d.map((x) => (
                                <tr key={x.key}>
                                  <td className="pr-2 font-semibold">{x.key}</td>
                                  <td className="bg-err-bg px-1 align-top break-all">{x.before}</td>
                                  <td className="bg-ok-bg px-1 align-top break-all">{x.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {r.details ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-cream p-1 text-[11px]">{JSON.stringify(r.details, null, 2)}</pre> : null}
                      </details>
                    ) : <span className="text-xs text-ink-2">-</span>}
                  </td>
                </tr>
              );
            })}
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
