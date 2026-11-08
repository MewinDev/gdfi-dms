import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { reasonReport, tatReport } from "@/lib/services/tat-report";
import { JobRow } from "./job-row";
import { ReasonTable } from "./reason-table";

/** Admin Home: "TAT and problems" (open problems, overdue and due-today jobs). */
export async function TatProblemsCard() {
  const user = await requireUser();
  const [{ rows, all }, reasons] = await Promise.all([tatReport(user), reasonReport(user)]);
  const open = all.filter((r) => r.tab !== "done");
  const problems = open.filter((r) => r.problem).length;
  const overdue = open.filter((r) => r.tat?.state === "overdue" || r.tat?.lateText).length;
  const outside = open.filter((r) => r.problem?.outsideControl).length;
  const onHold = open.filter((r) => r.hold).length;
  const returned = reasons.filter((r) => r.type === "Returned").reduce((s, r) => s + r.count, 0);
  return (
    <section aria-labelledby="tat-card" className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-3 pt-4 sm:px-6">
        <h2 id="tat-card" className="text-lg font-bold text-navy sm:text-xl">TAT and problems</h2>
        <Link href="/reports/tat" className="link text-sm">Filter and export</Link>
      </div>
      <p className="px-4 pb-3 text-[15px] text-ink-2 sm:px-6">
        {open.length} open job{open.length === 1 ? "" : "s"} · {problems} with a problem{outside ? ` (${outside} outside our control)` : ""} · <span data-count="hold">{onHold} on hold</span> · <span data-count="overdue">{overdue} overdue</span> · <span data-count="returned">{returned} returned to LA</span>. The clock never pauses.
      </p>
      <div className="border-t border-[rgb(12_35_64/0.1)]">
        <h3 className="px-4 pb-1 pt-3 text-[15px] font-bold text-navy sm:px-6">By reason</h3>
        <ReasonTable rows={reasons.slice(0, 8)} caption="Problems and holds by reason" />
      </div>
      <div className="border-t border-[rgb(12_35_64/0.1)]">
        {rows.length === 0 ? <p className="px-4 py-4 text-[15px] text-ink-2 sm:px-6">Nothing needs attention.</p> : rows.slice(0, 5).map((r) => <JobRow key={r.id} r={r} showDp />)}
      </div>
    </section>
  );
}
