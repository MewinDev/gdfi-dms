import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { JOB_TABS, myJobs, type JobTab } from "@/lib/services/job-queries";
import { FUNDS_LABEL, type FundsStatus } from "@/lib/funds/rules";
import { PageHeader } from "@/components/ui/basics";
import { JobRow } from "@/components/jobs/job-row";

export const metadata: Metadata = { title: "Jobs" };

const FUNDS_FILTERS: FundsStatus[] = ["NEEDED", "REQUESTED", "FUNDED", "SETTLED", "DENIED", "NOT_NEEDED"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string; type?: string; funds?: string; problem?: string; hold?: string; q?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.JOBS_WORK);
  const sp = await searchParams;
  const tab: JobTab = (JOB_TABS.some((t) => t.key === sp.tab) ? sp.tab : "process") as JobTab;
  const all = await myJobs(user);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all
    .filter((r) => r.tab === tab)
    .filter((r) => !sp.type || r.typeCode === sp.type)
    .filter((r) => !sp.funds || r.funds === sp.funds)
    .filter((r) => sp.problem !== "1" || !!r.problem)
    .filter((r) => sp.hold !== "1" || !!r.hold)
    .filter((r) => !q || r.pn.toLowerCase().includes(q) || r.borrower.toLowerCase().includes(q));
  const types = [...new Map(all.map((r) => [r.typeCode, r.typeName])).entries()];
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab, type: sp.type, funds: sp.funds, problem: sp.problem, hold: sp.hold, q: sp.q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/jobs?${p.toString()}`;
  };

  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageHeader title="Jobs" help="Your jobs. Open one to accept it, log attempts, complete and forward it." />
      <nav aria-label="Job tabs" className="flex overflow-x-auto border-b border-line">
        {JOB_TABS.map((t) => {
          const n = all.filter((r) => r.tab === t.key).length;
          return (
            <Link key={t.key} href={href({ tab: t.key })} aria-current={tab === t.key ? "page" : undefined} className="tab shrink-0">
              {t.label} <span className="ml-1 text-ink-2">{n}</span>
            </Link>
          );
        })}
      </nav>
      <form action="/jobs" className="grid gap-2 sm:grid-cols-2 sm:items-end lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <input type="hidden" name="tab" value={tab} />
        <div>
          <label htmlFor="jq" className="label">Find PN or borrower</label>
          <input id="jq" name="q" defaultValue={sp.q ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="jt" className="label">Transaction</label>
          <select id="jt" name="type" defaultValue={sp.type ?? ""} className="input">
            <option value="">All</option>
            {types.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="jf" className="label">Funds</label>
          <select id="jf" name="funds" defaultValue={sp.funds ?? ""} className="input">
            <option value="">All</option>
            {FUNDS_FILTERS.map((f) => <option key={f} value={f}>{FUNDS_LABEL[f]}</option>)}
          </select>
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="problem" value="1" defaultChecked={sp.problem === "1"} className="h-5 w-5 accent-[var(--navy)]" /> Problems only
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="hold" value="1" defaultChecked={sp.hold === "1"} className="h-5 w-5 accent-[var(--navy)]" /> On hold only
        </label>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>
      <section aria-label={JOB_TABS.find((t) => t.key === tab)?.label} className="card overflow-hidden">
        {rows.length === 0 ? <p className="px-4 py-5 text-[15px] text-ink-2 sm:px-5">No jobs here.</p> : rows.map((r) => <JobRow key={r.id} r={r} />)}
      </section>
    </div>
  );
}
