import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireUser, scopeIds } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import { OI_FIELDS, statusOutcome, type FeedStateWord, type OpenItemField } from "@/lib/open-items/fields";
import { openItemsFor, ruleGroupEffect, seesUnassigned, outstandingCash, type Tab } from "@/lib/services/open-items";
import { PageHeader } from "@/components/ui/basics";
import { CashBackForm, DecideForm, MoveCashForm } from "@/components/open-items/decide-form";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { CopyButton } from "@/components/ui/copy-button";

export const metadata: Metadata = { title: "Open Items" };

type Row = Awaited<ReturnType<typeof openItemsFor>>[number];
const TONE = { ok: "c-ok", act: "c-act", bad: "c-bad" } as const;
const STATUS_TEXT: Record<string, string> = { APPROVED: "Approved", REJECTED: "Rejected", SUPERSEDED: "Superseded", REVERTED: "Reverted in myloans", PENDING: "Pending" };

/**
 * Open Items (piece 8; D-010, D-011, D-053): myloans changes to loan and borrower fields, waiting for an approver of
 * the loan's branch. Oldest first, with the waiting time in working days (the inbox colours). Loan type, amount,
 * product and release date are decided together, with what the rules would do. Unassigned: branches with no
 * approver of their own (the Superadmin and All-branches approvers see them).
 */
