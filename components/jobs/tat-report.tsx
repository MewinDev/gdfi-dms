import type { CurrentUser } from "@/lib/auth/current-user";
import { reasonReport, tatReport } from "@/lib/services/tat-report";
import { AlertCard } from "@/components/home/home-ui";
import { ClockIcon } from "@/components/ui/icons";
import { JobRow } from "./job-row";
import { ReasonTable } from "./reason-table";

/** Admin and Supervisor Home: "TAT and problems" (open problems, overdue and due-today jobs). */
export async function tatToDo(user: CurrentUser) {
  const [{ rows, all }, reasons] = await Promise.all([tatReport(user), reasonReport(user)]);
  const open = all.filter((r) => r.tab !== "done");
  const problems = open.filter((r) => r.problem).length;
  const overdue = open.filter((r) => r.tat?.state === "overdue" || r.tat?.lateText).length;
  const outside = open.filter((r) => r.problem?.outsideControl).length;
  const onHold = open.filter((r) => r.hold).length;
  const returned = reasons.filter((r) => r.type === "Returned").reduce((s, r) => s + r.count, 0);
  /** What needs attention now: the jobs listed, plus any open problem, hold or overdue job. */
  const count = rows.length;
  const attention = count > 0 || problems > 0 || onHold > 0 || overdue > 0;
  return { rows, reasons, open: open.length, problems, overdue, outside, onHold, returned, count, attention };
}

/**
 * Shown only when something needs attention. The link opens the TAT report (filters; it has no export,
 * so it is not called "Filter and export" any more).
 */
export function TatProblemsCard({ data }: { data: Awaited<ReturnType<typeof tatToDo>> }) {
  if (!data.attention) return null;
  const d = data;
  const reasons = d.reasons.slice(0, 8);
  return (
    <AlertCard id="tat-card" title="TAT and problems" count={d.count} tone={d.problems ? "bad" : "act"} icon={<ClockIcon size={15} />} link={{ href: "/reports/tat", label: "Open the TAT report" }} data={{ "data-tat-card": "" }}
      reason={<>{d.open} open job{d.open === 1 ? "" : "s"} · {d.problems} with a problem{d.outside ? ` (${d.outside} outside our control)` : ""} · <span data-count="hold">{d.onHold} on hold</span> · <span data-count="overdue">{d.overdue} overdue</span> · <span data-count="returned">{d.returned} returned to LA</span>. The clock never pauses.</>}>
      {reasons.length > 0 && (
        <div className="text-[13px] [&_td]:py-1.5 [&_th]:py-1.5 [&_th]:text-[12px]" data-tat-reasons>
          {/* "By reason" only when there is more than one reason to compare. */}
          {reasons.length > 1 && <h3 className="px-3 pt-2 text-[12px] font-semibold text-ink-2 sm:px-4">By reason</h3>}
          <ReasonTable rows={reasons} caption="Problems and holds by reason" />
        </div>
      )}
      {d.rows.length > 0 && <div className={reasons.length ? "border-t border-line" : ""}>{d.rows.slice(0, 5).map((r) => <JobRow key={r.id} r={r} showDp />)}</div>}
    </AlertCard>
  );
}
