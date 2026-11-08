import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission, can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { listLoans, type LoanListFilters, type LoanRow } from "@/lib/services/queries";
import { getHolidaySet } from "@/lib/settings";
import { STAGES } from "@/lib/workflow/stage";
import { STAGE_WORDS } from "@/lib/ui/plain";
import { cardFor, sortByUrgency } from "@/lib/ui/loan-cards";
import { LoanCard } from "@/components/ui/loan-card";
import { LoansToolbar } from "@/components/loan/loans-toolbar";
import { getMyLoansAdapter } from "@/lib/myloans";
import { EmptyLoans, LoanTable } from "@/components/loan/loan-table";
import { activeChips, clearAllHref, listHref, type FilterField } from "@/lib/ui/loan-filters";
import { isTestMode } from "@/lib/test-mode";
import { PageHeader } from "@/components/ui/basics";
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
    loanType: sp.loanType || undefined,
    tat: sp.tat || undefined,
    needsAction: sp.needsAction || undefined,
    q: sp.q || undefined,
  };
  const branches = await prisma.branch.findMany({ where: user.scopeBranchIds === null ? {} : { id: { in: user.scopeBranchIds } }, orderBy: { name: "asc" } });
  // Each tab with its count (same filters).
  const perTab = await Promise.all(tabs.map((t) => listLoans(user, { ...f, tab: t.key })));
  const rows = perTab[tabs.findIndex((t) => t.key === f.tab)];
  const counts = Object.fromEntries(tabs.map((t, i) => [t.key, perTab[i].length]));
  return la
    ? <LaList f={f} sp={sp} rows={rows} branches={branches} counts={counts} />
    : <AdminList user={user} f={f} rows={rows} branches={branches} tabs={tabs} counts={counts} />;
}

function qs(f: LoanListFilters, over: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...over })) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

const TAT_OPTIONS: [string, string][] = [["ON_TIME", "On time"], ["DUE_TODAY", "Due today"], ["OVERDUE", "Overdue"], ["DUE_OR_OVERDUE", "Due today or overdue"]];

/** Tabs as a segmented control with counts; scrolls sideways on phone without a scrollbar. */
function Segments({ tabs, current, counts, params }: { tabs: { key: string; label: string }[]; current?: string; counts: Record<string, number>; params: Record<string, string | undefined> }) {
  return (
    <nav aria-label="Loan lists" className="seg self-start">
      {tabs.map((t) => (
        <Link key={t.key} href={listHref({ ...params, tab: t.key })} aria-current={current === t.key ? "page" : undefined} className="seg-item">
          {t.label}<span className="seg-count">{counts[t.key] ?? 0}</span>
        </Link>
      ))}
    </nav>
  );
}

