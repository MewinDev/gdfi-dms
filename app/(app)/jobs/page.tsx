import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { myJobs } from "@/lib/services/job-queries";
import { filterJobs, jobListUrl, parseJobParams } from "@/lib/jobs/list";
import { txnName } from "@/lib/ui/plain";
import { InfoTip } from "@/components/ui/info-tip";
import { JobsFilterBar } from "@/components/jobs/jobs-filter-bar";
import { JobsView } from "@/components/jobs/jobs-view";

export const metadata: Metadata = { title: "Jobs" };

const OLD_TABS: Record<string, string> = { review: "review", process: "process", forwarded: "forwarded", done: "done" };

/**
 * D-064: the processor's Jobs, the same design as the Loans page and the Inbox: status chips with counts in place
 * of the tabs (none chosen: To review and In process), one search, compact filters that apply at once (Transaction,
 * Funds, Late only), late first then the soonest due; one row per job; the whole row opens the details panel.
 * Everything is in the address (old ?tab= addresses are read as the matching status chip).
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission(PERMISSIONS.JOBS_WORK);
  const sp = await searchParams;
  const p = parseJobParams(sp);
  // Old links (?tab=, ?problem=1, ?hold=1, the old funds values): the same list in the new form.
  const tab = typeof sp.tab === "string" ? OLD_TABS[sp.tab] : undefined;
  if (tab || sp.problem === "1" || sp.hold === "1") {
    const status = [...p.status, ...(tab ? [tab] : []), ...(sp.problem === "1" ? ["problems"] : []), ...(sp.hold === "1" ? ["hold"] : [])] as typeof p.status;
    redirect(jobListUrl({ ...p, status: [...new Set(status)] }));
  }
  const all = await myJobs(user);
  const { rows, counts } = filterJobs(all, p);
  const types = [...new Map(all.map((r) => [r.typeCode, txnName(r.typeCode, r.typeName)])).entries()].map(([code, name]) => ({ code, name }));
  const filtered = p.status.length > 0 || !!p.q || !!p.type || !!p.funds || p.late;

  return (
    <div className="dense flex w-full min-w-0 flex-col gap-3" data-jobs-page>
      {/* D-064: the same size as Loans and Inbox; one short line with an (i) about the statuses. */}
      <header className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight text-navy">Jobs</h1>
        <p className="relative mt-0.5 flex items-center gap-1 text-[13px] text-ink-2">
          Your jobs, least time left first.
          <InfoTip label="About the job statuses" data="jobs" lines={[
            { text: "To review = sent to you; check the papers, then accept or decline.", data: "review" },
            { text: "In process = yours; log attempts, complete and forward.", data: "process" },
            { text: "Forwarded = sent back to the Loan Associate's branch.", data: "forwarded" },
            { text: "Done = the Loan Associate received the package.", data: "done" },
          ]} />
        </p>
      </header>
      <JobsFilterBar params={p} counts={counts} types={types} />
      <p className="text-[13px] text-ink-2" role="status" data-jobs-total>{rows.length} job{rows.length === 1 ? "" : "s"}</p>
      <JobsView rows={rows}
        perms={{ me: user.id, hold: can(user, PERMISSIONS.HOLDS_RAISE), loans: can(user, PERMISSIONS.LOANS_VIEW), amounts: can(user, PERMISSIONS.LOANS_VIEW_AMOUNTS) }}
        empty={filtered ? "No jobs match these filters." : "No jobs to review or in process."} />
    </div>
  );
}
