import Link from "next/link";
import type { LoanRow } from "@/lib/services/queries";
import { ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { dayText, listStage, peso } from "@/lib/ui/plain";
import { cardFor } from "@/lib/ui/loan-cards";
import { groupByAreaBranch } from "@/lib/ui/loan-filters";
import { Flags } from "./my-loans-list";

/**
 * The Loans table (the read-only list: Admin, Supervisor, approvers, Finance, processors), one column per fact:
 * Borrower (name, PN under it), Branch, Product (product name, loan type under it), Released, Amount, Stage (the
 * current step of the loan-file flow, its name only), TAT, Next step. No Classification column. Under 1024px Released
 * and Amount go under the product. About 56px a row; the whole row opens the loan file. On a phone each loan
 * is a block of short lines. `grouped`: by Area, then Branch, with a heading and a count for each.
 */
const COLS = 8;

export function LoanTable({ rows, grouped = false, holidays }: { rows: LoanRow[]; grouped?: boolean; holidays: ReadonlySet<string> }) {
  const groups = grouped ? groupByAreaBranch(rows) : null;
  const th = "px-3 py-2 font-normal first:pl-4 last:pr-4";
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-line bg-white sm:block" data-loan-table>
        <table className="w-full border-collapse text-[14px]" aria-label="Loan files">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-ink-2">
              <th scope="col" className={th}>Borrower</th>
              <th scope="col" className={`${th} hidden lg:table-cell`}>Branch</th>
              <th scope="col" className={th}>Product</th>
              <th scope="col" className={`${th} hidden lg:table-cell`}>Released</th>
              <th scope="col" className={`${th} hidden text-right lg:table-cell`}>Amount</th>
              <th scope="col" className={th}>Stage</th>
              <th scope="col" className={th}>TAT</th>
              <th scope="col" className={th}>Next step</th>
            </tr>
          </thead>
          {groups ? groups.map((g) => (
            <tbody key={g.area} data-loan-area={g.area}>
              <tr className="bg-fill"><th scope="rowgroup" colSpan={COLS} className="px-4 py-2 text-left text-[13px] font-semibold text-navy">{g.area} <span className="font-normal text-ink-2">· {g.count} loan file{g.count === 1 ? "" : "s"}</span></th></tr>
              {g.branches.map((b) => [
                <tr key={`h-${b.branch}`} data-loan-branch={b.branch} className="border-b border-line"><th scope="rowgroup" colSpan={COLS} className="px-6 py-1.5 text-left text-[12px] font-semibold text-ink-2">{b.branch} · {b.rows.length}</th></tr>,
                ...b.rows.map((r) => <Row key={r.id} r={r} holidays={holidays} />),
              ])}
            </tbody>
          )) : (
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} holidays={holidays} />)}
            </tbody>
          )}
        </table>
      </div>
      {/* Phone: one block, a hairline between loans; each loan a few short lines, the whole block opens it. */}
      <ul className="overflow-hidden rounded-lg border border-line bg-white sm:hidden" aria-label="Loan files">
        {(groups ? groups.flatMap((g) => g.branches.flatMap((b) => b.rows)) : rows).map((r) => <PhoneRow key={r.id} r={r} holidays={holidays} />)}
      </ul>
    </>
  );
}

/** The shared facts of one row. */
function facts(r: LoanRow, holidays: ReadonlySet<string>) {
  const c = cardFor(r, holidays);
  return {
    c,
    product: r.productName?.trim() || "No product name",
    released: dayText(r.releasedAt),
    // The amount as in the rest of the app: ₱1,000,000 (no .00).
    amount: peso(r.amount),
    stage: listStage(r.stage),
    owner: ROLE_DEFAULTS[r.nextStep.ownerRole]?.name ?? r.nextStep.ownerRole,
  };
}

/** TAT: a chip only when due today or late (amber or red); otherwise grey text. */
function Tat({ due, deadline }: { due: ReturnType<typeof cardFor>["due"]; deadline?: string | null }) {
  if (!due) return <span className="text-[12px] text-ink-2">-</span>;
  // With the deadline date: "Due today · Nov 12", "Late by 2 days · Nov 10", "2 days left · Nov 14".
  const date = deadline ? dayText(deadline, { year: false }) : null;
  const text = date ? `${due.text} · ${date}` : due.text;
  if (!due.hot) return <span className="whitespace-nowrap text-[12px] text-ink-2" data-tat-text>{text}</span>;
  const tone = due.tone === "bad" ? "border-bad-line bg-bad-bg text-bad-fg" : "border-act-line bg-act-bg text-act-fg";
  return <span className={`inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold ${tone}`} data-tat-text>{text}</span>;
}

