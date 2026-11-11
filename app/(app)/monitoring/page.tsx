import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { notFound } from "next/navigation";
import { can, requireUser, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate, fmtDate, isBusinessDay } from "@/lib/time";
import { getHolidaySet } from "@/lib/settings";
import { peso } from "@/lib/funds/rules";
import {
  dpByDay, dpDrill, dpMonitor, filterOptions, measured, missingPapersCount, missingPapersMonitor, ltoByDay, ltoDrill, ltoMonitor, monitorHref, parseMonitorQuery,
  type Avg, type ByDay, type DpGroup, type DpMonitor, type DpRow, type DrillJob, type LtoDrillJob, type LtoGroup, type LtoMonitor, type LtoRow, type MonitorQuery, type MonitorSearch,
} from "@/lib/services/monitoring";
import {
  AVAILABILITY, AVAILABILITY_LABEL, AVAILABILITY_TONE, DEFAULT_PRESET, countTone, daysText, showSubtotal, usageBar, ymdAdd, type Availability,
} from "@/lib/monitoring/rules";
import type { AdvisoryView } from "@/lib/services/lto-advisories";
import { ToneChip } from "@/components/ui/basics";
import { ChevronDownIcon, ChevronRightIcon, WarningIcon } from "@/components/ui/icons";
import { FilterBar } from "@/components/monitoring/filter-bar";
import { MonitoringSkeleton } from "@/components/monitoring/skeleton";
import { RouteSheet } from "@/components/monitoring/route-sheet";
import { EditAdvisoryButton, ReportLtoProblemButton, ResolveAdvisoryButton } from "@/components/monitoring/advisory-forms";

export const metadata: Metadata = { title: "Monitoring" };

const HOLD_NOTE = "Includes time on hold";

/**
 * Monitoring (design only: every number comes from lib/services/monitoring.ts as before).
 * Widths: a full table from 1024 px; a compact table with a Details toggle from 640 to 1023 px (no
 * sideways scroll); cards under 640 px. The three are in the page together and CSS shows one.
 */
export default async function MonitoringPage({ searchParams }: { searchParams: Promise<MonitorSearch> }) {
  const user = await requireUser();
  const canDp = can(user, PERMISSIONS.MONITOR_DP), canLto = can(user, PERMISSIONS.MONITOR_LTO);
  if (!canDp && !canLto) notFound();
  const sp = await searchParams;
  // A tab the person may not see is refused (not found), never shown.
  if ((sp.tab === "dp" && !canDp) || (sp.tab === "lto" && !canLto)) notFound();
  const now = new Date();
  const today = businessDate(now);
  const q = parseMonitorQuery(sp, user, today);
  // The checks above run before anything is sent (a refused tab is a real 404); the numbers then stream in
  // behind a skeleton (keyed by the query, so a new range or filter shows the skeleton again).
  const [opts, holidays, missingCount] = await Promise.all([filterOptions(user), getHolidaySet(), missingPapersCount(user, q)]);
  const day = q.view === "day";
  // The date range keeps every other filter (and drops an open drill-down).
  const keep = Object.fromEntries(new URLSearchParams(monitorHref(q, { range: null, from: null, to: null, open: null, ...(day ? {} : { dp: null, office: null }) }).split("?")[1] ?? ""));
  const changed = !!(q.areaId || q.branchId || q.typeCode || (day && (q.dpId || q.officeId)) || q.range.preset !== DEFAULT_PRESET);
  const resetHref = changed ? `/monitoring?tab=${q.tab}${day ? "&view=day" : ""}` : null;
  const recent = ymdAdd(today, -800);

  return (
    <div className="dense flex w-full flex-col gap-4" data-monitoring={q.tab}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.015em] text-navy sm:text-[28px]">Monitoring: {q.range.label}</h1>
          <p className="mt-1 text-[14px] text-ink-2" data-page-note>
            Philippine time · business days · {HOLD_NOTE.toLowerCase()} · <a href="#how-counted" className="text-ink-2 no-underline hover:text-navy hover:underline">How is this counted?</a>
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Monitoring" className="seg seg-navy">
          {canDp && <Link href={monitorHref(q, { tab: "dp", dp: null, office: null, open: null, hide: null })} className="seg-item" aria-current={q.tab === "dp" ? "page" : undefined}>DPs</Link>}
          {canLto && <Link href={monitorHref(q, { tab: "lto", dp: null, office: null, open: null, hide: null })} className="seg-item" aria-current={q.tab === "lto" ? "page" : undefined}>LTO offices</Link>}
        </nav>
        <div className="seg seg-navy" role="group" aria-label="View">
          <Link href={monitorHref(q, { view: null, open: null })} className="seg-item" aria-current={q.view === "totals" ? "page" : undefined}>Totals</Link>
          <Link href={monitorHref(q, { view: "day", open: null })} className="seg-item" aria-current={day ? "page" : undefined}>By day</Link>
        </div>
        {/* A filter (as of now): the loan files with a paper marked Missing. No alerts and no emails. */}
        <Link href={monitorHref(q, { missing: q.missing ? null : "1", open: null })} aria-pressed={q.missing}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold no-underline sm:min-h-9 ${q.missing ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-fill"}`} data-missing-filter>
          Has missing papers
          <span className={`tabular-nums text-xs ${q.missing ? "text-white/80" : missingCount ? "text-act-fg" : "text-ink-2"}`} data-missing-count>{missingCount}</span>
        </Link>
      </div>
      <FilterBar
        tab={q.tab} view={q.view} preset={q.range.preset} from={q.range.from} to={q.range.to} today={today} area={q.areaId ?? ""} branch={q.branchId ?? ""} type={q.typeCode ?? ""}
        holidays={[...holidays].filter((h) => h >= recent && h <= today)} keep={keep} resetHref={resetHref}
        areas={opts.areas} branches={opts.branches} types={opts.types}
        who={day ? (q.tab === "dp" ? { name: "dp", label: "Processor", value: q.dpId ?? "", options: opts.dps } : { name: "office", label: "LTO office", value: q.officeId ?? "", options: opts.offices }) : null}
      />
      {q.range.error && <p role="alert" className="rounded-xl border border-bad-line bg-bad-bg px-4 py-2 text-[15px] text-bad-fg">{q.range.error} Showing {q.range.label} instead.</p>}
      <Suspense key={monitorHref(q)} fallback={<MonitoringSkeleton />}>
        <Body user={user} q={q} now={now} holidays={holidays} offices={opts.offices.filter((x) => x.active)} />
      </Suspense>
      <HowCounted tab={q.tab} />
    </div>
  );
}

