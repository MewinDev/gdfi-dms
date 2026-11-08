import type { ReasonRow } from "@/lib/services/tat-report";
import { AlertIcon, ArrowLeftIcon, PauseIcon } from "@/components/ui/icons";

/** Problems and holds by reason: type, number (open), average business days, outside our control (problems). */
export function ReasonTable({ rows, caption }: { rows: ReasonRow[]; caption: string }) {
  if (!rows.length) return <p className="px-4 py-3 text-[15px] text-ink-2 sm:px-6">No problems or holds in this period.</p>;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="table" data-reasons>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Type</th><th scope="col">Reason</th><th scope="col">Number</th><th scope="col">Average days</th><th scope="col">Outside our control</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.type}-${r.reason}`}>
              <td>
                <span className={`chip h-6 text-xs ${r.type === "Problem" ? "c-bad" : r.type === "Hold" ? "c-navy" : "c-wait"}`}>
                  {r.type === "Problem" ? <AlertIcon size={13} /> : r.type === "Hold" ? <span className="text-gold"><PauseIcon size={13} /></span> : <ArrowLeftIcon size={13} />}
                  {r.type === "Returned" ? "Returned to LA" : r.type}
                </span>
              </td>
              <td>{r.reason}</td>
              <td>{r.count}{r.open ? <span className="text-ink-2"> ({r.open} open)</span> : null}</td>
              <td>{r.avgDays}</td>
              <td>{r.outside === null ? <span className="text-ink-2">-</span> : r.outside}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
