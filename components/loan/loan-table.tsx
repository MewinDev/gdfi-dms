import Link from "next/link";
import type { LoanRow } from "@/lib/services/queries";
import { CLASSIFICATION_LABEL } from "@/lib/rules";
import { fmtDate, fmtPeso } from "@/lib/time";
import { RoleChip, StageChip, TatBadge } from "@/components/chips";
import { groupByAreaBranch } from "@/lib/ui/loan-filters";

/** Empty list: one centred message in the list area (no empty table). */
export function EmptyLoans({ filtersOn, clearHref, testMode, text = "No loan files here yet." }: { filtersOn: boolean; clearHref: string; testMode: boolean; text?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-navy">{text}</p>
      {filtersOn && (
        <>
          <p className="text-[15px] text-ink-2">Try removing a filter.</p>
          <Link href={clearHref} className="btn-ghost mt-1">Clear all</Link>
        </>
      )}
      {testMode && <p className="mt-1 text-sm text-ink-2">Sample loans are opened from My loans by a Loan Associate.</p>}
    </div>
  );
}

const ClassChip = ({ c }: { c: string }) => (
  <span className={`chip h-6 whitespace-nowrap text-xs ${c === "FINANCING" ? "c-act" : "c-navy"}`}>{CLASSIFICATION_LABEL[c as "FINANCING"] ?? c}</span>
);

function Row({ r }: { r: LoanRow }) {
  return (
    <tr className="h-14">
      <td className="whitespace-nowrap">
        <Link href={`/loans/${r.pn}`} className="font-mono font-bold text-navy underline-offset-2 hover:underline">{r.pn}</Link>
        {r.openExceptions > 0 && <span className="chip c-bad ml-1" title="Open exceptions">{r.openExceptions}</span>}
      </td>
      <td className="min-w-40">{r.borrowerName}</td>
      <td className="whitespace-nowrap">{r.branch}</td>
      <td>{r.loanType}</td>
      <td className="whitespace-nowrap">{fmtDate(r.releasedAt)}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{fmtPeso(r.amount)}</td>
      <td><ClassChip c={r.classification} /></td>
      <td><StageChip stage={r.stage} /></td>
      <td><TatBadge badge={r.tat?.badge} title={r.tat ? `Due ${r.tat.deadline} (${r.tat.basis})` : undefined} /></td>
      <td className="min-w-48"><RoleChip role={r.nextStep.ownerRole} /> {r.nextStep.label}</td>
    </tr>
  );
}

/**
 * Loan list as a table (sticky header, 56px rows, PN as a bold link, chips for Stage and
 * Classification); on phone, stacked cards: PN and borrower on top, chips, then the next step.
 * `grouped`: by Area, then Branch, with a heading and a count for each.
 */
export function LoanTable({ rows, grouped = false }: { rows: LoanRow[]; grouped?: boolean }) {
  const groups = grouped ? groupByAreaBranch(rows) : null;
  return (
    <>
      <div className="card hidden max-h-[70dvh] overflow-auto sm:block">
        <table className="table" aria-label="Loan files">
          <thead className="sticky top-0 z-10 bg-fill-soft">
            <tr>
              <th scope="col">PN</th><th scope="col">Borrower</th><th scope="col">Branch</th><th scope="col">Loan type</th>
              <th scope="col">Released</th><th scope="col" className="text-right">Amount</th><th scope="col">Classification</th>
              <th scope="col">Stage</th><th scope="col">TAT</th><th scope="col">Next step</th>
            </tr>
          </thead>
          {groups ? groups.map((g) => (
            <tbody key={g.area} data-loan-area={g.area}>
              <tr className="bg-fill"><th scope="rowgroup" colSpan={10} className="text-left font-bold text-navy">{g.area} <span className="font-normal text-ink-2">· {g.count} loan file{g.count === 1 ? "" : "s"}</span></th></tr>
              {g.branches.map((b) => [
                <tr key={`h-${b.branch}`} data-loan-branch={b.branch}><th scope="rowgroup" colSpan={10} className="pl-6 text-left text-[13px] font-semibold text-ink-2">{b.branch} · {b.rows.length}</th></tr>,
                ...b.rows.map((r) => <Row key={r.id} r={r} />),
              ])}
            </tbody>
          )) : (
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
          )}
        </table>
      </div>
      <ul className="flex flex-col gap-3 sm:hidden" aria-label="Loan files">
        {(groups ? groups.flatMap((g) => g.branches.flatMap((b) => b.rows)) : rows).map((r) => (
          <li key={r.id} className="card flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/loans/${r.pn}`} className="font-mono font-bold text-navy underline-offset-2 hover:underline">{r.pn}</Link>
              <span className="text-sm tabular-nums text-ink-2">{fmtPeso(r.amount)}</span>
            </div>
            <p className="-mt-1 text-[15px]">{r.borrowerName} <span className="text-ink-2">· {r.branch}{groups && r.area ? ` · ${r.area}` : ""}</span></p>
            <div className="flex flex-wrap gap-1.5"><StageChip stage={r.stage} /><ClassChip c={r.classification} /><TatBadge badge={r.tat?.badge} /></div>
            <p className="text-sm"><RoleChip role={r.nextStep.ownerRole} /> {r.nextStep.label}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