export default async function OpenItemsPage({ searchParams }: { searchParams: Promise<{ tab?: string; pn?: string; branch?: string; field?: string }> }) {
  const user = await requireUser();
  const approver = can(user, PERMISSIONS.SOURCE_REVIEW) || can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER);
  const unassignedToo = seesUnassigned(user);
  if (!approver && !unassignedToo) notFound();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "decided" ? "decided" : sp.tab === "unassigned" && unassignedToo ? "unassigned" : "mine";
  const filter = { pn: sp.pn || undefined, branchId: sp.branch || undefined, field: sp.field && sp.field in OI_FIELDS ? sp.field : undefined };
  const [mine, unassigned, rows] = await Promise.all([
    openItemsFor(user, "mine", filter), unassignedToo ? openItemsFor(user, "unassigned", filter) : Promise.resolve([] as Row[]),
    tab === "decided" ? openItemsFor(user, "decided", filter) : Promise.resolve(null),
  ]);
  const list = rows ?? (tab === "unassigned" ? unassigned : mine);
  const seesAmounts = can(user, PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
  // D-062: the loan's amount (an Open Item on the amount field) needs "See loan amounts"; cash still needs the Journey tick.
  const seesLoanAmounts = can(user, PERMISSIONS.LOANS_VIEW_AMOUNTS);
  const scope = scopeIds(user);
  const branches = await prisma.branch.findMany({ where: { active: true, ...(scope === null ? {} : { id: { in: scope } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const q = (t: Tab) => `/open-items?${new URLSearchParams({ tab: t, ...(sp.pn ? { pn: sp.pn } : {}), ...(sp.branch ? { branch: sp.branch } : {}), ...(sp.field ? { field: sp.field } : {}) }).toString()}`;
  const tabs: { key: Tab; label: string; n?: number; red?: number }[] = [
    { key: "mine", label: "Mine", n: mine.length, red: mine.filter((r) => r.tone === "bad").length },
    ...(unassignedToo ? [{ key: "unassigned" as const, label: "Unassigned", n: unassigned.length, red: unassigned.filter((r) => r.tone === "bad").length }] : []),
    { key: "decided", label: "Decided" },
  ];
  const value = (r: Pick<Row, "field" | "oldValue" | "newValue">, v: "oldValue" | "newValue") => (r.field === "amount" && !seesLoanAmounts ? "Amount changed" : r[v] ?? "blank");

  return (
    <div className="dense flex w-full flex-col gap-4" data-open-items-page>
      <PageHeader title="Open Items" help="myloans changed these loans. Nothing changes in the DMS until you approve. Reject keeps the DMS value. Oldest first." />
      <ScrollFade><nav aria-label="Open Items tabs" className="flex overflow-x-auto border-b border-line" data-scroll-row>
        {tabs.map((t) => (
          <Link key={t.key} href={q(t.key)} aria-current={tab === t.key ? "page" : undefined} className="tab shrink-0" data-oi-tab={t.key}>
            {t.label}{t.n !== undefined && <span className="ml-1 text-ink-2">{t.n}</span>}
            {t.red ? <span className="chip c-bad ml-2">{t.red} waiting too long</span> : null}
          </Link>
        ))}
      </nav></ScrollFade>
      <form className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap" data-oi-filter>
        <input type="hidden" name="tab" value={tab} />
        <div className="col-span-2 flex flex-col gap-1"><label htmlFor="oi-pn" className="label">PN</label><input id="oi-pn" name="pn" defaultValue={sp.pn ?? ""} className="input sm:w-48" /></div>
        <div className="flex flex-col gap-1"><label htmlFor="oi-branch" className="label">Branch</label>
          <select id="oi-branch" name="branch" defaultValue={sp.branch ?? ""} className="input"><option value="">All</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label htmlFor="oi-field" className="label">Field</label>
          <select id="oi-field" name="field" defaultValue={sp.field ?? ""} className="input"><option value="">All</option>{(Object.keys(OI_FIELDS) as OpenItemField[]).map((f) => <option key={f} value={f}>{OI_FIELDS[f].label}</option>)}</select></div>
        <button type="submit" className="btn-ghost btn-sm col-span-2 sm:col-span-1">Show</button>
        {(sp.pn || sp.branch || sp.field) && <Link href={`/open-items?tab=${tab}`} className="link text-sm">Clear</Link>}
      </form>

      {list.length === 0 ? <p className="rounded-xl bg-fill px-4 py-6 text-sm text-ink-2" data-oi-empty>{tab === "decided" ? "Nothing decided yet." : "Nothing waits here."}</p>
        : tab === "decided" ? (
          <div className="max-w-full overflow-x-auto rounded-xl border border-line" data-oi-decided>
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2"><tr>{["Item", "PN", "Field", "DMS → myloans", "Result", "By", "When", "Remarks"].map((h) => <th key={h} scope="col" className="px-2.5 py-2">{h}</th>)}</tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className="border-t border-line-soft" data-oi-row={r.status}>
                  <td className="whitespace-nowrap px-2.5 py-1.5 mono">{r.number}</td>
                  <td className="px-2.5 py-1.5"><Link href={`/loans/${r.loan.pn}`} className="link mono">{r.loan.pn}</Link></td>
                  <td className="px-2.5 py-1.5">{r.fieldLabel}</td>
                  <td className="px-2.5 py-1.5">{value(r, "oldValue")} → {value(r, "newValue")}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{STATUS_TEXT[r.status]}</td>
                  <td className="px-2.5 py-1.5">{r.decidedByLabel ?? "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{r.decidedAt ? fmtShort(r.decidedAt) : "-"}</td>
                  <td className="px-2.5 py-1.5">{r.remarks ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <ul className="flex flex-col gap-3" data-oi-list>
            {await Promise.all(cards(list).map(async (c) => {
              const head = c.items[0];
              const effect = c.group ? await ruleGroupEffect(head.loanId) : null;
              const status = head.field === "status";
              const loan = status ? await prisma.loan.findUnique({ where: { id: head.loanId }, select: { replacedByPn: true } }) : null;
              const cash = status ? await outstandingCash(prisma, head.loanId) : [];
              return (
                <li key={c.key} className="card flex flex-col gap-3 px-4 py-3 sm:px-5" data-oi-card={c.group ? "rules" : head.field} data-pn={head.loan.pn}>
                  {/* D-058: the card pattern of every list: name (wraps) and the chip, then the PN (copy), then the branch. */}
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-auto break-words text-base font-semibold text-navy" data-oi-borrower>{head.loan.borrowerName}</span>
                      <span className={`chip ${TONE[head.tone]} ml-auto shrink-0`} data-oi-waiting={head.tone}>Waiting {head.waitingDays} working day{head.waitingDays === 1 ? "" : "s"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={`/loans/${head.loan.pn}`} className="link break-all font-mono text-[15px] font-semibold">{head.loan.pn}</Link>
                      <CopyButton text={head.loan.pn} label={`Copy PN ${head.loan.pn}`} />
                    </div>
                    <p className="text-sm text-ink-2">{head.branchName}</p>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm">
                    {c.items.map((r) => (
                      <div key={r.id} className="flex flex-wrap gap-x-2" data-oi-item={r.field}>
                        <dt className="font-semibold">{r.fieldLabel} <span className="mono text-[13px] font-normal text-ink-2">{r.number}</span></dt>
                        <dd>DMS: {value(r, "oldValue")} → myloans: <strong>{value(r, "newValue")}</strong> <span className="text-[13px] text-ink-2">· raised {fmtShort(r.raisedAt)}</span></dd>
                      </div>
                    ))}
                  </dl>
                  {c.group && <p className="text-sm text-ink-2" data-oi-group-note>Loan type, amount, product and release date are decided together.</p>}
                  {effect && <ul className="list-disc pl-5 text-sm" data-oi-effect>{effect.sentences.map((s) => <li key={s}>{s}</li>)}</ul>}
                  {status && <p className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-fg" data-oi-blocked>Send, Forward and new cash wait until this is decided.</p>}
                  {status && (() => { const raw = (head.newRaw ?? {}) as { state?: FeedStateWord; replacedByPn?: string | null }; const o = loan?.replacedByPn && loan.replacedByPn === raw.replacedByPn ? { kind: "close" as const, text: `This will close the loan file (it is linked to ${loan.replacedByPn} on Related loans).` } : statusOutcome(raw.state ?? "NotReleased", raw.replacedByPn ?? null); return <p className="rounded-xl bg-fill px-3 py-2 text-sm font-semibold" data-oi-outcome={o.kind}>If you approve: {o.text} Reject keeps the loan as it is in the DMS.</p>; })()}
                  {status && cash.length > 0 && head.canDecide && (statusOutcome(((head.newRaw ?? {}) as { state?: FeedStateWord }).state ?? "NotReleased", null).kind === "close" || !!loan?.replacedByPn) && (
                    <div className="flex flex-col gap-2" data-oi-cash>
                      <p className="text-sm">Cash is still out: {cash.map((x) => `${x.number} (${x.dp.name}${seesAmounts ? `, ${peso(x.cents)}` : ""}${x.notReleased ? ", not released yet" : ""})`).join(", ")}.</p>
                      <CashBackForm loanId={head.loanId} />
                      {loan?.replacedByPn && cash.filter((x) => !x.notReleased).map((x) => <MoveCashForm key={x.lineId} loanId={head.loanId} lineId={x.lineId} label={`Move ${x.number} to ${loan.replacedByPn}`} />)}
                    </div>
                  )}
                  {head.canDecide ? <DecideForm itemId={head.id} picks={!!effect?.needsPicks} label={`${head.loan.pn} ${c.items.map((i) => i.fieldLabel).join(", ")}`} />
                    : <p className="text-sm text-ink-2" data-oi-readonly>Waiting for an approver of {head.branchName}.</p>}
                </li>
              );
            }))}
          </ul>
        )}
    </div>
  );
}

/** One card per item, except the rule fields of a loan: one card for the group. Oldest first. */
function cards(rows: Row[]) {
  const out: { key: string; group: boolean; items: Row[] }[] = [];
  for (const r of rows) {
    if (r.groupKey === "rules") {
      const g = out.find((c) => c.group && c.items[0].loanId === r.loanId);
      if (g) { g.items.push(r); continue; }
      out.push({ key: `rules-${r.loanId}`, group: true, items: [r] });
    } else out.push({ key: r.id, group: false, items: [r] });
  }
  return out;
}
