import Link from "next/link";
import type { JobRow as Row } from "@/lib/services/job-queries";
import { txnName } from "@/lib/ui/plain";
import { Avatar } from "@/components/ui/basics";
import { FundsChip, TatChip } from "./chips";

/** One job: borrower, PN and transaction; TAT chip; funds; the problem in words. The whole row is a link. */
export function JobRow({ r, showDp = false }: { r: Row; showDp?: boolean }) {
  return (
    <Link
      href={`/jobs/${r.id}`}
      data-job={r.id}
      className={`flex items-start gap-3 border-t border-[rgb(12_35_64/0.1)] px-4 py-3 text-inherit no-underline first:border-t-0 hover:bg-fill sm:items-center sm:px-5 ${r.problem ? "border-l-4 border-l-[var(--bad-fg)]" : r.hold ? "border-l-4 border-l-navy" : ""}`}
    >
      <span className="hidden sm:block"><Avatar name={r.borrower} size={40} /></span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block truncate text-[15px] font-semibold sm:text-base">{r.borrower}</span>
        <span className="block text-[13px] text-ink-2">
          {r.pn} · {txnName(r.typeCode, r.typeName)} · {r.branch}{showDp ? ` · ${r.dpName}` : ""}
        </span>
        {r.replaces && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2" data-replacement><span className="chip c-navy">Replacement</span>of {r.replaces}: its own turnaround time</span>}
        {r.pasuyo && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2"><span className="chip c-wait">Pasuyo</span>{r.pasuyo}</span>}
        {r.problem && <span className="block text-[13px] font-semibold text-bad-fg">Problem: {r.problem.reason}{r.problem.outsideControl ? " · Outside our control" : ""}</span>}
        {r.hold && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-navy" data-hold-chip><span className="chip c-navy">On hold</span>{r.hold.reason}</span>}
        {r.incomplete && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-act-fg"><span className="chip c-act">Package incomplete</span>{r.incomplete}</span>}
        {r.returnedHow && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2" data-returned-chip><span className="chip c-wait">{r.returnedHow}</span></span>}
        {r.stage && <span className="block text-[13px] text-ink-2" data-job-stage>Stage: {r.stage}</span>}
        <span className="mt-1 flex flex-wrap gap-1.5 md:hidden">
          <TatChip data={r.tat} />
          {r.funds !== "NOT_NEEDED" && <FundsChip status={r.funds} />}
        </span>
      </span>
      <span className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 md:flex md:max-w-[50%]">
        {r.funds !== "NOT_NEEDED" && <FundsChip status={r.funds} />}
        <TatChip data={r.tat} />
      </span>
    </Link>
  );
}