/**
 * The stage: the current step of the loan-file flow, by its name only (the stepper's own names, neutral in a
 * list: "Acceptance"). A stage with no step (cancelled, archived, disposed) shows its own word in grey.
 */
export function StageMark({ stage }: { stage: ReturnType<typeof listStage> }) {
  if (stage.step === null) return <span className="text-[13px] text-ink-2" data-stage-word>{stage.word}</span>;
  return <span className="text-[13px] font-semibold text-ink" data-stage-step={stage.step} data-stage-name>{stage.name}</span>;
}

function Row({ r, holidays }: { r: LoanRow; holidays: ReadonlySet<string> }) {
  const f = facts(r, holidays);
  const td = "px-3 py-2 align-middle first:pl-4 last:pr-4";
  return (
    <tr className="relative border-b border-line last:border-0 hover:bg-fill has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-navy" data-loan-row={r.pn}>
      <td className={`${td} max-w-[12rem] lg:max-w-[15rem]`} data-col="borrower">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* The whole row is the link (it covers the row); the same target as before. */}
          <Link href={`/loans/${r.pn}`} className="min-w-0 truncate font-semibold text-navy no-underline outline-none after:absolute after:inset-0 after:content-['']">
            {r.borrowerName}<span className="sr-only">, open the loan file</span>
          </Link>
          <Flags flags={f.c.flags} />
        </span>
        <span className="block truncate text-[12px] text-ink-2"><span className="font-mono">{r.pn}</span><span className="lg:hidden"> · {r.branchName || r.branch}</span></span>
      </td>
      <td className={`${td} hidden max-w-[8rem] truncate lg:table-cell`} data-col="branch">{r.branchName || r.branch}</td>
      <td className={`${td} max-w-[10rem] lg:max-w-[12rem]`} data-col="product">
        <span className="block truncate" title={f.product}>{f.product}</span>
        <span className="block truncate text-[12px] text-ink-2">{r.loanType}</span>
        {/* Under 1024px: the released date and the amount here, in place of their own columns. */}
        <span className="block text-[12px] text-ink-2 lg:hidden">{f.released} · {f.amount}</span>
      </td>
      <td className={`${td} hidden whitespace-nowrap lg:table-cell`} data-col="released">{f.released}</td>
      <td className={`${td} hidden whitespace-nowrap text-right tabular-nums lg:table-cell`} data-col="amount">{f.amount}</td>
      <td className={`${td} min-w-[7rem]`} data-col="stage"><StageMark stage={f.stage} /></td>
      <td className={`${td} whitespace-nowrap`} data-tat><Tat due={f.c.due} deadline={r.tat?.deadline} /></td>
      <td className={`${td} min-w-[8rem] text-[13px]`} data-next-step title={`Waiting for: ${f.owner}`}>{r.nextStep.label}</td>
    </tr>
  );
}

function PhoneRow({ r, holidays }: { r: LoanRow; holidays: ReadonlySet<string> }) {
  const f = facts(r, holidays);
  return (
    <li className="border-b border-line last:border-0">
      <Link href={`/loans/${r.pn}`} className="flex min-h-11 flex-col gap-0.5 px-3 py-2.5 text-inherit no-underline hover:bg-fill" data-loan-row={r.pn}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold text-navy">{r.borrowerName}</span>
          <span className="ml-auto shrink-0"><Tat due={f.c.due} deadline={r.tat?.deadline} /></span>
        </span>
        {f.c.flags.length > 0 && <Flags flags={f.c.flags} />}
        <span className="truncate text-[13px] text-ink-2"><span className="font-mono">{r.pn}</span> · {r.branchName || r.branch}</span>
        <span className="truncate text-[13px] text-ink-2">{f.product} · {r.loanType} · {f.released} · {f.amount}</span>
        <StageMark stage={f.stage} />
        <span className="text-[13px] text-ink-2" title={`Waiting for: ${f.owner}`}>{r.nextStep.label}</span>
      </Link>
    </li>
  );
}
