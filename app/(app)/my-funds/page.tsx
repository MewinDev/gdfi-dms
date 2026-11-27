import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { notifyOverdue } from "@/lib/services/funds";
import { myFunds } from "@/lib/services/my-funds";
import { filterFunds, fundsListUrl, parseFundsParams, type FundsRowStatus } from "@/lib/funds/my-list";
import { InfoTip } from "@/components/ui/info-tip";
import { MyFundsView } from "@/components/funds/my-funds-view";

export const metadata: Metadata = { title: "My funds" };

/** Old tab addresses: the same list in the new form (Request: jobs that need funds; Liquidation: what is to liquidate). */
const OLD_TABS: Record<string, FundsRowStatus[]> = { request: ["needs"], advances: [], liquidation: ["released", "liquidate", "overdue"] };

/**
 * D-065: the processor's My funds, the same design as Loans and Jobs: one list (one row per job that needs funds and
 * per advance line) with status chips and counts (none chosen: every open one), one search, Filters that apply at once
 * (Type, Transaction, Late only, Sort), overdue liquidation first, then the soonest due. Request funds and the details
 * (receipt confirmation, liquidation, return) open in the side panel.
 */
export default async function MyFundsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission(PERMISSIONS.FUNDS_REQUEST);
  await notifyOverdue();
  const sp = await searchParams;
  const p = parseFundsParams(sp);
  if (typeof sp.tab === "string" && sp.tab in OLD_TABS) redirect(fundsListUrl({ ...p, status: OLD_TABS[sp.tab] }));
  const f = await myFunds(user);
  const { rows, counts } = filterFunds(f.rows, p);
  const txns = [...new Map(f.rows.filter((r) => r.txnCode).map((r) => [r.txnCode!, r.txnName ?? r.txnCode!])).entries()].map(([code, name]) => ({ code, name }));

  return (
    <div className="dense funds-compact flex w-full min-w-0 flex-col gap-3" data-my-funds-page>
      <header className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight text-navy">My funds</h1>
        <p className="relative mt-0.5 flex items-center gap-1 text-[13px] text-ink-2">
          Your cash for jobs: request, receive, liquidate.
          <InfoTip label="About the funds statuses" data="funds" lines={[
            { text: "Needs funds = a job of yours needs cash; request it.", data: "needs" },
            { text: "Requested / Approved = Finance is deciding / will release it.", data: "requested" },
            { text: "Released = the cash is yours; the liquidation clock starts at the LTO pickup.", data: "released" },
            { text: "To liquidate / Overdue = add the receipts and return the change by the due date.", data: "liquidate" },
            { text: "Liquidated = done. Returned/cancelled = not approved or cancelled.", data: "done" },
          ]} />
        </p>
      </header>
      {f.exceptionNote && <p role="status" className="rounded-lg bg-wait-bg px-3 py-2 text-[13px] text-wait-fg" data-exception-note>{f.exceptionNote}</p>}
      <MyFundsView rows={rows} details={f.details} params={p} counts={counts} txns={txns} today={f.today}
        request={{ jobs: f.jobs, blocked: f.blocked, types: f.types, defaultTypeId: f.defaultTypeId, kinds: f.kinds, canAddKind: f.canAddKind }} />
    </div>
  );
}
