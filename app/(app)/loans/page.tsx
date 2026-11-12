import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission, can, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { listLoans, type LoanListFilters, type LoanRow } from "@/lib/services/queries";
import { getHolidaySet } from "@/lib/settings";
import { STAGES } from "@/lib/workflow/stage";
import { stageLabel } from "@/lib/workflow/stage-map";
import { cardFor, sortByUrgency } from "@/lib/ui/loan-cards";
import { LoansToolbar } from "@/components/loan/loans-toolbar";
import { LoanTable } from "@/components/loan/loan-table";
import { EmptyLine, FilterChips, MyLoansList } from "@/components/loan/my-loans-list";
import { LoanTabs } from "@/components/loan/loan-tabs";
import { activeChips, clearAllHref, listHref, type FilterField } from "@/lib/ui/loan-filters";
import { isTestMode } from "@/lib/test-mode";
import { SampleLoans } from "@/components/loan/sample-loans";
import { loadSampleCards } from "@/lib/ui/samples";

export const metadata: Metadata = { title: "My loans" };

const LA_TABS = [
  { key: "queue", label: "My queue" },
  { key: "all", label: "All branch loans" },
  { key: "exceptions", label: "Problems" },
  { key: "archived", label: "Archived" },
];
const ADMIN_TABS = [
  { key: "queue", label: "Needs action" },
  { key: "all", label: "All loans" },
  { key: "exceptions", label: "Exceptions" },
  { key: "archived", label: "Archived" },
];

type SP = Record<string, string | undefined>;

export default async function LoansPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const sp = await searchParams;
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  const tabs = la ? LA_TABS : ADMIN_TABS;
  const f: LoanListFilters = {
    tab: tabs.some((t) => t.key === sp.tab) ? sp.tab : "queue",
    stage: sp.stage || undefined,
    classification: sp.classification || undefined,
    branch: sp.branch || undefined,
    area: sp.area || undefined,
    loanType: sp.loanType || undefined,
    tat: sp.tat || undefined,
    needsAction: sp.needsAction || undefined,
    holdReason: sp.holdReason || undefined,
    q: sp.q || undefined,
  };
  // Filter choices: branches as "Name (code)" in the person's scope (hidden branches left out), and their Areas.
  const branchRows = await prisma.branch.findMany({
    where: { hidden: false, ...(user.scopeBranchIds === null ? {} : { id: { in: user.scopeBranchIds } }) }, orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, area: { select: { id: true, name: true } } },
  });
  const branches = branchRows.map((b) => ({ id: b.id, name: b.name }));
  const areas = [...new Map(branchRows.filter((b) => b.area).map((b) => [b.area!.id, { id: b.area!.id, name: b.area!.name }])).values()].sort((a, z) => a.name.localeCompare(z.name));
  // Each tab with its count (same filters).
  const perTab = await Promise.all(tabs.map((t) => listLoans(user, { ...f, tab: t.key })));
  const rows = perTab[tabs.findIndex((t) => t.key === f.tab)];
  const counts = Object.fromEntries(tabs.map((t, i) => [t.key, perTab[i].length]));
  return la
    ? <LaList user={user} f={f} sp={sp} rows={rows} branches={branches} counts={counts} />
    : <AdminList f={f} rows={rows} branches={branches} areas={areas} byArea={sp.by === "area"} tabs={tabs} counts={counts} holds={await holdReasonCounts(user)}
        unfiltered={isFiltered(f) ? (await listLoans(user, { tab: f.tab })).length : null} holidays={await getHolidaySet()} />;
}

/** A filter or a search narrows the tab (then "Showing X of Y"). */
const isFiltered = (f: LoanListFilters) => [f.stage, f.classification, f.branch, f.area, f.loanType, f.tat, f.needsAction, f.holdReason, f.q].some(Boolean);

const TAT_OPTIONS: [string, string][] = [["ON_TIME", "On time"], ["DUE_TODAY", "Due today"], ["OVERDUE", "Overdue"], ["DUE_OR_OVERDUE", "Due today or overdue"]];