/** The tiles and tables of the tab, with the page time (the data work of the page) under them. */
async function Body({ user, q, now, holidays, offices }: { user: CurrentUser; q: MonitorQuery; now: Date; holidays: ReadonlySet<string>; offices: { id: string; name: string }[] }) {
  const { value, ms } = await measured(() => (q.missing ? MissingTab({ user, q, now }) : q.tab === "dp" ? DpTab({ user, q, now, holidays }) : LtoTab({ user, q, now, holidays, offices })));
  return (
    <>
      {value}
      <p className="order-last text-[12px] text-ink-2" data-page-time data-ms={ms}>Page built in {ms} ms.</p>
    </>
  );
}

/**
 * "Has missing papers": each loan file with a paper marked Missing, which papers and how many days
 * (as of now; the date range does not apply). Area, Branch and Transaction filters apply.
 */
async function MissingTab({ user, q, now }: { user: CurrentUser; q: MonitorQuery; now: Date }) {
  const rows = await missingPapersMonitor(user, q, now);
  const papers = rows.reduce((n, r) => n + r.papers.length, 0);
  return (
    <section aria-labelledby="missing-list-h" className="card flex flex-col gap-2 p-3 sm:p-4" data-missing-list>
      <h2 id="missing-list-h" className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-bold text-navy">
        Loan files with missing papers <span className="text-[13px] font-normal text-ink-2">{rows.length} file{rows.length === 1 ? "" : "s"} · {papers} paper{papers === 1 ? "" : "s"} · as of now</span>
      </h2>
      {rows.length === 0 ? <p className="text-sm text-ink-2" data-missing-empty>No paper is marked Missing.</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.loanId} className="flex flex-col gap-1 py-2" data-missing-loan={r.pn}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                {r.href ? <Link href={r.href} className="mono font-semibold text-navy">{r.pn}</Link> : <span className="mono font-semibold">{r.pn}</span>}
                <span className="text-[13px] text-ink-2">{r.borrower} · {r.branch} · {r.stage}</span>
              </p>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {r.papers.map((p, i) => (
                  <li key={`${p.label}-${i}`} className="flex flex-wrap gap-x-1.5">
                    <span className="font-semibold text-ink">{p.label}</span>
                    <span className="text-ink-2">· {p.txnName} · {p.reason ?? "No reason yet"} ·</span>
                    <span className={p.days > 0 ? "font-semibold text-act-fg" : "text-ink-2"} data-days={p.days}>{p.days === 0 ? "since today" : `${p.days} day${p.days === 1 ? "" : "s"} missing`}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** A KPI tile: small label, big navy number, one grey line. Attention tiles tint only above 0. */
function Tile({ label, value, sub, now, tint, first, order }: {
  label: string; value: string | number; sub?: string; now?: boolean; tint?: "bad" | "hold" | null; first?: boolean; order?: string;
}) {
  const bg = tint === "bad" ? "border-bad-line bg-bad-bg" : tint === "hold" ? "border-hold-line bg-hold-bg" : "border-line bg-white";
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-[14px] border p-3 ${bg} ${first ? "shadow-[inset_3px_0_0_var(--gold)]" : ""} ${order ?? ""}`} data-tile={label} data-tint={tint ?? "none"}>
      <p className="text-[12px] font-semibold text-ink-2">{label}</p>
      <p className={`text-[26px] font-bold leading-tight tabular-nums ${tint === "bad" ? "text-bad-fg" : tint === "hold" ? "text-hold-fg" : "text-navy"}`}>{value}</p>
      {sub && <p className="text-[12px] leading-snug text-ink-2">{sub}</p>}
      {now && <span className="mt-auto self-start rounded-full border border-line bg-white/70 px-1.5 text-[12px] font-medium leading-5 text-ink-2">As of now</span>}
    </div>
  );
}

const TONE_CLASS = { zero: "n-zero", plain: "", bad: "n-bad", hold: "n-hold" } as const;
/** A count: zero in light grey; Overdue above 0 in red and On hold above 0 in amber; the rest navy. */
function Num({ n, kind = "plain" }: { n: number; kind?: "overdue" | "onHold" | "plain" }) {
  return <span className={TONE_CLASS[countTone(n, kind)]} data-tone={countTone(n, kind)}>{n}</span>;
}

const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
/** An average: the value with "N jobs" under it; a dash alone when no job was finished. */
function AvgCell({ a }: { a: Avg }) {
  if (!a.n) return <span className="n-zero" title="No jobs">-<span className="sr-only"> (no jobs)</span></span>;
  return <span className="whitespace-nowrap">{daysText(a.days)}<span className="block text-[12px] text-ink-2">{jobs(a.n)}</span></span>;
}
const avgLine = (a: Avg) => (a.n ? `${daysText(a.days)} · ${jobs(a.n)}` : "-");

function StatusChip({ a, until, stacked = false }: { a: Availability; until: string | null; stacked?: boolean }) {
  if (stacked && a.status === "ON_LEAVE" && until) {
    return <span className="inline-flex flex-col items-start gap-0.5"><ToneChip tone="mute">On leave</ToneChip><span className="whitespace-nowrap text-[12px] text-ink-2">until {fmtDate(until)}</span></span>;
  }
  const label = a.status === "ON_LEAVE" && until ? `On leave until ${fmtDate(until)}` : AVAILABILITY_LABEL[a.status];
  return <ToneChip tone={AVAILABILITY_TONE[a.status]}>{label}</ToneChip>;
}

const BAR = { ok: "bg-ok-line", act: "bg-hold-line", bad: "bg-bad-line", mute: "bg-mute-line" } as const;
/** The usage bar (jobs in use out of capacity), with "60%" and "2 of 5 in use" beside it (the same words as before). */
function UsageBar({ a, inline = false }: { a: Availability; inline?: boolean }) {
  const u = usageBar(a);
  return (
    <span className={`flex gap-x-2 gap-y-1 ${inline ? "items-center" : "flex-col items-end"}`} title={a.text} aria-label={a.text} data-usage={u.tone}>
      <span className={`relative h-2 shrink-0 overflow-hidden rounded-full bg-mute-bg ring-1 ring-inset ring-mute-line ${inline ? "w-20" : "w-full max-w-[84px]"}`} aria-hidden="true">
        <span className={`absolute inset-y-0 left-0 rounded-full ${BAR[u.tone]}`} style={{ width: `${u.pct}%` }} />
      </span>
      <span className={`whitespace-nowrap leading-tight ${inline ? "text-left" : "text-right"}`}>
        <strong className="tabular-nums">{a.pct}%</strong>
        {inline ? <span className="text-[12px] text-ink-2"> · {a.open} of {a.capacity} in use</span> : <span className="block text-[12px] text-ink-2">{a.open} of {a.capacity} in use</span>}
      </span>
    </span>
  );
}

function GroupToggle({ q, k, label, open }: { q: MonitorQuery; k: string; label: string; open: boolean }) {
  const hide = open ? [...q.collapsed, k] : q.collapsed.filter((x) => x !== k);
  return (
    <Link href={monitorHref(q, { hide: hide.join(",") || null, open: null })} scroll={false} aria-expanded={open} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-bold text-navy no-underline" data-group-toggle={label}>
      {open ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />} {label}
    </Link>
  );
}

/** The Area band: navy tint, bold name, a small grey count pill, the collapse chevron. */
function Band({ q, k, label, open, count }: { q: MonitorQuery; k: string; label: string; open: boolean; count: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <GroupToggle q={q} k={k} label={label} open={open} />
      <span className="rounded-full border border-line bg-white px-2 text-[12px] font-medium leading-5 text-ink-2">{count}</span>
    </span>
  );
}

function Pn({ j }: { j: { pn: string; href: string | null } }) {
  return j.href ? <Link href={j.href} className="link font-semibold">{j.pn}</Link> : <span className="font-semibold" data-pn-plain>{j.pn}</span>;
}

function BranchChips({ names }: { names: string[] }) {
  if (!names.length) return null;
  const shown = names.slice(0, 6);
  const chip = "inline-flex h-6 items-center whitespace-nowrap rounded-full border border-line px-2 text-[12px] font-medium text-ink-2";
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-branch-chips>
      {shown.map((n) => <span key={n} className={chip}>{n}</span>)}
      {names.length > shown.length && <span className={chip}>+{names.length - shown.length} more</span>}
    </span>
  );
}

/** "Details" (820) and "More" (390): an inline expand with the less important numbers. Native, no script. */
function MoreToggle({ label, items, attr }: { label: string; items: [string, React.ReactNode][]; attr: string }) {
  return (
    <details className="group mt-1" {...{ [attr]: "" }}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-navy [&::-webkit-details-marker]:hidden">
        <span className="transition-transform group-open:rotate-90"><ChevronRightIcon size={16} /></span> {label}
      </summary>
      <dl className="flex max-w-xs flex-col pb-1 text-[13px] motion-safe:animate-[fadein_120ms_ease-out]">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-1 last:border-0"><dt className="text-ink-2">{k}</dt><dd className="text-right font-medium text-navy tabular-nums">{v}</dd></div>
        ))}
      </dl>
    </details>
  );
}

/** Nothing happened in the dates chosen: a calm line, and Last 30 days when another range is chosen. */
function Empty({ q, text = "No jobs in this period. Try a wider date range." }: { q: MonitorQuery; text?: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[14px] border border-line bg-white px-4 py-5 sm:flex-row sm:items-center sm:justify-between" data-empty>
      <p className="text-[15px] text-ink-2">{text}</p>
      {q.range.preset !== DEFAULT_PRESET && <Link href={monitorHref(q, { range: null, from: null, to: null, open: null })} className="btn-ghost btn-sm">Last 30 days</Link>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DP monitor
// ---------------------------------------------------------------------------

async function DpTab({ user, q, now, holidays }: { user: CurrentUser; q: MonitorQuery; now: Date; holidays: ReadonlySet<string> }) {
  if (q.view === "day") return <ByDayTable d={await dpByDay(user, q)} q={q} what="processor" holidays={holidays} />;
  const [m, drill] = await Promise.all([dpMonitor(user, q, now), q.open && q.dpId ? dpDrill(user, q, q.dpId, now) : Promise.resolve(null)]);
  // Nothing happened in the dates chosen (open jobs are "as of now", so they do not count here).
  const quiet = m.rows.every((r) => !(r.declined + r.returned + r.finished));
  return (
    <>
      <DpTiles m={m} />
      {quiet && m.rows.length > 0 && <Empty q={q} />}
      <DpTable m={m} q={q} />
      {drill && (
        <RouteSheet title={drill.name} closeHref={monitorHref(q, { open: null, dp: null })}>
          <div className="flex flex-col gap-4">
            <p className="text-[15px]">{drill.group} · <StatusChip a={drill.avail} until={drill.leaveUntil} /> <span className="text-ink-2">{drill.avail.text}</span></p>
            <BranchChips names={drill.branches} />
            <p className="text-[13px] text-ink-2">Open jobs as of now. Declined and returned: {q.range.label}. {HOLD_NOTE}.</p>
            <DrillList title="Open jobs" rows={drill.open} empty="No open jobs." kind="open" />
            <DrillList title="Declined in the period" rows={drill.declined} empty="None declined." kind="back" />
            <DrillList title="Returned to the LA in the period" rows={drill.returned} empty="None returned." kind="back" />
          </div>
        </RouteSheet>
      )}
    </>
  );
}

function DpTiles({ m }: { m: DpMonitor }) {
  const t = m.tiles;
  // Phones: two columns, Overdue and Average availability first. 820: four then three. 1440: one row of seven.
  const rest = "order-3 sm:order-none";
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-tiles>
      <Tile first order={rest} label="Active DPs" value={t.activeDps} sub="Processors in these branches" />
      <Tile order={rest} label="Assigned" value={t.assigned} sub="Waiting to accept" now />
      <Tile order={rest} label="In process" value={t.inProcess} sub="Accepted, not done" now />
      <Tile order={rest} label="On hold" value={t.onHold} sub="Open jobs on hold" now tint={t.onHold > 0 ? "hold" : null} />
      <Tile order="order-1 sm:order-none" label="Overdue" value={t.overdue} sub="Past the step's due date" now tint={t.overdue > 0 ? "bad" : null} />
      <Tile order={rest} label="Average total TAT" value={daysText(t.avgTotal.days)} sub={`${jobs(t.avgTotal.n)} finished · ${HOLD_NOTE.toLowerCase()}`} />
      <Tile order="order-2 sm:order-none" label="Average availability" value={t.avgAvailability === null ? "-" : `${t.avgAvailability}%`} sub="On leave not counted" now />
    </section>
  );
}

const count = (n: number) => `${n} processor${n === 1 ? "" : "s"}`;
const dpMore = (r: { declined: number; returned: number; accept: Avg; processing: Avg; total: Avg }): [string, React.ReactNode][] => [
  ["Declined", <Num key="d" n={r.declined} />], ["Returned", <Num key="r" n={r.returned} />],
  ["Avg time to accept", avgLine(r.accept)], ["Avg processing", avgLine(r.processing)], ["Avg total", avgLine(r.total)],
];

/** Subtotal cells of the full table (13 columns). */
function SubCells({ s }: { s: DpGroup["sub"] }) {
  return (
    <>
      <td className="num"><Num n={s.assigned} /></td><td className="num"><Num n={s.inProcess} /></td><td className="num"><Num n={s.onHold} kind="onHold" /></td><td className="num"><Num n={s.overdue} kind="overdue" /></td>
      <td className="num"><Num n={s.declined} /></td><td className="num"><Num n={s.returned} /></td>
      <td className="num"><AvgCell a={s.accept} /></td><td className="num"><AvgCell a={s.processing} /></td><td className="num"><AvgCell a={s.total} /></td>
      <td className="num">-</td><td className="num whitespace-nowrap">{s.availPct === null ? "-" : `${s.availPct}% average`}</td><td />
    </>
  );
}
/** Subtotal cells of the compact table (7 columns). */
function SubCellsCompact({ s }: { s: DpGroup["sub"] }) {
  return (
    <>
      <td className="num"><Num n={s.assigned} /></td><td className="num"><Num n={s.inProcess} /></td><td className="num"><Num n={s.onHold} kind="onHold" /></td><td className="num"><Num n={s.overdue} kind="overdue" /></td>
      <td className="num whitespace-nowrap">{s.availPct === null ? "-" : `${s.availPct}% average`}</td><td />
    </>
  );
}
const subLine = (s: DpGroup["sub"]) => `${s.assigned + s.inProcess + s.onHold} open · ${s.overdue} overdue${s.availPct === null ? "" : ` · ${s.availPct}% average availability`}`;

function DpTable({ m, q }: { m: DpMonitor; q: MonitorQuery }) {
  if (!m.rows.length) return <Empty q={q} text="No processors in these branches." />;
  const link = (r: DpRow) => monitorHref(q, { dp: r.id, open: "1" });
  const nameLink = (r: DpRow) => <Link href={link(r)} scroll={false} className="font-semibold text-navy no-underline hover:underline" aria-label={`${r.name}: open jobs, declined and returned`}>{r.name}</Link>;
  const caption = <caption className="sr-only">Processors by area, then branch. Assigned, in process, on hold and overdue as of now; the rest for {q.range.label}.</caption>;
  return (
    <section aria-label="Processors" className="flex flex-col gap-3">
      {/* 1024 px and wider: every column. */}
      <div className="hidden overflow-x-auto rounded-[14px] border border-line bg-white lg:block">
        <table className="mon2" data-dp-table>
          {caption}
          <thead>
            <tr>
              <th scope="col">Processor</th>
              <th scope="col">Assigned</th><th scope="col">In process</th><th scope="col">On hold</th><th scope="col">Overdue</th>
              <th scope="col">Declined</th><th scope="col">Returned</th>
              <th scope="col">Avg time to accept</th><th scope="col">Avg processing</th><th scope="col">Avg total</th>
              <th scope="col">Capacity</th><th scope="col">Availability</th><th scope="col" className="al">Status</th>
            </tr>
          </thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="mon-band"><th scope="rowgroup" colSpan={13}><Band q={q} k={g.key} label={g.label} open={open} count={count(g.rows.length)} /></th></tr>
                {open && g.branches.map((bg) => (
                  <Fragment key={bg.key}>
                    <tr data-branch-group={bg.label}><th scope="rowgroup" colSpan={13} className="pl-6 text-left text-[13px] font-normal text-ink-2">{bg.label}</th></tr>
                    {bg.rows.map((r) => (
                      <tr key={r.id} data-row data-dp-row={r.name}>
                        <th scope="row" className="pl-6 text-left font-normal">{nameLink(r)}{r.branches.length > 1 && <BranchChips names={r.branches} />}</th>
                        <td className="num"><Num n={r.assigned} /></td><td className="num"><Num n={r.inProcess} /></td><td className="num"><Num n={r.onHold} kind="onHold" /></td><td className="num"><Num n={r.overdue} kind="overdue" /></td>
                        <td className="num"><Num n={r.declined} /></td><td className="num"><Num n={r.returned} /></td>
                        <td className="num"><AvgCell a={r.accept} /></td><td className="num"><AvgCell a={r.processing} /></td><td className="num"><AvgCell a={r.total} /></td>
                        <td className="num">{r.avail.capacity}</td>
                        <td className="num"><UsageBar a={r.avail} /></td>
                        <td><StatusChip a={r.avail} until={r.leaveUntil} stacked /></td>
                      </tr>
                    ))}
                    {showSubtotal(bg.rows.length) && (
                      <tr className="mon-sub" data-branch-subtotal={bg.label}>
                        <th scope="row" className="pl-6 text-left text-[13px] font-semibold">Subtotal {bg.label}</th>
                        <SubCells s={bg.sub} />
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="mon-sub" data-subtotal={g.label}>
                  <th scope="row" className="text-left text-[13px] font-semibold">Subtotal {g.label}</th>
                  <SubCells s={g.sub} />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      {/* 640 to 1023 px: the main columns; Declined, Returned and the averages behind Details. */}
      <div className="hidden rounded-[14px] border border-line bg-white sm:block lg:hidden">
        <table className="mon2" data-dp-compact>
          {caption}
          <thead>
            <tr><th scope="col">Processor</th><th scope="col">Assigned</th><th scope="col">In process</th><th scope="col">On hold</th><th scope="col">Overdue</th><th scope="col">Availability</th><th scope="col" className="al">Status</th></tr>
          </thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="mon-band"><th scope="rowgroup" colSpan={7}><Band q={q} k={g.key} label={g.label} open={open} count={count(g.rows.length)} /></th></tr>
                {open && g.branches.map((bg) => (
                  <Fragment key={bg.key}>
                    <tr data-branch-group={bg.label}><th scope="rowgroup" colSpan={7} className="pl-6 text-left text-[13px] font-normal text-ink-2">{bg.label}</th></tr>
                    {bg.rows.map((r) => (
                      <tr key={r.id} data-row data-dp-row={r.name}>
                        <th scope="row" className="pl-6 text-left align-top font-normal">
                          {nameLink(r)}{r.branches.length > 1 && <BranchChips names={r.branches} />}
                          <MoreToggle label="Details" items={dpMore(r)} attr="data-details" />
                        </th>
                        <td className="num align-top"><Num n={r.assigned} /></td><td className="num align-top"><Num n={r.inProcess} /></td><td className="num align-top"><Num n={r.onHold} kind="onHold" /></td><td className="num align-top"><Num n={r.overdue} kind="overdue" /></td>
                        <td className="num align-top"><UsageBar a={r.avail} /></td>
                        <td className="align-top"><StatusChip a={r.avail} until={r.leaveUntil} stacked /></td>
                      </tr>
                    ))}
                    {showSubtotal(bg.rows.length) && (
                      <tr className="mon-sub" data-branch-subtotal={bg.label}><th scope="row" className="pl-6 text-left text-[13px] font-semibold">Subtotal {bg.label}</th><SubCellsCompact s={bg.sub} /></tr>
                    )}
                  </Fragment>
                ))}
                <tr className="mon-sub" data-subtotal={g.label}><th scope="row" className="text-left text-[13px] font-semibold">Subtotal {g.label}</th><SubCellsCompact s={g.sub} /></tr>
              </tbody>
            );
          })}
        </table>
      </div>

      {/* Phones: one card per processor, under the Area band. */}
      <div className="flex flex-col gap-3 sm:hidden" data-dp-cards>
        {m.groups.map((g) => {
          const open = !q.collapsed.includes(g.key);
          return (
            <div key={g.key} className="flex flex-col gap-2" data-group={g.label}>
              <div className="rounded-xl bg-[#eef2f8] px-3"><Band q={q} k={g.key} label={g.label} open={open} count={count(g.rows.length)} /></div>
              {open && g.branches.map((bg) => (
                <div key={bg.key} className="flex flex-col gap-2" data-branch-group={bg.label}>
                  <p className="px-1 text-[13px] text-ink-2">{bg.label}</p>
                  {bg.rows.map((r) => (
                    <div key={r.id} className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3" data-dp-row={r.name}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[16px]">{nameLink(r)}</span>
                        <StatusChip a={r.avail} until={r.leaveUntil} />
                      </div>
                      {r.branches.length > 1 && <BranchChips names={r.branches} />}
                      <dl className="grid grid-cols-4 gap-1 text-center" data-card-counts>
                        {([["Assigned", r.assigned, "plain"], ["In process", r.inProcess, "plain"], ["On hold", r.onHold, "onHold"], ["Overdue", r.overdue, "overdue"]] as const).map(([k, n, kind]) => (
                          <div key={k} className="flex flex-col rounded-lg bg-fill-soft py-1.5" data-count={k}>
                            <dt className="text-[12px] text-ink-2">{k}</dt>
                            <dd className="text-[18px] font-bold tabular-nums"><Num n={n} kind={kind} /></dd>
                          </div>
                        ))}
                      </dl>
                      <UsageBar a={r.avail} inline />
                      <MoreToggle label="More" items={dpMore(r)} attr="data-more" />
                    </div>
                  ))}
                  {showSubtotal(bg.rows.length) && <p className="px-1 text-[12px] text-ink-2" data-branch-subtotal={bg.label}>Subtotal {bg.label}: {subLine(bg.sub)}</p>}
                </div>
              ))}
              <p className="border-t border-line px-1 pt-1.5 text-[12px] text-ink-2" data-subtotal={g.label}><strong>Subtotal {g.label}:</strong> {subLine(g.sub)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DrillList({ title, rows, empty, kind }: { title: string; rows: DrillJob[]; empty: string; kind: "open" | "back" }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-[15px] font-bold text-navy">{title} ({rows.length})</h3>
      {rows.length === 0 ? <p className="text-[14px] text-ink-2">{empty}</p> : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((j) => (
            <li key={j.id} className="rounded-xl border border-line px-3 py-2 text-[14px]" data-drill-row={j.pn}>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span><Pn j={j} /> · {j.typeName}</span>
                <ToneChip tone={j.overdue ? "bad" : j.status === "On hold" ? "hold" : kind === "back" ? "mute" : "wait"}>{j.overdue ? `${j.status} · Overdue` : j.status}</ToneChip>
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-2">
                {kind === "open" ? <>Age {j.age} · Due {j.due}</> : <>{j.when} · {j.note}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LtoDrillList({ title, rows, empty }: { title: string; rows: LtoDrillJob[]; empty: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-[15px] font-bold text-navy">{title} ({rows.length})</h3>
      {rows.length === 0 ? <p className="text-[14px] text-ink-2">{empty}</p> : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((j) => (
            <li key={j.id} className="rounded-xl border border-line px-3 py-2 text-[14px]" data-drill-row={j.pn}>
              <span className="flex flex-wrap items-center justify-between gap-2"><span><Pn j={j} /> · {j.typeName}</span><span className="text-[13px] font-semibold">{j.days}</span></span>
              <span className="mt-0.5 block text-[13px] text-ink-2">{j.dpName} · Drop off {j.dropText} · Pickup {j.pickText}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// LTO monitor
// ---------------------------------------------------------------------------

async function LtoTab({ user, q, now, holidays, offices }: { user: CurrentUser; q: MonitorQuery; now: Date; holidays: ReadonlySet<string>; offices: { id: string; name: string }[] }) {
  const manage = can(user, PERMISSIONS.LTO_REPORTS_MANAGE);
  if (q.view === "day") return <ByDayTable d={await ltoByDay(user, q)} q={q} what="office" holidays={holidays} />;
  const [m, drill] = await Promise.all([ltoMonitor(user, q, now), q.open && q.officeId ? ltoDrill(user, q, q.officeId, now) : Promise.resolve(null)]);
  const quiet = m.rows.every((r) => !r.used);
  return (
    <>
      <LtoTiles m={m} />
      {quiet && <Empty q={q} />}
      <LtoTable m={m} q={q} />
      <Advisories m={m} manage={manage} offices={offices} q={q} />
      {drill && (
        <RouteSheet title={drill.name} closeHref={monitorHref(q, { open: null, office: null })}>
          <div className="flex flex-col gap-4">
            <p className="text-[15px]">{drill.area}</p>
            {drill.advisories.map((a) => <AdvisoryLine key={a.id} a={a} />)}
            <p className="text-[13px] text-ink-2">At the LTO now: as of now. Finished: picked up in {q.range.label}. {HOLD_NOTE}.</p>
            <LtoDrillList title="At the LTO now" rows={drill.atNow} empty="No job is at this office now." />
            <LtoDrillList title="Picked up in the period" rows={drill.finished} empty="None picked up in the period." />
          </div>
        </RouteSheet>
      )}
    </>
  );
}

function LtoTiles({ m }: { m: LtoMonitor }) {
  const t = m.tiles;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-tiles>
      <Tile first label="Offices with an active advisory" value={t.withAdvisory} sub="Warnings only, never a block" now />
      <Tile label="Jobs at an LTO now" value={t.atNow} sub="Dropped off, not picked up" now />
      <Tile label="Average time at the LTO" value={daysText(t.avgAt.days)} sub={`${jobs(t.avgAt.n)} picked up · ${HOLD_NOTE.toLowerCase()}`} />
      <Tile label="Busiest office" value={t.busiest ? t.busiest.used : "-"} sub={t.busiest ? `${t.busiest.name} · transactions in the period` : "No transactions in the period"} />
    </section>
  );
}

const money = (c: number | null) => (c === null ? "No estimate" : peso(c));
const officeCount = (n: number) => `${n} office${n === 1 ? "" : "s"}`;
const advisoryChip = (r: LtoRow) => (r.activeAdvisories ? <ToneChip tone="act">Advisory</ToneChip> : <ToneChip tone="ok">No advisory</ToneChip>);
const advisoryText = (r: LtoRow) => (r.activeAdvisories ? <><strong>{r.activeAdvisories}</strong> · {r.latest?.typeLabel}, {r.latest?.filedBy}</> : <span className="n-zero">None</span>);
const ltoMore = (r: LtoRow): [string, React.ReactNode][] => [
  ["Distance", r.distanceKm != null ? `${r.distanceKm} km` : "-"],
  ["Avg time at the LTO", avgLine(r.avgAt)],
  ...(r.money ? ([["Estimated travel cash", money(r.money.estimateCents)], ["Actual spent", peso(r.money.spentCents)]] as [string, React.ReactNode][]) : []),
];
const ltoSubLine = (s: LtoGroup["sub"]) => `${s.used} transactions · ${s.atNow} at the LTO now · ${s.activeAdvisories} active advisories`;

function LtoTable({ m, q }: { m: LtoMonitor; q: MonitorQuery }) {
  const link = (r: LtoRow) => monitorHref(q, { office: r.id, open: "1" });
  const nameLink = (r: LtoRow) => <Link href={link(r)} scroll={false} className="font-semibold text-navy no-underline hover:underline" aria-label={`${r.name}: jobs at the LTO and picked up`}>{r.name}</Link>;
  const cols = m.showAmounts ? 9 : 7;
  const caption = <caption className="sr-only">LTO offices by area. At the LTO now as of now; the rest for {q.range.label}.</caption>;
  return (
    <section aria-label="LTO offices" className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto rounded-[14px] border border-line bg-white lg:block">
        <table className="mon2" data-lto-table>
          {caption}
          <thead>
            <tr>
              <th scope="col">Office</th><th scope="col">Distance</th><th scope="col">Transactions</th><th scope="col">At the LTO now</th>
              <th scope="col">Avg time at the LTO</th><th scope="col" className="al">Active advisories</th>
              {m.showAmounts && <><th scope="col">Estimated travel cash</th><th scope="col">Actual spent</th></>}
              <th scope="col" className="al">Status</th>
            </tr>
          </thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="mon-band"><th scope="rowgroup" colSpan={cols}><Band q={q} k={g.key} label={g.label} open={open} count={officeCount(g.rows.length)} /></th></tr>
                {open && g.rows.map((r) => (
                  <tr key={r.id} data-row data-lto-row={r.name}>
                    <th scope="row" className="text-left font-normal">{nameLink(r)}</th>
                    <td className="num">{r.distanceKm != null ? `${r.distanceKm} km` : <span className="n-zero">-</span>}</td>
                    <td className="num"><Num n={r.used} /></td><td className="num"><Num n={r.atNow} /></td><td className="num"><AvgCell a={r.avgAt} /></td>
                    <td className="max-w-[320px] text-[13px]">{advisoryText(r)}</td>
                    {r.money && <><td className="num">{money(r.money.estimateCents)}</td><td className="num">{peso(r.money.spentCents)}</td></>}
                    <td>{advisoryChip(r)}</td>
                  </tr>
                ))}
                <tr className="mon-sub" data-subtotal={g.label}>
                  <th scope="row" className="text-left text-[13px] font-semibold">Subtotal</th><td />
                  <td className="num"><Num n={g.sub.used} /></td><td className="num"><Num n={g.sub.atNow} /></td><td className="num"><AvgCell a={g.sub.avgAt} /></td>
                  <td className="text-[13px]">{g.sub.activeAdvisories}</td>
                  {m.showAmounts && <><td className="num">{money(g.sub.estimateCents)}</td><td className="num">{peso(g.sub.spentCents)}</td></>}
                  <td />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="hidden rounded-[14px] border border-line bg-white sm:block lg:hidden">
        <table className="mon2" data-lto-compact>
          {caption}
          <thead><tr><th scope="col">Office</th><th scope="col">Transactions</th><th scope="col">At the LTO now</th><th scope="col" className="al">Active advisories</th><th scope="col" className="al">Status</th></tr></thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="mon-band"><th scope="rowgroup" colSpan={5}><Band q={q} k={g.key} label={g.label} open={open} count={officeCount(g.rows.length)} /></th></tr>
                {open && g.rows.map((r) => (
                  <tr key={r.id} data-row data-lto-row={r.name}>
                    <th scope="row" className="text-left align-top font-normal">{nameLink(r)}<MoreToggle label="Details" items={ltoMore(r)} attr="data-details" /></th>
                    <td className="num align-top"><Num n={r.used} /></td><td className="num align-top"><Num n={r.atNow} /></td>
                    <td className="align-top text-[13px]">{advisoryText(r)}</td>
                    <td className="align-top">{advisoryChip(r)}</td>
                  </tr>
                ))}
                <tr className="mon-sub" data-subtotal={g.label}>
                  <th scope="row" className="text-left text-[13px] font-semibold">Subtotal</th>
                  <td className="num"><Num n={g.sub.used} /></td><td className="num"><Num n={g.sub.atNow} /></td><td className="text-[13px]">{g.sub.activeAdvisories}</td><td />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden" data-lto-cards>
        {m.groups.map((g) => {
          const open = !q.collapsed.includes(g.key);
          return (
            <div key={g.key} className="flex flex-col gap-2" data-group={g.label}>
              <div className="rounded-xl bg-[#eef2f8] px-3"><Band q={q} k={g.key} label={g.label} open={open} count={officeCount(g.rows.length)} /></div>
              {open && g.rows.map((r) => (
                <div key={r.id} className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3" data-lto-row={r.name}>
                  <div className="flex items-start justify-between gap-2"><span className="text-[16px]">{nameLink(r)}</span>{advisoryChip(r)}</div>
                  <dl className="grid grid-cols-3 gap-1 text-center" data-card-counts>
                    {([["Transactions", r.used], ["At the LTO now", r.atNow], ["Advisories", r.activeAdvisories]] as const).map(([k, n]) => (
                      <div key={k} className="flex flex-col rounded-lg bg-fill-soft py-1.5" data-count={k}>
                        <dt className="text-[12px] text-ink-2">{k}</dt><dd className="text-[18px] font-bold tabular-nums"><Num n={n} /></dd>
                      </div>
                    ))}
                  </dl>
                  {r.latest && <p className="text-[13px] text-act-fg">{r.latest.warning}</p>}
                  <MoreToggle label="More" items={ltoMore(r)} attr="data-more" />
                </div>
              ))}
              <p className="border-t border-line px-1 pt-1.5 text-[12px] text-ink-2" data-subtotal={g.label}><strong>Subtotal:</strong> {ltoSubLine(g.sub)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdvisoryLine({ a }: { a: AdvisoryView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-act-line bg-act-bg px-3 py-2 text-act-fg" data-advisory={a.typeLabel}>
      <p className="flex items-start gap-2 text-[14px] font-semibold"><WarningIcon size={16} /> {a.warning}</p>
      <p className="text-[14px] text-ink">{a.remarks}</p>
      <p className="text-[12px] text-ink-2">Started {a.startedText}</p>
      {a.prompt && <p className="text-[13px] font-semibold" data-stale-prompt>{a.prompt}</p>}
      {(a.mayResolve || a.mayEdit) && (
        <div className="flex flex-wrap gap-2">
          {a.mayResolve && <ResolveAdvisoryButton id={a.id} summary={a.warning} label={a.prompt ? "No longer active: resolve" : "Resolve"} />}
          {a.mayEdit && <EditAdvisoryButton id={a.id} type={a.type} remarks={a.remarks} />}
        </div>
      )}
    </div>
  );
}

function Advisories({ m, manage, offices, q }: { m: LtoMonitor; manage: boolean; offices: { id: string; name: string }[]; q: MonitorQuery }) {
  return (
    <section aria-labelledby="adv-h" className="card flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="adv-h" className="text-lg font-bold text-navy">LTO advisories</h2>
        {manage && <ReportLtoProblemButton offices={offices} label="File an advisory" buttonClass="btn-secondary btn-sm" />}
      </div>
      <p className="text-[13px] text-ink-2">Active ones warn people choosing the office and the processors going there. They never block anything and are not part of any loan&rsquo;s Journey.</p>
      {m.advisories.length === 0 ? <p className="text-[15px] text-ink-2">No active advisory.</p> : <div className="flex flex-col gap-2">{m.advisories.map((a) => <AdvisoryLine key={a.id} a={a} />)}</div>}
      {m.resolved.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-navy">Resolved in {q.range.label} ({m.resolved.length})</summary>
          <ul className="mt-1 flex flex-col gap-1.5">
            {m.resolved.map((a) => (
              <li key={a.id} className="rounded-xl border border-line px-3 py-2 text-[14px]" data-advisory-resolved>
                <strong>{a.officeName}</strong>: {a.typeLabel}, reported by {a.filedBy} · {a.startedText}
                <span className="block text-[13px] text-ink-2">Resolved by {a.resolvedBy} · {a.resolvedText} · {a.resolveRemarks}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// By day
// ---------------------------------------------------------------------------

/** A weekend or holiday row (day rows only): muted, with words, never colour alone. Its counts still show. */
const offDay = (unit: "day" | "week", key: string, holidays: ReadonlySet<string>) => unit === "day" && !isBusinessDay(key, holidays);
/** 820: the first three measures stay; the rest go behind Details. */
const DAY_MAIN = 3;

function ByDayTable({ d, q, what, holidays }: { d: ByDay; q: MonitorQuery; what: "processor" | "office"; holidays: ReadonlySet<string> }) {
  const unit = d.unit === "day" ? "Day" : "Week";
  const main = d.columns.slice(0, DAY_MAIN), rest = d.columns.slice(DAY_MAIN);
  const empty = d.groups.length === 0 || d.columns.every((c) => !d.total[c.key]);
  const off = <span className="ml-1.5 inline-flex h-5 items-center rounded-full border border-line px-1.5 text-[12px] font-medium text-ink-2" data-not-business>Not a business day</span>;
  const rowHead = (r: { key: string; label: string }) => (
    <th scope="row" className={`whitespace-nowrap text-left font-normal ${offDay(d.unit, r.key, holidays) ? "text-ink-2" : ""}`}>{r.label}{offDay(d.unit, r.key, holidays) && off}</th>
  );
  return (
    <section aria-label={`By ${d.unit}`} className="flex flex-col gap-2" data-by-day={d.unit}>
      <p className="text-[13px] text-ink-2">{d.unit === "week" ? "Over 92 days: one row per week (Monday to Sunday). " : ""}Counted on the day each thing happened, in Philippine time. {what === "processor" ? "Grouped by the processors' area (Several areas when their branches are in more than one)" : "Grouped by the office's area (city)"} unless one is picked.</p>
      {empty ? <Empty q={q} /> : (
        <>
          <div className="hidden overflow-x-auto rounded-[14px] border border-line bg-white lg:block">
            <table className="mon2" data-day-table>
              <caption className="sr-only">By {d.unit}, {q.range.label}</caption>
              <thead><tr><th scope="col">{unit}</th>{d.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
              {d.groups.map((g) => {
                const open = !q.collapsed.includes(g.key);
                return (
                  <tbody key={g.key} data-group={g.label}>
                    <tr className="mon-band"><th scope="rowgroup" colSpan={d.columns.length + 1}><GroupToggle q={q} k={g.key} label={g.label} open={open} /></th></tr>
                    {open && g.rows.map((r) => (
                      <tr key={r.key} data-row data-day-row={r.key} className={offDay(d.unit, r.key, holidays) ? "bg-fill-soft" : ""}>{rowHead(r)}{d.columns.map((c) => <td key={c.key} className="num"><Num n={r.counts[c.key]} /></td>)}</tr>
                    ))}
                    <tr className="mon-sub" data-subtotal={g.label}><th scope="row" className="text-left text-[13px] font-semibold">Subtotal</th>{d.columns.map((c) => <td key={c.key} className="num">{g.sub[c.key]}</td>)}</tr>
                  </tbody>
                );
              })}
              <tfoot><tr className="font-bold"><th scope="row" className="text-left">Total</th>{d.columns.map((c) => <td key={c.key} className="num">{d.total[c.key]}</td>)}</tr></tfoot>
            </table>
          </div>

          <div className="hidden rounded-[14px] border border-line bg-white sm:block lg:hidden">
            <table className="mon2" data-day-compact>
              <caption className="sr-only">By {d.unit}, {q.range.label}</caption>
              <thead><tr><th scope="col">{unit}</th>{main.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
              {d.groups.map((g) => {
                const open = !q.collapsed.includes(g.key);
                return (
                  <tbody key={g.key} data-group={g.label}>
                    <tr className="mon-band"><th scope="rowgroup" colSpan={main.length + 1}><GroupToggle q={q} k={g.key} label={g.label} open={open} /></th></tr>
                    {open && g.rows.map((r) => (
                      <tr key={r.key} data-row data-day-row={r.key} className={offDay(d.unit, r.key, holidays) ? "bg-fill-soft" : ""}>
                        <th scope="row" className={`text-left align-top font-normal ${offDay(d.unit, r.key, holidays) ? "text-ink-2" : ""}`}>
                          {r.label}{offDay(d.unit, r.key, holidays) && off}
                          {rest.length > 0 && <MoreToggle label="Details" items={rest.map((c) => [c.label, <Num key={c.key} n={r.counts[c.key]} />])} attr="data-details" />}
                        </th>
                        {main.map((c) => <td key={c.key} className="num align-top"><Num n={r.counts[c.key]} /></td>)}
                      </tr>
                    ))}
                    <tr className="mon-sub" data-subtotal={g.label}><th scope="row" className="text-left text-[13px] font-semibold">Subtotal{rest.length > 0 && <span className="block text-[12px] font-normal">{rest.map((c) => `${c.label} ${g.sub[c.key]}`).join(" · ")}</span>}</th>{main.map((c) => <td key={c.key} className="num">{g.sub[c.key]}</td>)}</tr>
                  </tbody>
                );
              })}
              <tfoot><tr className="font-bold"><th scope="row" className="text-left">Total{rest.length > 0 && <span className="block text-[12px] font-normal">{rest.map((c) => `${c.label} ${d.total[c.key]}`).join(" · ")}</span>}</th>{main.map((c) => <td key={c.key} className="num">{d.total[c.key]}</td>)}</tr></tfoot>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden" data-day-cards>
            {d.groups.map((g) => {
              const open = !q.collapsed.includes(g.key);
              return (
                <div key={g.key} className="flex flex-col gap-2" data-group={g.label}>
                  <div className="rounded-xl bg-[#eef2f8] px-3"><GroupToggle q={q} k={g.key} label={g.label} open={open} /></div>
                  {open && g.rows.map((r) => (
                    <div key={r.key} className={`flex flex-col gap-1.5 rounded-[14px] border border-line p-3 ${offDay(d.unit, r.key, holidays) ? "bg-fill-soft" : "bg-white"}`} data-day-row={r.key}>
                      <p className={`text-[14px] font-semibold ${offDay(d.unit, r.key, holidays) ? "text-ink-2" : "text-navy"}`}>{r.label}{offDay(d.unit, r.key, holidays) && off}</p>
                      <dl className="grid grid-cols-3 gap-x-2 gap-y-1">
                        {d.columns.map((c) => <div key={c.key} className="flex flex-col"><dt className="text-[12px] text-ink-2">{c.label}</dt><dd className="text-[15px] font-bold tabular-nums"><Num n={r.counts[c.key]} /></dd></div>)}
                      </dl>
                    </div>
                  ))}
                  <p className="border-t border-line px-1 pt-1.5 text-[12px] text-ink-2" data-subtotal={g.label}><strong>Subtotal:</strong> {d.columns.map((c) => `${c.label} ${g.sub[c.key]}`).join(" · ")}</p>
                </div>
              );
            })}
            <p className="rounded-xl bg-fill px-3 py-2 text-[13px] font-semibold text-navy" data-day-total>Total: {d.columns.map((c) => `${c.label} ${d.total[c.key]}`).join(" · ")}</p>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// How is this counted?
// ---------------------------------------------------------------------------

function HowCounted({ tab }: { tab: "dp" | "lto" }) {
  return (
    <details id="how-counted" className="card scroll-mt-24 p-4 sm:p-5" data-how-counted>
      <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-navy">How is this counted?</summary>
      <div className="mt-2 flex flex-col gap-2 text-[14px]">
        <p>The TAT clock never pauses: every time includes time on hold. Days are business days (weekends and the holidays in Settings skipped); the same day counts as 0. Times are Philippine time. Open counts (assigned, in process, on hold, overdue, at the LTO now) are today&rsquo;s state; everything else uses the dates chosen above, both days included.</p>
        {tab === "dp" ? (
          <ul className="list-disc pl-5">
            <li><strong>Assigned:</strong> sent to the processor and not yet accepted. <strong>In process:</strong> accepted, not completed or forwarded. <strong>On hold:</strong> their open jobs with an active hold (not counted again as assigned or in process). <strong>Open jobs</strong> = assigned + in process + on hold.</li>
            <li><strong>Overdue:</strong> open and past the due date of the transaction&rsquo;s current step (the same late rule as the TAT chips).</li>
            <li><strong>Time to accept:</strong> sent to accepted. <strong>Processing:</strong> accepted to Check and verify done. <strong>Total:</strong> sent to Check and verify done. Averages use the jobs finished (Check and verify done) in the dates chosen, with the number of jobs.</li>
            <li><strong>Declined / Returned:</strong> by the processor in the dates chosen. A job passed to a second processor (Pasuyo) counts for the second processor once accepted.</li>
            <li><strong>Capacity:</strong> the processor&rsquo;s own number, or the default in Settings ({AVAILABILITY.defaultCapacity} unless changed). <strong>Availability</strong> = free places (capacity minus open jobs, never below 0) divided by capacity, rounded. Available from {AVAILABILITY.availableFrom}%, Busy from 1% to {AVAILABILITY.availableFrom - 1}%, Full at 0%. On leave counts as 0% and is left out of the average availability.</li>
            <li>Grouped by <strong>Area, then Branch</strong>, with subtotals for each. A processor whose branches are all in one Area is under that Area (and under their branch, or their branches together); a processor with branches in more than one Area is under <strong>Several areas</strong>. Their branches show as chips on the row. Each processor is counted once, so subtotals and totals never count anyone twice.</li>
            <li>The <strong>Area</strong> and <strong>Branch</strong> filters keep the jobs of loans in that Area or Branch, and a processor when <em>any</em> of their branches matches.</li>
          </ul>
        ) : (
          <ul className="list-disc pl-5">
            <li><strong>Transactions:</strong> jobs whose LTO drop off was done at the office in the dates chosen. <strong>At the LTO now:</strong> dropped off and not picked up yet, on an open job.</li>
            <li><strong>Average time at the LTO:</strong> LTO drop off done to LTO pickup done, for jobs picked up in the dates chosen, with the number of jobs.</li>
            <li><strong>Estimated travel cash</strong> (only with the amounts permission): the office&rsquo;s suggested transport times its transactions. <strong>Actual spent:</strong> spends logged on Transport lines of funds records for that office, on attempt days in the dates chosen.</li>
            <li>Grouped by the office&rsquo;s area (its city in Settings, LTO offices). <strong>Advisories</strong> warn; they never block anything.</li>
          </ul>
        )}
        <p>Full definitions and examples: docs/workflow/11-monitoring.md.</p>
      </div>
    </details>
  );
}