/** "Showing 24 loan files" and the active-filter chips, in one thin row. */
function ResultLine({ count, chips, clearHref, extra }: { count: number; chips: { text: string; removeHref: string }[]; clearHref: string; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-2 text-[15px] text-ink-2" role="status">Showing {count} loan file{count === 1 ? "" : "s"}{extra ?? ""}</p>
      {chips.map((c) => (
        <Link key={c.text} href={c.removeHref} className="chip c-mute h-8 gap-1.5 text-sm no-underline hover:bg-fill-strong" aria-label={`Remove filter ${c.text}`}>
          {c.text} <span aria-hidden="true">×</span>
        </Link>
      ))}
      {chips.length > 0 && <Link href={clearHref} className="link text-sm">Clear all</Link>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loan Associate: compact search, the sample loans in one row, then the loan files
// ---------------------------------------------------------------------------

async function LaList({ f, sp, rows, branches, counts }: { f: LoanListFilters; sp: SP; rows: LoanRow[]; branches: { id: string; name: string }[]; counts: Record<string, number> }) {
  const [holidays, samples] = await Promise.all([getHolidaySet(), loadSampleCards()]);
  let cards = rows.map((r) => cardFor(r, holidays));
  if (sp.group === "waiting") cards = cards.filter((c) => c.group === "wait");
  cards = sortByUrgency(cards);
  const stageOptions: [string, string][] = STAGES.filter((s) => STAGE_WORDS[s]).map((s) => [s, STAGE_WORDS[s]]);
  const fields: FilterField[] = [
    { name: "stage", label: "Where it is", value: f.stage, options: stageOptions },
    { name: "branch", label: "Branch", value: f.branch, options: branches.map((b) => [b.id, b.name]) },
    { name: "loanType", label: "Loan type", value: f.loanType, options: [["New", "New"], ["Renewal", "Renewal"]] },
    { name: "tat", label: "Deadline", value: f.tat, options: [["ON_TIME", "Days left"], ["DUE_TODAY", "Due today"], ["OVERDUE", "Late"], ["DUE_OR_OVERDUE", "Due today or late"]] },
    { name: "needsAction", label: "Needs me", value: f.needsAction, options: [["1", "Yes, only loans that need me"]] },
  ];
  const params = { tab: f.tab, stage: f.stage, branch: f.branch, loanType: f.loanType, tat: f.tat, needsAction: f.needsAction, group: sp.group };
  const chips = activeChips(fields, params, [{ name: "group", text: "Waiting on others" }]);
  const emptyText =
    f.tab === "queue" ? "You are all caught up. Nothing needs you right now."
    : f.tab === "exceptions" ? "No problems to fix. Nice."
    : f.tab === "archived" ? "No archived loan files yet."
    : "No loan files here yet.";

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title="My loans" help="Find a loan by its number, or open one of your loan files below." />
      <LoansToolbar
        search={{ action: "/search", defaultValue: sp.fill ?? "", autoFocus: sp.find === "1" || !!sp.fill, buttonLabel: "Find loan", suggest: { exactOnly: !getMyLoansAdapter().capabilities.search } }}
        filters={{ fields, hidden: { tab: f.tab, group: sp.group }, activeCount: chips.length, clearHref: clearAllHref(params) }}
        resultCount={cards.length}
      />
      {samples.samples.length > 0 && (
        <SampleLoans id="find-samples" title="Sample loans" intro="Pick one to put its PN in the box above, then press Find loan." samples={samples.samples} row />
      )}
      {samples.dataCheck.length > 0 && (
        <SampleLoans id="find-datacheck" title="Data-check samples" intro="These test the checks that refuse a loan." samples={samples.dataCheck} row />
      )}
      <Segments tabs={LA_TABS} current={f.tab} counts={counts} params={params} />
      <ResultLine count={cards.length} chips={chips} clearHref={clearAllHref(params)} />
      {cards.length === 0 ? (
        <EmptyLoans filtersOn={chips.length > 0} clearHref={clearAllHref(params)} testMode={false} text={emptyText} />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((c) => <LoanCard key={c.pn} d={c} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: one toolbar (search, Filters, Export CSV), chips, segmented tabs, table
// ---------------------------------------------------------------------------

function AdminList({ user, f, rows, branches, tabs, counts }: { user: CurrentUser; f: LoanListFilters; rows: LoanRow[]; branches: { id: string; name: string }[]; tabs: { key: string; label: string }[]; counts: Record<string, number> }) {
  const exportAllowed = can(user, PERMISSIONS.LOANS_EXPORT);
  const fields: FilterField[] = [
    { name: "stage", label: "Stage", value: f.stage, options: STAGES.map((s) => [s, s]) },
    { name: "classification", label: "Classification", value: f.classification, options: [["FINANCING", "Financing"], ["REFINANCING", "Refinancing"]] },
    { name: "branch", label: "Branch", value: f.branch, options: branches.map((b) => [b.id, b.name]) },
    { name: "loanType", label: "Loan type", value: f.loanType, options: [["New", "New"], ["Renewal", "Renewal"]] },
    { name: "tat", label: "TAT", value: f.tat, options: TAT_OPTIONS },
    { name: "needsAction", label: "Needs action", value: f.needsAction, options: [["1", "Yes"]] },
  ];
  const params = { tab: f.tab, stage: f.stage, classification: f.classification, branch: f.branch, loanType: f.loanType, tat: f.tat, needsAction: f.needsAction, q: f.q };
  const chips = activeChips(fields, params);
  const filtersOn = chips.length > 0 || !!f.q;
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <PageHeader title="Loans" help="Read-only view of all branches." />
      <LoansToolbar
        search={{ action: "/loans", defaultValue: f.q ?? "", required: false, hidden: { ...params, q: undefined } }}
        filters={{ fields, hidden: { tab: f.tab, q: f.q }, activeCount: chips.length, clearHref: clearAllHref(params) }}
        exportHref={exportAllowed ? `/api/loans/export${qs(f, {})}` : undefined}
        resultCount={rows.length}
      />
      <Segments tabs={tabs} current={f.tab} counts={counts} params={params} />
      <ResultLine count={rows.length} chips={chips} clearHref={clearAllHref(params)} extra={f.q ? ` matching "${f.q}"` : ""} />
      {rows.length === 0
        ? <EmptyLoans filtersOn={filtersOn} clearHref={listHref({ tab: f.tab })} testMode={isTestMode()} />
        : <LoanTable rows={rows} />}
    </div>
  );
}