/** The tabs with their counts, as underline tabs; "Showing X of Y" on the right only with a filter or a search on. */
function Tabs({ tabs, current, counts, params, showing }: { tabs: { key: string; label: string }[]; current?: string; counts: Record<string, number>; params: Record<string, string | undefined>; showing?: { x: number; y: number } | null }) {
  return (
    <LoanTabs
      tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: listHref({ ...params, tab: t.key }), count: counts[t.key] ?? 0, current: current === t.key }))}
      aside={showing ? <>Showing {showing.x} of {showing.y}</> : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Loan Associate: one toolbar, the samples in one closed row (test mode), tabs, then the loan files
// ---------------------------------------------------------------------------

async function LaList({ user, f, sp, rows, branches, counts }: { user: CurrentUser; f: LoanListFilters; sp: SP; rows: LoanRow[]; branches: { id: string; name: string }[]; counts: Record<string, number> }) {
  const [holidays, samples] = await Promise.all([getHolidaySet(), loadSampleCards(user)]);
  let cards = rows.map((r) => cardFor(r, holidays));
  if (sp.group === "waiting") cards = cards.filter((c) => c.group === "wait");
  cards = sortByUrgency(cards);
  // The same stages as before (all but Cancelled in MyLoans); their names from the stage map.
  const stageOptions: [string, string][] = STAGES.filter((s) => s !== "Cancelled in MyLoans").map((s) => [s, stageLabel(s)]);
  const fields: FilterField[] = [
    { name: "stage", label: "Where it is", value: f.stage, options: stageOptions },
    { name: "branch", label: "Branch", value: f.branch, options: branches.map((b) => [b.id, b.name]) },
    { name: "loanType", label: "Loan type", value: f.loanType, options: [["New", "New"], ["Renewal", "Renewal"]] },
    { name: "tat", label: "Deadline", value: f.tat, options: [["ON_TIME", "Days left"], ["DUE_TODAY", "Due today"], ["OVERDUE", "Late"], ["DUE_OR_OVERDUE", "Due today or late"]] },
    { name: "needsAction", label: "Needs me", value: f.needsAction, options: [["1", "Yes, only loans that need me"]] },
  ];
  const params = { tab: f.tab, stage: f.stage, branch: f.branch, loanType: f.loanType, tat: f.tat, needsAction: f.needsAction, group: sp.group };
  const chips = activeChips(fields, params, [{ name: "group", text: "Waiting on others" }]);
  const filtersOn = chips.length > 0;
  // "Showing X of Y": Y is the tab without filters (one more list, only while a filter is on).
  const showing = filtersOn ? { x: cards.length, y: (await listLoans(user, { tab: f.tab })).length } : null;
  const emptyText =
    f.tab === "queue" ? "You're all caught up."
    : f.tab === "exceptions" ? "No problems."
    : f.tab === "archived" ? "Nothing archived."
    : "No loan files in your branches yet.";

  return (
    <div className="flex w-full min-w-0 flex-col gap-3" data-my-loans="la">
      <h1 className="text-[22px] font-semibold leading-tight text-navy">My loans</h1>
      <LoansToolbar
        search={{ action: "/search", defaultValue: sp.fill ?? "", autoFocus: sp.find === "1" || !!sp.fill, buttonLabel: "Find loan", suggest: true }}
        filters={{ fields, hidden: { tab: f.tab, group: sp.group }, activeCount: chips.length, clearHref: clearAllHref(params) }}
        resultCount={cards.length}
      />
      <FilterChips chips={chips} clearHref={clearAllHref(params)} />
      {samples.samples.length > 0 && (
        <SampleLoans id="find-samples" title="Sample loans" intro="Pick one, then press Find loan." samples={samples.samples} collapsed />
      )}
      {samples.dataCheck.length > 0 && (
        <SampleLoans id="find-datacheck" title="Data-check samples" intro="These test the checks that refuse a loan." samples={samples.dataCheck} collapsed />
      )}
      <Tabs tabs={LA_TABS} current={f.tab} counts={counts} params={params} showing={showing} />
      {cards.length === 0
        ? <EmptyLine text={filtersOn ? "No loans match." : emptyText} clearHref={filtersOn ? clearAllHref(params) : undefined} done={!filtersOn && (f.tab === "queue" || f.tab === "exceptions")} />
        : <MyLoansList cards={cards} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: one toolbar (search, Filters, Export CSV), chips, segmented tabs, table
// ---------------------------------------------------------------------------

/**
 * Open holds by reason (loan files in scope, not archived): one chip per reason with how many loan
 * files have such a hold. The reason is the copy stored on the hold, so a later rename does not move it.
 */
async function holdReasonCounts(user: CurrentUser) {
  const open = await prisma.hold.findMany({ where: { resumedAt: null, loan: { ...loanScope(user), archivedAt: null } }, select: { loanId: true, reasonId: true, reasonName: true, reason: { select: { name: true } } } });
  const m = new Map<string, { id: string; name: string; loans: Set<string> }>();
  for (const h of open) {
    const e = m.get(h.reasonId) ?? { id: h.reasonId, name: h.reasonName || h.reason.name, loans: new Set<string>() };
    e.loans.add(h.loanId);
    m.set(h.reasonId, e);
  }
  const reasons = await prisma.holdReason.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }], select: { id: true, name: true } });
  return {
    chips: [...m.values()].map((e) => ({ id: e.id, name: e.name, count: e.loans.size })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    options: [["ANY", "Any hold"], ...reasons.map((r) => [r.id, r.name])] as [string, string][],
  };
}

function AdminList({ f, rows, branches, areas, byArea, tabs, counts, holds, unfiltered, holidays }: { f: LoanListFilters; rows: LoanRow[]; branches: { id: string; name: string }[]; areas: { id: string; name: string }[]; byArea: boolean; tabs: { key: string; label: string }[]; counts: Record<string, number>; holds: Awaited<ReturnType<typeof holdReasonCounts>>; unfiltered: number | null; holidays: ReadonlySet<string> }) {
  const fields: FilterField[] = [
    { name: "stage", label: "Stage", value: f.stage, options: STAGES.map((s) => [s, stageLabel(s)]) },
    { name: "classification", label: "Classification", value: f.classification, options: [["FINANCING", "Financing"], ["REFINANCING", "Refinancing"]] },
    { name: "area", label: "Area", value: f.area, options: areas.map((a) => [a.id, a.name]) },
    { name: "branch", label: "Branch", value: f.branch, options: branches.map((b) => [b.id, b.name]) },
    { name: "loanType", label: "Loan type", value: f.loanType, options: [["New", "New"], ["Renewal", "Renewal"]] },
    { name: "tat", label: "TAT", value: f.tat, options: TAT_OPTIONS },
    { name: "needsAction", label: "Needs action", value: f.needsAction, options: [["1", "Yes"]] },
    { name: "holdReason", label: "On hold", value: f.holdReason, options: holds.options },
  ];
  const params = { tab: f.tab, stage: f.stage, classification: f.classification, area: f.area, branch: f.branch, loanType: f.loanType, tat: f.tat, needsAction: f.needsAction, holdReason: f.holdReason, q: f.q, by: byArea ? "area" : undefined };
  const chips = activeChips(fields, params);
  const filtersOn = chips.length > 0 || !!f.q;
  const showing = filtersOn && unfiltered !== null ? { x: rows.length, y: unfiltered } : null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-3" data-my-loans="read-only">
      <h1 className="text-[22px] font-semibold leading-tight text-navy">Loans</h1>
      <LoansToolbar
        search={{ action: "/loans", defaultValue: f.q ?? "", required: false, hidden: { ...params, q: undefined } }}
        filters={{ fields, hidden: { tab: f.tab, q: f.q, by: params.by }, activeCount: chips.length, clearHref: clearAllHref(params) }}
        resultCount={rows.length}
      />
      <FilterChips chips={chips} clearHref={clearAllHref(params)} />
      <Tabs tabs={tabs} current={f.tab} counts={counts} params={params} showing={showing} />
      {holds.chips.length > 0 && (
        <nav aria-label="On hold by reason" className="flex flex-wrap items-center gap-1.5" data-hold-reason-chips>
          <span className="mr-1 text-[12px] text-ink-2">On hold by reason</span>
          {holds.chips.map((c) => (
            <Link key={c.id} href={listHref({ ...params, holdReason: f.holdReason === c.id ? undefined : c.id })} aria-current={f.holdReason === c.id ? "true" : undefined}
              className={`chip c-hold h-6 text-[12px] no-underline ${f.holdReason === c.id ? "ring-2 ring-[var(--hold-stripe)]" : ""}`} data-hold-reason={c.name}>
              {c.name} ({c.count})
            </Link>
          ))}
        </nav>
      )}
      {rows.length > 0 && (
        <div className="-my-2 flex justify-end">
          <Link href={listHref({ ...params, by: byArea ? undefined : "area" })} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2" aria-pressed={byArea} data-group-by-area>
            {byArea ? "Show as one list" : "Group by area and branch"}
          </Link>
        </div>
      )}
      {rows.length === 0
        ? <EmptyLine text={filtersOn ? (f.q ? `No loans match "${f.q}".` : "No loans match.") : "No loan files here yet."} clearHref={filtersOn ? listHref({ tab: f.tab }) : undefined}
            note={!filtersOn && isTestMode() ? "Sample loans are opened from My loans by a Loan Associate." : undefined} />
        : <LoanTable rows={rows} grouped={byArea} holidays={holidays} />}
    </div>
  );
}
