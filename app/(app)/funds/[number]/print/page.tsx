import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { inScope, requirePageAny } from "@/lib/auth/current-user";
import { anyStepKeys, stepKeys } from "@/lib/funds/access";
import { liquidationReportAccess } from "@/lib/services/funds";
import { permissionLabel } from "@/lib/auth/permissions";
import { peso } from "@/lib/funds/rules";
import { allKinds, lineKindText } from "@/lib/services/expense-kinds";
import { releaseLine } from "@/lib/funds/types";
import { dayText } from "@/lib/ui/plain";
import { APP_TIMEZONE } from "@/lib/time";
import { DASH } from "@/lib/funds/list-view";
import { PrintButton } from "@/components/funds/print-button";

/** The title names the request, so a saved PDF says which one it is. */
export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  return { title: `Liquidation report ${decodeURIComponent((await params).number)}` };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{label}</dt><dd className="break-words text-[13px] font-semibold text-ink">{children}</dd></div>;
}

const STATUS: Record<string, string> = { LIQUIDATED: "Liquidated", CLOSED: "Closed" };

/**
 * Funds: the liquidation report of one request, in the GDFI print format (A4 portrait): header with the
 * logo, the request, the expenses with what was released and liquidated, the receipts, the returned cash,
 * the totals and three signature lines. Read only; printing changes nothing.
 * Needs "Print liquidation report" (funds:print) and the request's usual visibility (the Funds page's
 * "See all advances" and the person's branches). A number the request had before (CA- for a fund
 * transfer, or before a type change) opens the request under its number now.
 */
