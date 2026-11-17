import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { TAT_SHOW, liquidationSummary, reasonReport, tatReport } from "@/lib/services/tat-report";
import { ReasonTable } from "@/components/jobs/reason-table";
import { PageTop } from "@/components/loan/page-top";
import { JobRow } from "@/components/jobs/job-row";
import { tatByPerson, type PersonTat } from "@/lib/services/work-items";

export const metadata: Metadata = { title: "TAT and problems" };

export default async function TatReportPage({ searchParams }: { searchParams: Promise<{ branch?: string; type?: string; stage?: string; show?: string; outside?: string; from?: string; to?: string; ftype?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.REPORTS_TAT);
  const sp = await searchParams;
  const [{ rows, all }, reasons, liq, people] = await Promise.all([tatReport(user, sp), reasonReport(user, sp), liquidationSummary(user, sp), tatByPerson(user, { from: sp.from, to: sp.to })]);
  const tatPeople = people.filter((p) => p.measure === "TAT");
  const actPeople = people.filter((p) => p.measure === "WAITING");
  // Branch choices: the name only (also the filter value), "Antipolo".
  const branches = [...new Map(all.map((r) => [r.branch, r.branch])).entries()].sort(([a], [z]) => a.localeCompare(z));
  const types = [...new Map(all.map((r) => [r.typeCode, r.typeName])).entries()];
  const stageNames = [...new Set(all.map((r) => r.stage).filter((x): x is string => !!x))].sort();
  // Funds types on these jobs, with counts (the filter and its numbers).
  const fundsTypes = [...new Map(all.filter((r) => r.fundsType).map((r) => [r.fundsType!.code, r.fundsType!.name])).entries()];
  const fundsCount = (code: string) => all.filter((r) => r.fundsType?.code === code).length;
  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageTop
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "TAT and problems" }]}
        back={{ label: "Home", href: "/dashboard" }}
        title="TAT and problems"
        subtitle="The turnaround clock never pauses. Problem time is the sum of each problem's business days."
      />
      <form action="/reports/tat" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_auto_auto] lg:items-end">
        <div>
          <label htmlFor="ts" className="label">Show</label>
          <select id="ts" name="show" defaultValue={sp.show ?? "attention"} className="input">
            {TAT_SHOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tb" className="label">Branch</label>
          <select id="tb" name="branch" defaultValue={sp.branch ?? ""} className="input">
            <option value="">All</option>
            {branches.map(([b, label]) => <option key={b} value={b}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tt" className="label">Transaction</label>
          <select id="tt" name="type" defaultValue={sp.type ?? ""} className="input">
            <option value="">All</option>
            {types.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tft" className="label">Funds type</label>
          <select id="tft" name="ftype" defaultValue={sp.ftype ?? ""} className="input">
            <option value="">All</option>
            {fundsTypes.map(([c, n]) => <option key={c} value={c}>{c} · {n} ({fundsCount(c)})</option>)}
            <option value="none">No funds record</option>
          </select>
        </div>
        <div>
          <label htmlFor="tsg" className="label">Stage</label>
          <select id="tsg" name="stage" defaultValue={sp.stage ?? ""} className="input">
            <option value="">All</option>
            <option value="-">Not started</option>
            {stageNames.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tf" className="label">Raised from</label>
          <input id="tf" type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="tto" className="label">Raised to</label>
          <input id="tto" type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" name="outside" value="1" defaultChecked={sp.outside === "1"} className="h-5 w-5 accent-[var(--navy)]" /> Outside our control only
        </label>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>
      <section aria-labelledby="by-reason" className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4 sm:px-6">
          <h2 id="by-reason" className="text-lg font-bold text-navy">Problems and holds by reason</h2>
        </div>
        <p className="px-4 pb-2 text-[13px] text-ink-2 sm:px-6">Average days are working days (Sundays, holidays and office closures skipped); open ones count to today. Dates are Philippine time.</p>
        <ReasonTable rows={reasons} caption="Problems and holds by reason" />
      </section>
      <section aria-labelledby="liq-h" className="card px-4 py-4 sm:px-6" data-liquidation-summary>
        <h2 id="liq-h" className="text-lg font-bold text-navy">Liquidations</h2>
        {liq.total === 0 ? <p className="mt-1 text-[15px] text-ink-2">No advance liquidated in these dates.</p> : (
          <>
            <p className="mt-1 text-[15px]"><strong>{liq.onTime}</strong> on time · <strong>{liq.late}</strong> late{liq.avgDaysLate !== null ? ` (${liq.avgDaysLate} working days late on average)` : ""}</p>
            {liq.worst.length > 0 && <p className="mt-1 text-[13px] text-ink-2">Latest: {liq.worst.map((w) => `${w.number} ${w.daysLate} day${w.daysLate === 1 ? "" : "s"}`).join(" · ")}</p>}
          </>
        )}
        <p className="mt-1 text-[13px] text-ink-2">Due a set number of working days after the last LTO pickup (Settings, Funds types). Days late: the working days after the due date, up to the day it was liquidated.</p>
      </section>
      <section aria-labelledby="per-person" className="card overflow-hidden" data-tat-per-person>
        <div className="px-4 pb-2 pt-4 sm:px-6">
          <h2 id="per-person" className="text-lg font-bold text-navy">By person</h2>
          <p className="text-[13px] text-ink-2">Each round counts for the person who held it: from Accept to Forward, Return or Done, less paused days. Waiting in a pool is not counted. A round moved to someone else is &ldquo;Moved (away)&rdquo;, never late. Items made from older records with a time missing (&ldquo;Migrated&rdquo;) are left out.</p>
        </div>
        <PeopleTable rows={tatPeople} caption="Turnaround time by person (from accept)" usedLabel="Average TAT used" />
        {actPeople.length > 0 && (
          <>
            <h3 className="px-4 pt-4 text-[15px] font-bold text-navy sm:px-6">Time to act (from arrival)</h3>
            <p className="px-4 text-[13px] text-ink-2 sm:px-6">Finance&rsquo;s Approve and Release, and the receiving LA&rsquo;s Receive count as accepting: these are measured from when the item arrived.</p>
            <PeopleTable rows={actPeople} caption="Time to act by person (from arrival)" usedLabel="Average time to act" />
          </>
        )}
      </section>
      <section aria-label="Jobs" className="card overflow-hidden">
        {rows.length === 0 ? <p className="px-4 py-5 text-[15px] text-ink-2">Nothing matches.</p> : rows.map((r) => <JobRow key={r.id} r={r} showDp />)}
      </section>
    </div>
  );
}

function PeopleTable({ rows, caption, usedLabel }: { rows: PersonTat[]; caption: string; usedLabel: string }) {
  if (!rows.length) return <p className="px-4 pb-4 text-[15px] text-ink-2 sm:px-6">No finished rounds in these dates.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-[13px] text-ink-2">
            <th scope="col" className="px-4 py-2 font-semibold sm:px-6">Person</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Rounds</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">{usedLabel}</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Late</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Returned</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold sm:px-6">Moved (away)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.userId}-${r.measure}`} className="border-b border-line-soft last:border-0" data-person-row={r.name}>
              <th scope="row" className="px-4 py-2 font-semibold text-navy sm:px-6">{r.name}</th>
              <td className="px-2 py-2 text-right">{r.rounds}</td>
              <td className="px-2 py-2 text-right">{r.avgUsed === null ? "-" : `${r.avgUsed} working day${r.avgUsed === 1 ? "" : "s"}`}</td>
              <td className={`px-2 py-2 text-right ${r.late ? "font-semibold text-bad-fg" : ""}`}>{r.late}</td>
              <td className="px-2 py-2 text-right">{r.returns}</td>
              <td className="px-4 py-2 text-right sm:px-6">{r.moved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
