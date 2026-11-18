import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtShort } from "@/lib/time";
import { PN_OUTCOMES, listPnSearches, type PnOutcome } from "@/lib/services/pn-search-log";
import { PageTop } from "@/components/loan/page-top";

export const metadata: Metadata = { title: "PN searches" };

/** Reports, PN searches (D-050): every PN # searched on Find loan, within the reader's branches. Newest first. */
export default async function PnSearchesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; pn?: string; outcome?: string; who?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.REPORTS_PNSEARCH);
  const sp = await searchParams;
  const { rows, total } = await listPnSearches(user, sp);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => !!v) as [string, string][]).toString();
  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageTop
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "PN searches" }]}
        back={{ label: "Home", href: "/dashboard" }}
        title="PN searches"
        subtitle="Every PN # searched on Find loan: who, what myloans answered, when (Philippine time). Within your branches."
      />
      <form action="/reports/pn-searches" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto_auto] lg:items-end">
        <div><label htmlFor="ps-pn" className="label">PN #</label><input id="ps-pn" name="pn" defaultValue={sp.pn ?? ""} className="input" /></div>
        <div><label htmlFor="ps-who" className="label">Who</label><input id="ps-who" name="who" defaultValue={sp.who ?? ""} className="input" /></div>
        <div>
          <label htmlFor="ps-o" className="label">Outcome</label>
          <select id="ps-o" name="outcome" defaultValue={sp.outcome ?? ""} className="input">
            <option value="">All</option>
            {Object.entries(PN_OUTCOMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div><label htmlFor="ps-f" className="label">From</label><input id="ps-f" type="date" name="from" defaultValue={sp.from ?? ""} className="input" /></div>
        <div><label htmlFor="ps-t" className="label">To</label><input id="ps-t" type="date" name="to" defaultValue={sp.to ?? ""} className="input" /></div>
        <button type="submit" className="btn-secondary">Filter</button>
        <a href={`/api/reports/pn-searches${qs ? `?${qs}` : ""}`} className="btn-ghost" data-pn-csv>Download CSV</a>
      </form>
      <section aria-label="PN searches" className="card overflow-hidden" data-pn-searches>
        <p className="px-4 pt-3 text-[13px] text-ink-2 sm:px-5">
          {total === 0 ? "No searches match." : `${total} search${total === 1 ? "" : "es"}${total > rows.length ? `, the newest ${rows.length} shown (Download CSV has all)` : ""}.`}
        </p>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <caption className="sr-only">PN searches</caption>
              <thead>
                <tr className="border-b border-line text-[13px] text-ink-2">
                  <th scope="col" className="px-4 py-2 font-semibold sm:px-5">When</th>
                  <th scope="col" className="px-2 py-2 font-semibold">PN #</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Outcome</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Who</th>
                  <th scope="col" className="px-4 py-2 font-semibold sm:px-5">myloans</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-0" data-pn-search={r.pn} data-outcome={r.outcome}>
                    <td className="px-4 py-2 sm:px-5">{fmtShort(r.at)}</td>
                    <td className="px-2 py-2 font-mono">{r.pn}</td>
                    <td className="px-2 py-2">{PN_OUTCOMES[r.outcome as PnOutcome] ?? r.outcome}</td>
                    <td className="px-2 py-2">{r.userLabel}</td>
                    <td className="px-4 py-2 text-ink-2 sm:px-5">{[r.feedState, r.statusId ? `status ${r.statusId}` : null].filter(Boolean).join(" · ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
