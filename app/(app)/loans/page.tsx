import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { loanListPage } from "@/lib/services/loan-list";
import { listUrl, parseListParams } from "@/lib/ui/loan-list";
import { accountWarnings } from "@/lib/myloans/account";
import { LoansFilterBar } from "@/components/loan/loans-filter-bar";
import { LoanListView } from "@/components/loan/loan-list-view";
import { EmptyLine } from "@/components/loan/my-loans-list";
import { MyLoansResult, Notice } from "@/components/loan/myloans-result";
import { RefreshFound } from "@/components/loan/loan-row-actions";

export const metadata: Metadata = { title: "Loans" };

type SP = Record<string, string | string[] | undefined>;

/**
 * D-059: one Loans page for every role (it replaces My loans, the admin Loans list and Find a loan). One search box
 * and a filter bar (Status, Branch, With, Late only) instead of tabs; one table (cards on a phone). What each person
 * sees is their permissions and branch access. lib/services/loan-list.ts does the work on the server.
 */
export default async function LoansPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const sp = await searchParams;
  const p = parseListParams(sp);
  // Old addresses (the tabs, Find a loan's ?fill=): the same list in the new form.
  if (["fill", "tab", "group", "by", "stage", "area", "tat", "needsAction", "classification", "loanType", "holdReason"].some((k) => sp[k] !== undefined)) redirect(listUrl(p, { page: p.page }));
  const r = await loanListPage(user, p);
  const filtered = p.status.length > 0 || !!p.branch || !!p.with || p.late;
  const warnings = r.myloans?.kind === "preview" && can(user, PERMISSIONS.SOURCE_MANAGE) ? accountWarnings(r.myloans.record) : [];

  return (
    <div className="flex w-full min-w-0 flex-col gap-3" data-loans-page>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-[22px] font-semibold leading-tight text-navy">Loans</h1>
        <p className="text-[13px] text-ink-2" role="status" data-loans-total>{r.info.total.toLocaleString("en-PH")} loan{r.info.total === 1 ? "" : "s"}{p.q ? ` for "${p.q}"` : ""}</p>
      </div>
      <LoansFilterBar params={p} counts={r.counts} branches={r.branches} autoFocus={sp.find === "1"} />
      {r.refreshPn && <RefreshFound pn={r.refreshPn} />}
      {r.badPn && (
        <Notice tone="act" pn={p.q} title={r.badPn.headline} q={p.q} data={{ "data-pn-error": "" }}>
          <span data-pn-part>{r.badPn.message}</span>
        </Notice>
      )}
      {r.rows.length > 0 && <LoanListView result={r} params={p} />}
      {r.myloans && <MyLoansResult r={r.myloans} q={p.q} warnings={warnings} />}
      {r.rows.length === 0 && !r.myloans && !r.badPn && (
        <EmptyLine
          text={p.q ? `No loans match "${p.q}"${filtered ? " with these filters" : ""}.` : filtered ? "No loans match these filters." : "No open loans in your branches."}
          clearHref={filtered ? listUrl(p, { status: [], branch: null, with: null, late: false }) : undefined}
          note={p.q && !can(user, PERMISSIONS.LOANS_SEARCH) ? "Only the loan files of your branches are searched." : p.q ? "Names and parts of a PN are searched in the DMS only. Type the full PN to look it up in myloans." : undefined}
        />
      )}
    </div>
  );
}
