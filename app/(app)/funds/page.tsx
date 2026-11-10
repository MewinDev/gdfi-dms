import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, requirePageAny } from "@/lib/auth/current-user";
import { TYPE_ID, TYPE_NOUN, TYPE_TITLE, anyStepKeys, canFunds, canFundsAny, stepKeys, stepVerb, typeKeyOf, typeWhere, typesFor, type FundsStep, type TypeRef } from "@/lib/funds/access";
import { bandTypeId, fundsGaps } from "@/lib/services/funds-handlers";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/auth/permissions";
import { cashToSettleIds, notifyOverdue } from "@/lib/services/funds";
import { OPEN_ADVANCE, ageBucket, bandRolesFor, decimalToCents, isOverdue, peso } from "@/lib/funds/rules";
import { allKinds, kindOption, lineKindText } from "@/lib/services/expense-kinds";
import { presetWas } from "@/lib/funds/kinds";
import { LineEditButton } from "@/components/funds/line-edit";
import { businessDate, businessDaysBetween } from "@/lib/time";
import { ltoLine } from "@/lib/ui/lto";
import { getHolidaySet } from "@/lib/settings";
import { dayText } from "@/lib/ui/plain";
import { PageHeader, ToneChip } from "@/components/ui/basics";
import { AdvanceStatusChip } from "@/components/funds/advance-status";
import {
  ChangeTypeForm, DecideSheetButton, GrantExceptionForm, QuickApproveForm, ReleaseSheetButton, SmallAction, TopUpReleaseSheetButton,
} from "@/components/funds/forms";
import { FundsTypePill } from "@/components/funds/funds-type-pill";
import { RecordHistory } from "@/components/funds/record-history";
import { FundsList, FundsRow, FundsSearch, FundsSummary, KeepTabInView, LockNote, MoreMenu, NoMatch } from "@/components/funds/funds-list";
import { formerlyText, releaseLine } from "@/lib/funds/types";
import { searchTerms, DASH, PRINTABLE_STATUSES, agingTone, daysText, type ListItem } from "@/lib/funds/list-view";
import { DownloadIcon, PrinterIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Funds" };

const TABS = [["approve", "To approve"], ["release", "To release"], ["outstanding", "Outstanding"], ["history", "History"]] as const;
type TabKey = (typeof TABS)[number][0];
const BUCKETS = ["0-10", "11-30", "31-60", "60+"] as const;
const EMPTY: Record<TabKey, string> = {
  approve: "Nothing is waiting for approval.",
  release: "Nothing is waiting for release.",
  outstanding: "No outstanding requests.",
  history: "No closed requests yet.",
};

const lineTxn = { include: { loan: { select: { pn: true, borrowerName: true } }, type: { select: { name: true } } } } as const;
const include = {
  fundsType: true,
  requestedBy: { select: { id: true, name: true } },
  branch: { select: { name: true } },
  lines: {
    include: {
      transaction: {
        include: {
          loan: { select: { pn: true, borrowerName: true } }, type: { select: { name: true, caRules: { where: { active: true } } } },
          dpAssignments: { where: { status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED", "CLOSED"] as never } }, orderBy: { createdAt: "desc" }, take: 1, include: { ltoOffice: true } },
        },
      },
      ltoOffice: true, receipts: true, returns: true, topUps: true, carryOvers: true,
    },
  },
  returns: true,
} as const;

/** The label of a permission as the role editor shows it ("Approve cash advances"). */
const permLabel = (key: string) => PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.key === key)?.label ?? key;
/** "Approving fund transfers needs the 'Approve fund transfers' tick on your role." (the real label of the tick). */
const stepNeeds = (step: Exclude<FundsStep, "view">, t: TypeRef) => {
  const k = typeKeyOf(t);
  return `${stepVerb[step]} ${k ? TYPE_NOUN[k] : "these requests"} ${step === "settle" ? "need" : "needs"} the '${permLabel(stepKeys(step, t)[0])}' tick on your role.`;
};

const Dash = () => <span className="text-ink-2" aria-label="None">{DASH}</span>;
const Grey = ({ children }: { children: React.ReactNode }) => <span className="block text-[12px] text-ink-2">{children}</span>;

/** Loan column: borrower (link to the Loan File), PN and transaction, once per transaction. */
function LoanCell({ txns }: { txns: { pn: string; borrower: string; type: string }[] }) {
  const seen = new Map(txns.map((t) => [`${t.pn}|${t.type}`, t]));
  if (!seen.size) return <Dash />;
  return (
    <ul className="flex flex-col gap-1.5">
      {[...seen.values()].map((t) => (
        <li key={`${t.pn}|${t.type}`} className="min-w-0">
          <Link href={`/loans/${t.pn}`} className="block break-words font-semibold text-navy hover:underline" data-loan-borrower>{t.borrower}</Link>
          <span className="block break-all font-mono text-[12px] text-ink-2" data-loan-pn>{t.pn}</span>
          <span className="block text-[12px] text-ink-2">{t.type}</span>
        </li>
      ))}
    </ul>
  );
}

function Aging({ tone, children }: { tone: "bad" | "act" | "mute"; children: React.ReactNode }) {
  return <span className="mt-1 flex items-center justify-end gap-1.5 text-[12px] text-ink-2" data-aging={tone}><span className={`fl-dot fl-dot-${tone}`} aria-hidden="true" />{children}</span>;
}

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ tab?: string; ftype?: string }> }) {
  // Either type's See tick opens the page; every list, count, total and the CSV hold only the types the
  // person may see (cash advances and fund transfers are handled by different people).
  const user = await requirePageAny(anyStepKeys("view"));
  const seen = typesFor(user, "view");
  await notifyOverdue();
  const sp = await searchParams;
  const tab: TabKey = TABS.find(([k]) => k === sp.tab)?.[0] ?? "approve";
  const now = new Date();
  const branchScope = user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } };
  // Filter by funds type (?ftype=CA): every list, the counts and the CSV follow it.
  const fundsTypes = await prisma.fundsType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const ftype = fundsTypes.find((t) => t.code === sp.ftype)?.code;
  const scope = { ...branchScope, ...typeWhere(user), ...(ftype ? { fundsTypeCode: ftype } : {}) };
  const sideLine = { include: { transaction: lineTxn, advance: { select: { number: true, fundsTypeId: true, fundsTypeCode: true, fundsTypeName: true, requestedBy: { select: { name: true } }, branch: { select: { name: true } } } } } } as const;
  const [requested, approved, open, history, topUps, carries, bands, me, holidays] = await Promise.all([
    prisma.cashAdvance.findMany({ where: { ...scope, status: "REQUESTED" }, include, orderBy: { createdAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: "APPROVED" }, include, orderBy: { approvedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: [...OPEN_ADVANCE, "LIQUIDATED"] as never } }, include, orderBy: { releasedAt: "asc" } }),
    prisma.cashAdvance.findMany({ where: { ...scope, status: { in: ["CLOSED", "DENIED", "CANCELLED"] } }, include, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.cashAdvanceTopUp.findMany({ where: { releasedAt: null, status: { in: ["REQUESTED", "APPROVED"] }, line: { advance: { ...branchScope, ...typeWhere(user) } }, ...(ftype ? { fundsTypeCode: ftype } : {}) }, include: { line: sideLine } }),
    prisma.carryOver.findMany({ where: { status: "PENDING", line: { advance: scope } }, include: { line: sideLine } }),
    prisma.approvalBand.findMany(),
    prisma.user.findUnique({ where: { id: user.id }, select: { roleId: true } }),
    getHolidaySet(),
  ]);
  type Adv = (typeof requested)[number];
  type Line = Adv["lines"][number];
  const toSettle = await cashToSettleIds(open.map((a) => ({ id: a.id, status: a.status, requestedById: a.requestedBy.id, lines: a.lines })));
  // Each step for the row's own type (Approve fund transfers, Release cash advances...).
  const may = (step: FundsStep, t: TypeRef) => canFunds(user, step, t);
  const mayApprove = canFundsAny(user, "approve");
  // The bands of the request's own type.
  const myBand = (cents: number, t: TypeRef) => !!me && bandRolesFor(cents, bands.filter((b) => b.fundsTypeId === bandTypeId(t))).includes(me.roleId);
  const kindRows = await allKinds();
  const names = new Map(kindRows.map((k) => [k.code, k.name]));
  const kindOpts = kindRows.map(kindOption);
  const canAddKind = can(user, PERMISSIONS.FUNDS_KINDS_MANAGE);
  const rulesOf = (l: Line) => Object.fromEntries((l.transaction?.type.caRules ?? []).map((r) => [r.kind, { suggestedCents: decimalToCents(r.suggestedAmount), maxCents: decimalToCents(r.maxAmount) }]));
  // The job's office now, and the one it had when the cash was asked for.
  const officeOf = (l: Line) => {
    const cur = l.transaction?.dpAssignments[0]?.ltoOffice ?? null;
    const asked = l.ltoOffice;
    return { office: cur ?? asked, changed: asked && cur && asked.id !== cur.id ? `Office changed from ${asked.name} to ${cur.name}` : "" };
  };
  /** The one-line text the approve-or-deny form shows per line (unchanged wording). */
  const lineLabel = (l: Line) => {
    const { office, changed } = officeOf(l);
    return `${lineKindText(names, l)}${l.transaction ? ` · ${l.transaction.loan.pn} ${l.transaction.type.name} (${l.transaction.loan.borrowerName})` : l.note ? ` · ${l.note}` : ""}${office ? ` · ${ltoLine(office)}` : ""}${changed ? ` · ${changed}` : ""}`;
  };
  const balanceOf = (a: Adv) => a.releasedCents - a.lines.flatMap((l) => l.receipts).reduce((s, r) => s + r.cents, 0) - a.returns.reduce((s, r) => s + r.cents, 0);
  const ageOf = (a: Adv) => (a.releasedAt ? businessDaysBetween(businessDate(a.releasedAt), businessDate(now), holidays) : 0);
  const daysSince = (d: Date | null) => (d ? businessDaysBetween(businessDate(d), businessDate(now), holidays) : 0);
  const overdueDps = new Map(open.filter((a) => isOverdue(a, now)).map((a) => [a.requestedBy.id, a.requestedBy.name]));
  const counts = { approve: requested.length + topUps.filter((t) => t.status === "REQUESTED").length + carries.length, release: approved.length + topUps.filter((t) => t.status === "APPROVED").length, outstanding: open.length, history: history.length };
  // Counts by type for the filter (same branch scope, every open or recent record of the tab).
  const tabStatus: Record<string, string[]> = { approve: ["REQUESTED"], release: ["APPROVED"], outstanding: [...OPEN_ADVANCE, "LIQUIDATED"], history: ["CLOSED", "DENIED", "CANCELLED"] };
  const byType = await prisma.cashAdvance.groupBy({ by: ["fundsTypeCode"], where: { ...branchScope, ...typeWhere(user), status: { in: tabStatus[tab] as never } }, _count: { _all: true } });
  const typeCount = (code: string) => byType.find((b) => b.fundsTypeCode === code)?._count._all ?? 0;
  const allCount = byType.reduce((s, b) => s + b._count._all, 0);
  const activeTypes = fundsTypes.filter((t) => t.active);
  const typeOptions = activeTypes.map((t) => ({ id: t.id, code: t.code, name: t.name, needsReference: t.needsReference, needsAccount: t.needsAccount }));
  // Change type offers only the types the person may edit; a top-up's release only the types they may release.
  const editTypes = typeOptions.filter((o) => may("changeType", { fundsTypeId: o.id }));
  const releaseTypes = typeOptions.filter((o) => may("release", { fundsTypeId: o.id }));
  const today = businessDate(now);
  const href = (o: { tab?: string; ftype?: string | null }) => {
    const p = new URLSearchParams({ tab: o.tab ?? tab });
    const f = o.ftype === undefined ? ftype : o.ftype;
    if (f) p.set("ftype", f);
    return `/funds?${p.toString()}`;
  };
  const ids = [...requested, ...approved, ...open, ...history].map((a) => a.id);
  const [audit, approvers] = await Promise.all([
    ids.length ? prisma.auditLog.findMany({ where: { entityType: "CashAdvance", entityId: { in: ids } }, orderBy: { at: "asc" }, select: { id: true, entityId: true, summary: true, actorLabel: true, at: true } }) : [],
    prisma.user.findMany({ where: { id: { in: approved.map((a) => a.approvedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const approverName = (id: string | null) => approvers.find((u) => u.id === id)?.name ?? null;
  const historyOf = (id: string) => audit.filter((r) => r.entityId === id).map((r) => ({ id: r.id, text: r.summary, when: dayText(r.at) }));
  const settleCount = open.filter((a) => toSettle.has(a.id)).length;

  // ---- the cells shared by every tab ----------------------------------------------------------
  const txnsOf = (lines: Line[]) => lines.filter((l) => l.transaction).map((l) => ({ pn: l.transaction!.loan.pn, borrower: l.transaction!.loan.borrowerName, type: l.transaction!.type.name }));
  // The search finds a request by its number and by any number it had before ("Formerly CA-2026-0008").
  const formerOf = new Map([...requested, ...approved, ...open, ...history].map((a) => [a.number, a.formerNumbers]));
  const searchOf = (number: string, txns: { pn: string; borrower: string }[]) => searchTerms(number, formerOf.get(number), txns);
  const reqCell = (number: string, code: string, typeName: string, extra?: React.ReactNode) => (
    <div className="flex flex-col items-start gap-1">
      <a href={`#${number}`} className="text-[15px] font-bold text-navy hover:underline" data-request-number>{number}</a>
      {formerlyText(formerOf.get(number)) && <span className="text-[12px] text-ink-2" data-formerly>{formerlyText(formerOf.get(number))}</span>}
      <FundsTypePill code={code} name={typeName} />
      {extra}
    </div>
  );
  /** For column: each line's expense kind and, under it in grey, the place (or the note of a general expense). */
  const forCell = (a: Adv, opts: { amounts?: "requested" | "approved" } = {}) => (
    <ul className="flex flex-col gap-1.5" data-for-lines>
      {a.lines.map((l, i) => {
        const { changed } = officeOf(l);
        const placeOf = (x: Line) => { const o = officeOf(x).office; return o ? ltoLine(o) : !x.transaction && x.note ? x.note : null; };
        // The same office under two lines of one request is said once.
        const place = placeOf(l) !== null && (i === 0 || placeOf(a.lines[i - 1]) !== placeOf(l)) ? placeOf(l) : null;
        const amount = opts.amounts === "approved" ? (l.denied ? "not approved" : peso(l.approvedCents ?? 0)) : opts.amounts === "requested" && a.lines.length > 1 ? peso(l.requestedCents) : null;
        return (
          <li key={l.id} className="min-w-0">
            <span className="font-semibold text-ink" data-kind-text>{lineKindText(names, l)}</span>
            {amount && <span className="text-ink-2 tabular-nums"> · {amount}</span>}
            {presetWas(l.presetCents, l.requestedCents) && <span className="ml-1 text-ink-2" data-preset-was>({presetWas(l.presetCents, l.requestedCents)})</span>}
            {place ? <Grey>{place}</Grey> : null}
            {changed && <Grey><span data-office-changed>{changed}</span></Grey>}
            {l.overMaxReason && <span className="block text-[12px] font-semibold text-act-fg">Above the maximum: {l.overMaxReason}</span>}
          </li>
        );
      })}
      {!a.lines.length && <li><Dash /></li>}
    </ul>
  );
  const askedCell = (name: string, branch: string, when: string, extra?: React.ReactNode) => (
    <div className="min-w-0">
      <span className="block break-words font-semibold text-ink">{name}</span>
      <Grey>{branch}</Grey>
      <Grey>{when}</Grey>
      {extra}
    </div>
  );
  const amountCell = (cents: number, under?: React.ReactNode, tone?: "act") => (
    <div className="flex flex-col items-end">
      <span className={`text-[15px] font-bold tabular-nums ${tone === "act" ? "text-act-fg" : "text-navy"}`} data-amount>{peso(cents)}</span>
      {under}
    </div>
  );
  const suggestedOf = (a: Adv) => (a.lines.length && a.lines.every((l) => l.presetCents !== null) ? a.lines.reduce((s, l) => s + (l.presetCents ?? 0), 0) : null);
  /** At most two text buttons show; the rest go under the three dots ("More actions"), in groups. */
  const actions = (label: string, main: React.ReactNode[], more: React.ReactNode[][] = [], lock?: string) => {
    const shown = main.filter(Boolean).slice(0, 2);
    const groups = [main.filter(Boolean).slice(2), ...more.map((g) => g.filter(Boolean))].filter((g) => g.length);
    return (
      <>
        {lock && <LockNote reason={lock} />}
        {shown}
        {groups.length > 0 && <MoreMenu label={label} groups={groups} />}
      </>
    );
  };

  /** The liquidation report (Funds, Print) of a liquidated or closed request; only with "Print liquidation report". */
  const printLink = (number: string, t: TypeRef) => !may("print", t) ? null : (
    <Link key="print" href={`/funds/${encodeURIComponent(number)}/print`} className="btn-secondary btn-sm fl-btn" data-print-link={number}><PrinterIcon size={14} /> Print</Link>
  );

  // ---- rows per tab ------------------------------------------------------------------------------
  type Row = { item: ListItem; node: React.ReactNode; actionable: boolean };
  const rows: Row[] = [];

  if (tab === "approve") {
    for (const a of requested) {
      const own = a.requestedBy.id === user.id;
      const inBand = myBand(a.requestedCents, a);
      const canDecide = may("approve", a) && !own && inBand;
      const editors = may("editLines", a) && !own;
      const txns = txnsOf(a.lines);
      const formLines = a.lines.map((l) => ({ id: l.id, label: lineLabel(l), requestedCents: l.requestedCents, overMaxReason: l.overMaxReason }));
      const about = { number: a.number, requester: a.requestedBy.name, kinds: a.lines.map((l) => lineKindText(names, l)), borrowers: txns.map((t) => t.borrower) };
      const lock = canDecide ? undefined : own ? "Your own request: someone else approves it." : !may("approve", a) ? (mayApprove ? `You can't approve this one. ${stepNeeds("approve", a)}` : undefined) : "You can't approve this one. Another role approves this amount (approval bands).";
      const more = [
        [canDecide && <DecideSheetButton key="amounts" number={a.number} label="Change amounts" cls="btn-ghost btn-sm" advanceId={a.id} lines={formLines} about={about} />],
        [...(editors ? a.lines.map((l) => <LineEditButton key={l.id} advanceId={a.id} line={{ id: l.id, kind: l.kind, otherDescription: l.otherDescription, requestedCents: l.requestedCents, overMaxReason: l.overMaxReason }} kinds={kindOpts} rules={rulesOf(l)} canAddKind={canAddKind} canOverrideFixed={canAddKind} label={`Change ${lineKindText(names, l)}`} />) : []),
        editors && <LineEditButton key="add" advanceId={a.id} kinds={kindOpts} rules={{}} canAddKind={canAddKind} canOverrideFixed={canAddKind} />],
        [may("changeType", a) && <ChangeTypeForm key="type" advanceId={a.id} current={a.fundsTypeId} types={editTypes} />],
      ];
      const actionable = canDecide || editors;
      const suggested = suggestedOf(a);
      rows.push({
        actionable,
        item: { key: a.number, typeCode: a.fundsTypeCode, cents: a.requestedCents, search: searchOf(a.number, txns) },
        node: (
          <FundsRow key={a.id} rowKey={a.number} label={a.number} attrs={{ "data-advance": a.number }} cells={{
            req: reqCell(a.number, a.fundsTypeCode, a.fundsTypeName),
            loan: <LoanCell txns={txns} />,
            forKind: forCell(a, { amounts: "requested" }),
            asked: askedCell(a.requestedBy.name, a.branch.name, `Asked ${dayText(a.createdAt)}`, a.exceptionId ? <Grey>With a one-time exception</Grey> : null),
            amount: amountCell(a.requestedCents, suggested !== null ? <Grey>Suggested {peso(suggested)}</Grey> : null),
            status: <><AdvanceStatusChip status={a.status} /><Aging tone="mute">{daysText(daysSince(a.createdAt), "waiting")}</Aging></>,
            action: !may("approve", a) && !may("editLines", a) && !may("changeType", a) ? null : actions(a.number, [canDecide && <QuickApproveForm key="ok" advanceId={a.id} lines={a.lines.map((l) => ({ id: l.id, requestedCents: l.requestedCents }))} about={about} />, canDecide && <DecideSheetButton key="deny" number={a.number} label="Deny" advanceId={a.id} lines={formLines} about={about} />], more, lock),
          }} />
        ),
      });
    }
    for (const t of topUps.filter((x) => x.status === "REQUESTED")) {
      const ok = may("approve", t.line.advance) && t.requestedById !== user.id && myBand(t.extraCents, t.line.advance);
      const txns = t.line.transaction ? [{ pn: t.line.transaction.loan.pn, borrower: t.line.transaction.loan.borrowerName, type: t.line.transaction.type.name }] : [];
      const lock = ok ? undefined : t.requestedById === user.id ? "Your own request: someone else approves it." : may("approve", t.line.advance) ? "You can't approve this one. Another role approves this amount (approval bands)." : undefined;
      rows.push({
        actionable: ok,
        item: { key: t.id, typeCode: t.fundsTypeCode, cents: t.extraCents, search: searchOf(t.line.advance.number, txns) },
        node: (
          <FundsRow key={t.id} rowKey={t.id} label={`${t.line.advance.number} top-up`} attrs={{ "data-topup": t.id }} cells={{
            req: reqCell(t.line.advance.number, t.fundsTypeCode, t.fundsTypeName, <span className="text-[12px] font-semibold text-ink-2">Top-up</span>),
            loan: <LoanCell txns={txns} />,
            forKind: <div><span className="font-semibold">{lineKindText(names, t.line)}: more cash</span><Grey>{t.reason || DASH}</Grey></div>,
            asked: askedCell(t.line.advance.requestedBy.name, t.line.advance.branch.name, `Asked ${dayText(t.createdAt)}`),
            amount: amountCell(t.extraCents, <Grey>Extra asked</Grey>),
            status: <><AdvanceStatusChip status="REQUESTED" /><Aging tone="mute">{daysText(daysSince(t.createdAt), "waiting")}</Aging></>,
            action: !may("approve", t.line.advance) ? null : actions(`${t.line.advance.number} top-up`, [ok && <SmallAction key="ok" kind="topup-approve" id={t.id} label="Approve the extra" cls="btn-gold btn-sm fl-btn" confirm={{ number: `${t.line.advance.number} top-up`, requester: t.line.advance.requestedBy.name, kinds: [lineKindText(names, t.line)], borrowers: txns.map((x) => x.borrower), cents: t.extraCents }} />], [[ok && <SmallAction key="no" kind="topup-deny" id={t.id} label="Deny" extra />]], lock),
          }} />
        ),
      });
    }
    for (const c of carries) {
      const txns = c.line.transaction ? [{ pn: c.line.transaction.loan.pn, borrower: c.line.transaction.loan.borrowerName, type: c.line.transaction.type.name }] : [];
      rows.push({
        actionable: may("approve", c.line.advance),
        item: { key: c.id, typeCode: c.line.advance.fundsTypeCode, cents: c.cents, search: searchOf(c.line.advance.number, txns) },
        node: (
          <FundsRow key={c.id} rowKey={c.id} label={`${c.line.advance.number} carry-over`} attrs={{ "data-carry": c.id }} cells={{
            req: reqCell(c.line.advance.number, c.line.advance.fundsTypeCode, c.line.advance.fundsTypeName, <span className="text-[12px] font-semibold text-ink-2">Carry-over</span>),
            loan: <LoanCell txns={txns} />,
            forKind: <div><span className="font-semibold">Keep the balance</span><Grey>{c.line.advance.requestedBy.name} wants to keep the balance beyond the carry-over limit ({c.businessDays} business days).</Grey></div>,
            asked: askedCell(c.line.advance.requestedBy.name, c.line.advance.branch.name, `Asked ${dayText(c.createdAt)}`),
            amount: amountCell(c.cents, <Grey>Balance kept</Grey>),
            status: <><AdvanceStatusChip status="REQUESTED" /><Aging tone="mute">{daysText(daysSince(c.createdAt), "waiting")}</Aging></>,
            action: may("approve", c.line.advance) ? actions(`${c.line.advance.number} carry-over`, [<SmallAction key="ok" kind="carry-approve" id={c.id} label="Approve carry-over" cls="btn-gold btn-sm fl-btn" confirm={{ number: `${c.line.advance.number} carry-over`, requester: c.line.advance.requestedBy.name, kinds: [lineKindText(names, c.line)], borrowers: txns.map((x) => x.borrower), cents: c.cents }} />, <SmallAction key="no" kind="carry-deny" id={c.id} label="Deny (return the cash)" cls="btn-secondary btn-sm fl-btn" />]) : null,
          }} />
        ),
      });
    }
  }

  if (tab === "release") {
    for (const a of approved) {
      const own = a.requestedBy.id === user.id;
      const ok = may("release", a) && !own;
      const txns = txnsOf(a.lines);
      const by = approverName(a.approvedById);
      const lock = may("release", a) && own ? "Your own request: someone else releases it." : undefined;
      rows.push({
        actionable: ok,
        item: { key: a.number, typeCode: a.fundsTypeCode, cents: a.approvedCents ?? 0, search: searchOf(a.number, txns) },
        node: (
          <FundsRow key={a.id} rowKey={a.number} label={a.number} attrs={{ "data-advance": a.number }} cells={{
            req: reqCell(a.number, a.fundsTypeCode, a.fundsTypeName),
            loan: <LoanCell txns={txns} />,
            forKind: <>{forCell(a, { amounts: "approved" })}{a.approvalNote && <Grey>Approval note: {a.approvalNote}</Grey>}</>,
            asked: askedCell(a.requestedBy.name, a.branch.name, `Asked ${dayText(a.createdAt)}`),
            amount: amountCell(a.approvedCents ?? 0, <><Grey>Approved by {by ?? DASH}</Grey><Grey>{dayText(a.approvedAt)}</Grey>{(a.approvedCents ?? 0) !== a.requestedCents && <Grey>Asked {peso(a.requestedCents)}</Grey>}</>),
            status: <><AdvanceStatusChip status={a.status} /><Aging tone="mute">{daysText(daysSince(a.approvedAt), "waiting")}</Aging></>,
            action: may("release", a) || may("changeType", a) ? actions(a.number, [ok && <ReleaseSheetButton key="rel" number={a.number} advanceId={a.id} type={a.fundsType} today={today} />], [[may("changeType", a) && <ChangeTypeForm key="type" advanceId={a.id} current={a.fundsTypeId} types={editTypes} />]], lock) : null,
            details: historyOf(a.id).length ? <RecordHistory rows={historyOf(a.id)} /> : undefined,
          }} />
        ),
      });
    }
    for (const t of topUps.filter((x) => x.status === "APPROVED")) {
      const txns = t.line.transaction ? [{ pn: t.line.transaction.loan.pn, borrower: t.line.transaction.loan.borrowerName, type: t.line.transaction.type.name }] : [];
      const types = releaseTypes.some((o) => o.id === t.fundsTypeId) ? releaseTypes : [...releaseTypes, { id: t.fundsTypeId, code: t.fundsTypeCode, name: t.fundsTypeName, needsReference: false, needsAccount: false }];
      rows.push({
        actionable: may("release", t.line.advance),
        item: { key: t.id, typeCode: t.fundsTypeCode, cents: t.approvedCents ?? 0, search: searchOf(t.line.advance.number, txns) },
        node: (
          <FundsRow key={t.id} rowKey={t.id} label={`${t.line.advance.number} top-up`} attrs={{ "data-topup": t.id }} cells={{
            req: reqCell(t.line.advance.number, t.fundsTypeCode, t.fundsTypeName, <span className="text-[12px] font-semibold text-ink-2">Top-up</span>),
            loan: <LoanCell txns={txns} />,
            forKind: <div><span className="font-semibold">{lineKindText(names, t.line)}: more cash</span><Grey>{t.reason || DASH}</Grey></div>,
            asked: askedCell(t.line.advance.requestedBy.name, t.line.advance.branch.name, `Asked ${dayText(t.createdAt)}`),
            amount: amountCell(t.approvedCents ?? 0, <Grey>Top-up approved</Grey>),
            status: <AdvanceStatusChip status="APPROVED" />,
            action: may("release", t.line.advance) ? actions(`${t.line.advance.number} top-up`, [<TopUpReleaseSheetButton key="rel" number={t.line.advance.number} topUpId={t.id} currentTypeId={t.fundsTypeId} types={types} today={today} />]) : null,
          }} />
        ),
      });
    }
  }

  if (tab === "outstanding") {
    for (const a of open) {
      const bal = balanceOf(a);
      const unconfirmed = a.returns.filter((r) => !r.confirmedAt);
      const liquidated = a.lines.flatMap((l) => l.receipts).reduce((s, r) => s + r.cents, 0);
      const returned = a.returns.reduce((s, r) => s + r.cents, 0);
      const days = ageOf(a);
      const overdue = isOverdue(a, now);
      const txns = txnsOf(a.lines);
      const receipts = a.lines.flatMap((l) => l.receipts.map((r) => ({ r, l })));
      const verb = a.fundsType.needsReference || a.fundsType.needsAccount ? "Sent" : "Released";
      const main = [
        ...unconfirmed.map((r) => may("settle", a) && <SmallAction key={r.id} kind="confirm-return" id={r.id} label={unconfirmed.length > 1 ? `Confirm ${peso(r.cents)} received` : "Confirm received"} cls="btn-secondary btn-sm fl-btn" />),
        a.status === "LIQUIDATED" && may("settle", a) && unconfirmed.length === 0 && <SmallAction key="close" kind="close" id={a.id} label="Close advance" cls="btn-gold btn-sm fl-btn" />,
        a.status === "LIQUIDATED" && printLink(a.number, a),
      ].filter(Boolean);
      const hist = historyOf(a.id);
      rows.push({
        actionable: may("settle", a) && main.length > (a.status === "LIQUIDATED" && may("print", a) ? 1 : 0), // Print is not acting on the request
        item: { key: a.number, typeCode: a.fundsTypeCode, cents: bal, search: searchOf(a.number, txns) },
        node: (
          <FundsRow key={a.id} rowKey={a.number} label={a.number} attrs={{ "data-advance": a.number, "data-cash-to-settle": toSettle.has(a.id) ? "true" : undefined }} cells={{
            req: reqCell(a.number, a.fundsTypeCode, a.fundsTypeName),
            loan: <LoanCell txns={txns} />,
            forKind: <>{forCell(a)}{a.note && <p className="mt-1 text-[12px] font-semibold text-wait-fg" data-advance-note>{a.note}</p>}</>,
            trail: (
              <div data-money-trail>
                <dl className="fl-money">
                  <dt className="text-ink-2">{verb}</dt><dd data-released>{peso(a.releasedCents)}</dd>
                  <dt className="text-ink-2">Liquidated</dt><dd data-liquidated>{peso(liquidated)}</dd>
                  {returned > 0 && <><dt className="text-ink-2">Returned</dt><dd>{peso(returned)}{unconfirmed.length ? " (to confirm)" : ""}</dd></>}
                  <dt className="font-semibold">Balance</dt><dd className={`font-bold ${bal > 0 ? "text-act-fg" : "text-ink"}`} data-balance>{peso(bal)}</dd>
                </dl>
                <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2" data-aging={agingTone({ overdue, days })}><span className={`fl-dot fl-dot-${agingTone({ overdue, days })}`} aria-hidden="true" />{daysText(days, "outstanding")}</span>
                <Grey>{a.liquidationDueAt ? `Liquidate by ${dayText(a.liquidationDueAt)}` : "No receipts needed for this type"}</Grey>
                <Grey><span data-release-line>{releaseLine(a) || DASH}</span></Grey>
              </div>
            ),
            asked: askedCell(a.requestedBy.name, a.branch.name, `${verb} ${dayText(a.releasedAt)}`),
            amount: amountCell(bal, <Grey>of {peso(a.releasedCents)}</Grey>, bal > 0 ? "act" : undefined),
            status: (
              <div className="flex flex-col items-end gap-1">
                <AdvanceStatusChip status={a.status} overdue={overdue} />
                {toSettle.has(a.id) && <ToneChip tone="act" title="The job went back to the Loan Associate; the processor settles the cash.">Cash to settle</ToneChip>}
              </div>
            ),
            action: may("settle", a) || a.status === "LIQUIDATED" ? (main.length ? actions(a.number, main) : <span className="text-[12px] text-ink-2">{a.status === "LIQUIDATED" ? "Waiting for the returned cash" : "Waiting for the processor's receipts"}</span>) : null,
            details: receipts.length || hist.length ? (
              <div className="flex flex-col gap-2">
                {receipts.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-ink-2">Receipts ({receipts.length})</p>
                    <ul className="text-[13px]">
                      {receipts.map(({ r, l }) => (
                        <li key={r.id}>{dayText(r.date)} · {r.number} · {peso(r.cents)} · {lineLabel(l)} {r.fileKey && <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener" className="link">View file</a>}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <RecordHistory rows={hist} />
              </div>
            ) : undefined,
          }} />
        ),
      });
    }
  }

  if (tab === "history") {
    for (const a of history) {
      const txns = txnsOf(a.lines);
      const when = a.status === "CLOSED" ? `Closed ${dayText(a.closedAt ?? a.updatedAt)}` : a.status === "DENIED" ? `Denied ${dayText(a.updatedAt)}` : `Cancelled ${dayText(a.updatedAt)}`;
      rows.push({
        actionable: false,
        item: { key: a.number, typeCode: a.fundsTypeCode, cents: a.requestedCents, search: searchOf(a.number, txns) },
        node: (
          <FundsRow key={a.id} rowKey={a.number} label={a.number} attrs={{ "data-advance": a.number }} cells={{
            req: reqCell(a.number, a.fundsTypeCode, a.fundsTypeName),
            loan: <LoanCell txns={txns} />,
            forKind: <>{forCell(a, { amounts: "requested" })}{a.deniedReason && <Grey>Reason: {a.deniedReason}</Grey>}</>,
            asked: askedCell(a.requestedBy.name, a.branch.name, `Asked ${dayText(a.createdAt)}`),
            amount: amountCell(a.requestedCents, a.releasedCents ? <Grey>Released {peso(a.releasedCents)}</Grey> : <Grey>Asked</Grey>),
            status: <div className="flex flex-col items-end gap-1"><AdvanceStatusChip status={a.status} /><Grey>{when}</Grey></div>,
            action: PRINTABLE_STATUSES.includes(a.status) ? printLink(a.number, a) : null,
          }} />
        ),
      });
    }
  }

  // The tab's step; the types seen on this tab whose step tick the person lacks get one plain line each.
  const tabStep: Exclude<FundsStep, "view"> | null = tab === "approve" ? "approve" : tab === "release" ? "release" : tab === "outstanding" ? "settle" : null;
  const tabTypes = new Set(rows.map((r) => r.item.typeCode));
  const lacking = tabStep ? seen.filter((k) => !canFunds(user, tabStep, { fundsTypeId: TYPE_ID[k] }) && fundsTypes.some((t) => t.id === TYPE_ID[k] && tabTypes.has(t.code))) : [];
  const noneActionable = rows.length > 0 && !rows.some((r) => r.actionable);
  const viewOnly = lacking.length > 0 && (noneActionable || lacking.length < seen.length);
  const viewOnlyText = `${noneActionable ? "You can view these requests. " : ""}${lacking.map((k) => stepNeeds(tabStep!, { fundsTypeId: TYPE_ID[k] })).join(" ")}`;
  // A view-only tab still keeps the Action column when a row has a button (Print on a liquidated request).
  const anyAction = tab === "history" ? history.some((a) => PRINTABLE_STATUSES.includes(a.status)) : !noneActionable || (tab === "outstanding" && open.some((a) => a.status === "LIQUIDATED"));
  const head = { approve: "Amount", release: "Approved", outstanding: "Balance", history: "Amount" }[tab];
  const typeChoices = fundsTypes.filter((t) => t.active || typeCount(t.code) > 0);
  // Admin (people who can manage roles): the one line when nobody can approve, release or settle a type.
  const gaps = can(user, PERMISSIONS.ROLES_MANAGE) ? await fundsGaps() : [];

  return (
    <div className="dense funds-page funds-compact flex w-full min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
        <div className="min-w-0">
          <PageHeader title="Funds" help="Approve and release cash advances, then follow liquidation until each is closed." />
          {seen.length === 1 && <p className="mt-1 text-[15px] font-semibold text-navy" data-funds-types-line>{TYPE_TITLE[seen[0]]}</p>}
          {gaps.length > 0 && <p role="status" className="mt-2 rounded-xl border border-act-line bg-act-bg px-3 py-2 text-sm text-ink" data-funds-health>{gaps.join(" ")} Requests of that type wait; the Admin is told. Change it in Settings, Roles.</p>}
        </div>
        <a href={`/api/funds/export?tab=${tab}${ftype ? `&ftype=${ftype}` : ""}`} className="btn-secondary btn-sm fl-csv order-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 sm:order-none sm:col-start-2 sm:row-start-1 sm:w-auto sm:self-start" data-funds-csv><DownloadIcon size={16} /> Download CSV</a>
        <nav aria-label="Funds tabs" className="funds-tabs flex min-w-0 overflow-x-auto border-b border-line sm:col-span-2" data-funds-tabs>
          {TABS.map(([k, l]) => (
            <Link key={k} href={href({ tab: k })} aria-current={tab === k ? "page" : undefined} className="tab shrink-0" data-tab={k}>{l}<span className="tab-count" data-tab-count>{counts[k]}</span></Link>
          ))}
        </nav>
        <KeepTabInView />
      </div>

      <FundsList items={rows.map((r) => r.item)}>
        <FundsSummary />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {seen.length === 2 && <div className="order-2 min-w-0 sm:order-none">
            <nav aria-label="Type" className="seg" data-funds-type-filter>
              <Link href={href({ ftype: null })} aria-current={!ftype ? "page" : undefined} className="seg-item">All <span className="seg-count">{allCount}</span></Link>
              {typeChoices.map((t) => (
                <Link key={t.id} href={href({ ftype: t.code })} aria-current={ftype === t.code ? "page" : undefined} className="seg-item" data-filter-type={t.code} aria-label={`${t.code} · ${t.name}, ${typeCount(t.code)}`}>
                  {t.code}<span className="hidden sm:inline"> · {t.name}</span> <span className="seg-count" data-type-count>{typeCount(t.code)}</span>
                </Link>
              ))}
            </nav>
          </div>}
          {tab === "outstanding" && settleCount > 0 && <span className="order-3 sm:order-none"><ToneChip tone="act">Cash to settle · {settleCount}</ToneChip></span>}
          <div className="order-1 sm:order-none sm:ml-auto"><FundsSearch /></div>
        </div>

        {tab === "outstanding" && (
          <>
            <section aria-label="Age" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BUCKETS.map((b) => {
                const xs = open.filter((a) => a.status !== "LIQUIDATED" && ageBucket(ageOf(a)) === b);
                return (
                  <div key={b} className="card px-4 py-3">
                    <p className="text-[13px] text-ink-2">{b} business days</p>
                    <p className="text-xl font-bold tabular-nums text-navy">{peso(xs.reduce((s, a) => s + balanceOf(a), 0))}</p>
                    <p className="text-[13px]">{xs.length} advance{xs.length === 1 ? "" : "s"}</p>
                  </div>
                );
              })}
            </section>
            {overdueDps.size > 0 && can(user, PERMISSIONS.FUNDS_EXCEPTION) && (
              <section aria-label="Overdue processors" className="card flex flex-col gap-2 p-4 sm:p-5">
                <h2 className="text-[17px] font-bold text-navy">Overdue processors</h2>
                <p className="text-[13px] text-ink-2">They cannot request a new advance until they liquidate. You can allow one more request.</p>
                {[...overdueDps].map(([id, name]) => (
                  <div key={id} className="flex flex-wrap items-center gap-2"><span className="mr-auto text-[15px] font-semibold">{name}</span><GrantExceptionForm dpUserId={id} name={name} /></div>
                ))}
              </section>
            )}
          </>
        )}

        {viewOnly && <p className="text-[13px] text-ink-2" data-view-only>{viewOnlyText}</p>}

        {rows.length === 0 ? (
          <p className="card p-5 text-[15px] text-ink-2" data-funds-empty>{EMPTY[tab]}</p>
        ) : (
          <div className={`fl ${!anyAction ? "fl-noact" : ""} ${tab === "outstanding" ? "fl-trail-col" : ""} ${tab === "history" ? "fl-hist" : ""}`}>
            <div role="table" aria-label={TABS.find(([k]) => k === tab)![1]} className="fl-rows" data-funds-list={tab}>
              <div role="row" className="fl-head">
                <span role="columnheader" className="h-req">Request</span>
                <span role="columnheader" className="h-loan">Loan</span>
                <span role="columnheader" className="h-for">{tab === "outstanding" ? "For and money trail" : "For"}</span>
                <span role="columnheader" className="h-asked">Asked by</span>
                <span role="columnheader" className="h-amt">{head}</span>
                <span role="columnheader" className="h-status">Status</span>
                {anyAction && <span role="columnheader" className="h-act">Action</span>}
              </div>
              {rows.map((r) => r.node)}
            </div>
            <NoMatch />
          </div>
        )}
      </FundsList>
    </div>
  );
}