export default async function LiquidationPrintPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requirePageAny(anyStepKeys("view"));
  const number = decodeURIComponent((await params).number);
  const renamed = await prisma.cashAdvance.findFirst({ where: { formerNumbers: { has: number } }, select: { number: true, branchId: true } });
  if (renamed && inScope(user, renamed.branchId)) redirect(`/funds/${encodeURIComponent(renamed.number)}/print`);
  const a = await prisma.cashAdvance.findUnique({
    where: { number },
    include: {
      requestedBy: { select: { name: true } },
      branch: { select: { name: true } },
      lines: { include: { transaction: { include: { loan: { select: { pn: true, borrowerName: true } }, type: { select: { name: true } } } }, receipts: { orderBy: { date: "asc" } } } },
      returns: { orderBy: { date: "asc" } },
    },
  });
  const access = liquidationReportAccess(user, a);
  if (!a || access === "not-found") notFound();
  // The tick for this request's own type ("Print liquidation report for fund transfers").
  if (access === "refused") return <PrintRefused label={permissionLabel(stepKeys("print", a)[0])} />;
  const people = await prisma.user.findMany({ where: { id: { in: [a.approvedById, a.releasedById, a.closedById, ...a.returns.map((r) => r.confirmedById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const who = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const names = new Map((await allKinds()).map((k) => [k.code, k.name]));
  const receipts = a.lines.flatMap((l) => l.receipts.map((r) => ({ r, l })));
  const liquidated = receipts.reduce((s, x) => s + x.r.cents, 0);
  const returned = a.returns.reduce((s, r) => s + r.cents, 0);
  const balance = a.releasedCents - liquidated - returned;
  const transfer = !!(a.releaseRef && (a.transferDate || a.accountLast4));
  const printedAt = new Intl.DateTimeFormat("en-PH", { timeZone: APP_TIMEZONE, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const loanOf = (l: (typeof a.lines)[number]) => (l.transaction ? `${l.transaction.loan.borrowerName} · ${l.transaction.loan.pn} · ${l.transaction.type.name}` : l.note || DASH);

  return (
    <div className="w-full scroll-mt-24 pt-1" data-report-page>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Liquidation report</h1>
          <p className="muted">{a.number}: check it, then print. Printing changes nothing.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/funds?tab=${a.status === "CLOSED" ? "history" : "outstanding"}#${a.number}`} className="btn-ghost">Back to Funds</Link>
          <PrintButton />
        </div>
      </div>

      <article className="print-sheet" data-liquidation-report={a.number}>
        <header className="flex flex-wrap items-start justify-between gap-4" data-report-header>
          <div className="flex items-center gap-3">
            <Image src="/logo.jpg" alt="GDFI logo" width={48} height={48} className="rounded-md" />
            <div>
              <p className="text-[15px] font-bold text-navy">Global Dominion Financing, Inc.</p>
              <p className="text-[12px] text-ink-2">Loan Document Management System · Finance</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide text-navy">Liquidation report</p>
            <p className="font-mono text-[13px] font-semibold">{a.number}</p>
            <p className="text-[12px] text-ink-2">{a.fundsTypeCode} · {a.fundsTypeName} · {STATUS[a.status]}</p>
          </div>
        </header>
        {/* One divider: a single solid line (navy on screen, black on paper), never two lines stacked. */}
        <div className="print-divider" aria-hidden="true" data-report-divider />

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3 print:grid-cols-3">
          <Field label="Requested by">{a.requestedBy.name}</Field>
          <Field label="Branch">{a.branch.name}</Field>
          <Field label="Asked">{dayText(a.createdAt)}</Field>
          <Field label="Approved by">{who(a.approvedById) ?? DASH}{a.approvedAt ? `, ${dayText(a.approvedAt)}` : ""}</Field>
          <Field label={transfer ? "Sent" : "Released"}>{dayText(a.releasedAt)}{who(a.releasedById) ? ` by ${who(a.releasedById)}` : ""}</Field>
          <Field label="Reference">{releaseLine(a) || DASH}</Field>
          {a.liquidationDueAt && <Field label="Liquidate by">{dayText(a.liquidationDueAt)}</Field>}
          {a.status === "CLOSED" && <Field label="Closed">{dayText(a.closedAt)}{who(a.closedById) ? ` by ${who(a.closedById)}` : ""}</Field>}
          {a.note && <div className="sm:col-span-3 print:col-span-3"><Field label="Note">{a.note}</Field></div>}
        </dl>

        <h2 className="print-h2">Expenses</h2>
        <div className="print-scroll"><table className="print-table">
          <thead><tr><th>Expense</th><th>Loan</th><th className="num">Released</th><th className="num">Receipts</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {a.lines.map((l) => {
              const spent = l.receipts.reduce((s, r) => s + r.cents, 0);
              const out = l.releasedCents || (l.approvedCents ?? 0);
              return (
                <tr key={l.id}>
                  <td className="font-semibold">{lineKindText(names, l)}</td>
                  <td>{loanOf(l)}</td>
                  <td className="num">{l.denied ? "Not approved" : peso(out)}</td>
                  <td className="num">{peso(spent)}</td>
                  <td className="num">{peso(out - spent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>

        <h2 className="print-h2">Receipts</h2>
        {receipts.length === 0 ? <p className="text-[13px] text-ink-2">No receipts.</p> : (
          <div className="print-scroll"><table className="print-table">
            <thead><tr><th>Date</th><th>Receipt no.</th><th>Expense</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {receipts.map(({ r, l }) => (
                <tr key={r.id}><td>{dayText(r.date)}</td><td className="font-mono">{r.number}</td><td>{lineKindText(names, l)}</td><td className="num">{peso(r.cents)}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}

        {a.returns.length > 0 && (
          <>
            <h2 className="print-h2">Cash returned</h2>
            <div className="print-scroll"><table className="print-table">
              <thead><tr><th>Date</th><th>How</th><th>Confirmed by Finance</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {a.returns.map((r) => (
                  <tr key={r.id}><td>{dayText(r.date)}</td><td>{r.kind === "HANDOVER" ? "Handed to another processor" : "Cash returned"}</td><td>{r.confirmedAt ? `${who(r.confirmedById) ?? DASH}, ${dayText(r.confirmedAt)}` : "Not confirmed yet"}</td><td className="num">{peso(r.cents)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}

        {/* The totals and the signatures stay together on one page. */}
        <div className="print-keep">
        <div className="mt-5 flex justify-end">
          <dl className="print-totals" data-print-totals>
            <dt>{transfer ? "Sent" : "Released"}</dt><dd>{peso(a.releasedCents)}</dd>
            <dt>Liquidated (receipts)</dt><dd>{peso(liquidated)}</dd>
            <dt>Returned</dt><dd>{peso(returned)}</dd>
            <div className="print-total-row"><dt>Balance</dt><dd data-print-balance>{peso(balance)}</dd></div>
          </dl>
        </div>

        <section className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3 print:grid-cols-3" aria-label="Signatures">
          {[["Liquidated by", a.requestedBy.name], ["Checked by (Finance)", who(a.closedById) ?? ""], ["Approved by", who(a.approvedById) ?? ""]].map(([role, name]) => (
            <div key={role} className="text-center">
              <div className="h-10 border-b border-ink" />
              <p className="mt-1 text-[13px] font-semibold">{name || " "}</p>
              <p className="text-[11px] text-ink-2">{role} · signature over printed name · date</p>
            </div>
          ))}
        </section>
        </div>

        <footer className="mt-8 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-[10px] text-ink-2">
          <span data-printed-by>Printed by {user.name}, {printedAt} (Philippine time) · GDFI DMS</span>
          <span>{a.number}</span>
        </footer>
      </article>
    </div>
  );
}

/** The normal refusal: the role does not have "Print liquidation report". Nothing about the request is shown. */
function PrintRefused({ label }: { label: string }) {
  return (
    <div className="w-full pt-1" data-print-refused>
      <h1 className="page-title">Liquidation report</h1>
      <div role="alert" className="mt-3 rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink">
        <p className="font-semibold text-navy">You can&rsquo;t open this report.</p>
        <p className="mt-1 text-ink-2">Ask an Admin to turn on &lsquo;{label}&rsquo; for your role.</p>
      </div>
      <Link href="/funds" className="btn-ghost mt-4">Back to Funds</Link>
    </div>
  );
}
