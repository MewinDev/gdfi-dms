import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, inScope, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { completePn } from "@/lib/services/find-local";
import { lookupPn } from "@/lib/services/loan-file";
import { accountWarnings } from "@/lib/myloans/account";
import { getCalendar } from "@/lib/calendar/load";
import { daysFor } from "@/lib/calendar/core";
import { poolArrival, poolSinceText, waitingDays } from "@/lib/work/rules";
import { businessDate, fmtDateTime } from "@/lib/time";
import { dayText, peso } from "@/lib/ui/plain";
import { PageTop } from "@/components/loan/page-top";
import { MyLoansResult, Preview } from "@/components/loan/myloans-result";
import { CopyButton } from "@/components/ui/copy-button";
import { AlertIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Loan preview" };

const OPEN = ["POOL", "INBOX", "HELD"];

/**
 * D-060: the preview of a released loan that is not a loan file in the DMS yet (a branch pool item, or a full PN found
 * only in myloans). What myloans says now (API 1, logged; Refresh asks again): the borrower, PN, CIN, branch, product,
 * loan type, classification, amount, release date and status in myloans, and how long it has waited in the pool. Open
 * loan file (for people who may open loan files) creates the loan file, gives it to that person with their TAT started,
 * and takes the item out of the pool. If myloans says it is no longer released, the reason card shows instead and there
 * is no Open. Outside the person's branches: not found. Already a loan file: its loan file (or, right after someone
 * else opened it, who and when).
 */
export default async function LoanPreviewPage({ params, searchParams }: { params: Promise<{ pn: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const [{ pn: raw }, sp] = await Promise.all([params, searchParams]);
  const pn = await completePn(decodeURIComponent(raw));
  if (!pn) notFound();

  // Already a loan file: out of scope is not found; else its loan file, or (just lost the race) who opened it.
  const loan = await prisma.loan.findUnique({ where: { pn }, select: { branchId: true, borrowerName: true, openedAt: true, openedBy: { select: { name: true } } } });
  if (loan) {
    if (!inScope(user, loan.branchId)) notFound();
    if (sp.taken !== "1") redirect(`/loans/${pn}`);
    return (
      <div className="flex w-full min-w-0 flex-col gap-4" data-loan-preview={pn}>
        <PageTop crumbs={[{ label: "Loans", href: "/loans" }, { label: pn }]} back={{ label: "Loans", href: "/loans" }} title="Loan preview" subtitle="Released in myloans, not yet a loan file in the DMS" />
        <section role="alert" className="flex items-center gap-3 rounded-xl border border-act-line bg-act-bg px-4 py-3" data-preview-taken>
          <span className="text-act-fg"><AlertIcon size={18} /></span>
          <p className="min-w-0 flex-1 text-[15px] text-navy">
            <strong>Already opened by {loan.openedBy.name}</strong> at {fmtDateTime(loan.openedAt)}. Nothing else was created.
          </p>
          <Link href={`/loans/${pn}`} className="btn-navy btn-sm shrink-0">View it</Link>
        </section>
      </div>
    );
  }

  // The branch pool item (if any): another branch's is not found.
  const item = await prisma.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: pn, state: { in: OPEN } }, select: { branchId: true, arrivedAt: true } });
  if (item && !inScope(user, item.branchId)) notFound();

  // What myloans says now (one API 1 call, logged). Without the search permission: the pool's own copy only.
  const r = can(user, PERMISSIONS.LOANS_SEARCH) ? await lookupPn(user, pn) : null;
  if (r?.kind === "refused" && r.field === "branch") notFound();
  if (r?.kind === "existing") redirect(`/loans/${pn}`);

  // D-060: in the pool since its arrival, counted in working days, and never before the release date: if myloans now
  // gives a later release date than the pool item knows (corrected after the last sync), the release date is the start.
  let waiting: string | null = null;
  if (item) {
    const days = daysFor(await getCalendar(), item.branchId);
    const live = r?.kind === "preview" && r.record.releaseDate ? new Date(r.record.releaseDate) : null;
    const since = poolArrival(item.arrivedAt, live && !Number.isNaN(live.getTime()) ? live : null);
    waiting = poolSinceText(dayText(since, { year: false }), waitingDays(businessDate(since), businessDate(new Date()), days));
  }
  const cand = !r || r.kind !== "preview" ? await prisma.sourceLoanCandidate.findFirst({ where: { pn }, orderBy: { lastSeenAt: "desc" } }) : null;
  if (!r && !item) notFound();
  const warnings = r?.kind === "preview" && can(user, PERMISSIONS.SOURCE_MANAGE) ? accountWarnings(r.record) : [];

  return (
    <div className="flex w-full min-w-0 flex-col gap-4" data-loan-preview={pn}>
      <PageTop crumbs={[{ label: "Loans", href: "/loans" }, { label: pn }]} back={{ label: "Loans", href: "/loans" }} title="Loan preview" subtitle="Released in myloans, not yet a loan file in the DMS" />
      {sp.refreshed && <p role="status" className="text-[13px] text-ink-2" data-preview-refreshed>Refreshed from myloans just now.</p>}
      {r?.kind === "preview" ? (
        <Preview r={r} warnings={warnings} waiting={waiting} page />
      ) : r && r.kind !== "invalid" ? (
        // No longer released (cancelled, redone, not released), not found, or myloans busy: the reason, no Open.
        <>
          {waiting && <p className="text-sm text-ink-2" data-preview-waiting>{waiting}</p>}
          <MyLoansResult r={r} q={pn} warnings={[]} />
        </>
      ) : (
        // No myloans search permission: the pool's own copy (from the sync), no Open.
        <section className="card min-w-0 p-4 sm:px-5" data-preview-pool-copy>
          <h2 className="text-lg font-bold text-navy">{cand?.borrowerName ?? "-"}</h2>
          <p className="flex items-center gap-1.5"><span className="font-mono text-sm text-ink-2">{pn}</span><CopyButton text={pn} label={`Copy PN ${pn}`} /></p>
          {waiting && <p className="mt-2 text-sm text-ink-2" data-preview-waiting>{waiting}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-4">
            {([["CIN", cand?.cin ?? "-"], ["Branch", cand?.branchName ?? "-"], ["Product", cand?.productName ?? "-"], ["Amount released", cand?.amount ? peso(Number(cand.amount)) : "-"], ["Released on", cand ? dayText(cand.releaseDate) : "-"]] as const).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-ink-2">{k}</dt><dd className="break-words text-[15px] font-semibold text-navy">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-[13px] text-ink-2">From the last myloans sync. A Loan Associate opens its loan file.</p>
        </section>
      )}
    </div>
  );
}
