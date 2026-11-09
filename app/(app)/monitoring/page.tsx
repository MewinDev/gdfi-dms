import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireUser, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate, fmtDate } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import {
  dpByDay, dpDrill, dpMonitor, filterOptions, measured, ltoByDay, ltoDrill, ltoMonitor, monitorHref, parseMonitorQuery,
  type Avg, type ByDay, type DpMonitor, type DpRow, type DrillJob, type LtoDrillJob, type LtoMonitor, type LtoRow, type MonitorQuery, type MonitorSearch,
} from "@/lib/services/monitoring";
import { AVAILABILITY, AVAILABILITY_LABEL, AVAILABILITY_TONE, daysText, type Availability } from "@/lib/monitoring/rules";
import type { AdvisoryView } from "@/lib/services/lto-advisories";
import { PageHeader, ToneChip } from "@/components/ui/basics";
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, WarningIcon } from "@/components/ui/icons";
import { FilterBar } from "@/components/monitoring/filter-bar";
import { RouteSheet } from "@/components/monitoring/route-sheet";
import { EditAdvisoryButton, ReportLtoProblemButton, ResolveAdvisoryButton } from "@/components/monitoring/advisory-forms";

export const metadata: Metadata = { title: "Monitoring" };

const HOLD_NOTE = "Includes time on hold";

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
  // The page time (shown at the bottom, and read by the tests): the data work of the page.
  const { value: [opts, body], ms } = await measured(async () => {
    const o = await filterOptions(user);
    return [o, q.tab === "dp" ? await DpTab({ user, q, now }) : await LtoTab({ user, q, now, offices: o.offices.filter((x) => x.active) })] as const;
  });
  const csv = `/api/monitoring/csv${monitorHref(q, { open: null, hide: null }).replace("/monitoring", "")}`;

  return (
    <div className="dense flex w-full flex-col gap-4" data-monitoring={q.tab} data-ms={ms}>
      <PageHeader title={`Monitoring: ${q.range.label}`} help={`${HOLD_NOTE}. Times are Philippine time; days are business days (weekends and holidays skipped).`}>
        <Link href={csv} prefetch={false} className="btn-ghost btn-sm self-center"><DownloadIcon size={18} /> Download CSV</Link>
      </PageHeader>
      <nav aria-label="Monitoring" className="seg-row -mt-1">
        <div className="seg">
          {canDp && <Link href={monitorHref(q, { tab: "dp", dp: null, office: null, open: null, hide: null })} className="seg-item" aria-current={q.tab === "dp" ? "page" : undefined}>DPs</Link>}
          {canLto && <Link href={monitorHref(q, { tab: "lto", dp: null, office: null, open: null, hide: null })} className="seg-item" aria-current={q.tab === "lto" ? "page" : undefined}>LTO offices</Link>}
        </div>
      </nav>
      <FilterBar
        tab={q.tab} view={q.view} preset={q.range.preset} from={q.range.from} to={q.range.to} today={today} branch={q.branchId ?? ""} type={q.typeCode ?? ""}
        branches={opts.branches} types={opts.types}
        who={q.view === "day" ? (q.tab === "dp" ? { name: "dp", label: "Processor", value: q.dpId ?? "", options: opts.dps } : { name: "office", label: "LTO office", value: q.officeId ?? "", options: opts.offices }) : null}
      />
      {q.range.error && <p role="alert" className="rounded-xl border border-bad-line bg-bad-bg px-4 py-2 text-[15px] text-bad-fg">{q.range.error} Showing {q.range.label} instead.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg" role="group" aria-label="View">
          <Link href={monitorHref(q, { view: null, open: null })} className="seg-item" aria-current={q.view === "totals" ? "page" : undefined}>Totals</Link>
          <Link href={monitorHref(q, { view: "day", open: null })} className="seg-item" aria-current={q.view === "day" ? "page" : undefined}>By day</Link>
        </div>
        <a href="#how-counted" className="link inline-flex min-h-11 items-center text-sm">How is this counted?</a>
      </div>
      {body}
      <HowCounted tab={q.tab} />
      <p className="text-[12px] text-ink-2" data-page-time>Page built in {ms} ms.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Tile({ label, value, sub, note }: { label: string; value: string | number; sub?: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-0.5 p-3 sm:p-4" data-tile={label}>
      <p className="text-[13px] font-semibold text-ink-2">{label}</p>
      <p className="text-2xl font-bold text-navy">{value}</p>
      {sub && <p className="text-[12px] text-ink-2">{sub}</p>}
      {note && <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">{note}</p>}
    </div>
  );
}

const avgText = (a: Avg) => `${daysText(a.days)} · ${a.n} job${a.n === 1 ? "" : "s"}`;
function AvgCell({ a }: { a: Avg }) {
  return <span className="whitespace-nowrap">{daysText(a.days)}<span className="block text-[12px] text-ink-2">{a.n} job{a.n === 1 ? "" : "s"}</span></span>;
}

function StatusChip({ a, until, stacked = false }: { a: Availability; until: string | null; stacked?: boolean }) {
  if (stacked && a.status === "ON_LEAVE" && until) {
    return <span className="inline-flex flex-col items-start gap-0.5"><ToneChip tone="mute">On leave</ToneChip><span className="whitespace-nowrap text-[12px] text-ink-2">until {fmtDate(until)}</span></span>;
  }
  const label = a.status === "ON_LEAVE" && until ? `On leave until ${fmtDate(until)}` : AVAILABILITY_LABEL[a.status];
  return <ToneChip tone={AVAILABILITY_TONE[a.status]}>{label}</ToneChip>;
}

/** "60%" with "4 of 10 in use" under it (the same words as "60% · 4 of 10 in use"). */
function AvailCell({ a }: { a: Availability }) {
  return <span className="whitespace-nowrap" title={a.text} aria-label={a.text}><strong>{a.pct}%</strong><span className="block text-[12px] text-ink-2">{a.open} of {a.capacity} in use</span></span>;
}

function GroupToggle({ q, k, label, open }: { q: MonitorQuery; k: string; label: string; open: boolean }) {
  const hide = open ? [...q.collapsed, k] : q.collapsed.filter((x) => x !== k);
  return (
    <Link href={monitorHref(q, { hide: hide.join(",") || null, open: null })} scroll={false} aria-expanded={open} className="inline-flex min-h-11 items-center gap-1.5 font-bold text-navy no-underline" data-group-toggle={label}>
      {open ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />} {label}
    </Link>
  );
}

function Pn({ j }: { j: { pn: string; href: string | null } }) {
  return j.href ? <Link href={j.href} className="link font-semibold">{j.pn}</Link> : <span className="font-semibold" data-pn-plain>{j.pn}</span>;
}

// ---------------------------------------------------------------------------
// DP monitor
// ---------------------------------------------------------------------------

async function DpTab({ user, q, now }: { user: CurrentUser; q: MonitorQuery; now: Date }) {
  if (q.view === "day") return <ByDayTable d={await dpByDay(user, q)} q={q} what="processor" />;
  const [m, drill] = await Promise.all([dpMonitor(user, q, now), q.open && q.dpId ? dpDrill(user, q, q.dpId, now) : Promise.resolve(null)]);
  return (
    <>
      <DpTiles m={m} />
      <DpTable m={m} q={q} />
      {drill && (
        <RouteSheet title={drill.name} closeHref={monitorHref(q, { open: null, dp: null })}>
          <div className="flex flex-col gap-4">
            <p className="text-[15px]">{drill.group} · <StatusChip a={drill.avail} until={drill.leaveUntil} /> <span className="text-ink-2">{drill.avail.text}</span></p>
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
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      <Tile label="Active DPs" value={t.activeDps} />
      <Tile label="Assigned" value={t.assigned} sub="Waiting to accept" note="As of now" />
      <Tile label="In process" value={t.inProcess} note="As of now" />
      <Tile label="On hold" value={t.onHold} note="As of now" />
      <Tile label="Overdue" value={t.overdue} note="As of now" />
      <Tile label="Average total TAT" value={daysText(t.avgTotal.days)} sub={`${t.avgTotal.n} job${t.avgTotal.n === 1 ? "" : "s"} finished · ${HOLD_NOTE.toLowerCase()}`} />
      <Tile label="Average availability" value={t.avgAvailability === null ? "-" : `${t.avgAvailability}%`} sub="On leave not counted" note="As of now" />
    </section>
  );
}

function DpTable({ m, q }: { m: DpMonitor; q: MonitorQuery }) {
  if (!m.rows.length) return <p className="card px-4 py-5 text-[15px] text-ink-2">No processors in these branches.</p>;
  const link = (r: DpRow) => monitorHref(q, { dp: r.id, open: "1" });
  return (
    <section aria-label="Processors" className="flex flex-col gap-3">
      {/* Desktop: one table, grouped by branch with subtotals. */}
      <div className="card hidden overflow-x-auto lg:block">
        <table className="table mon-table w-full text-[13px]" data-dp-table>
          <caption className="sr-only">Processors by branch. Assigned, in process, on hold and overdue as of now; the rest for {q.range.label}.</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Processor</th>
              <th scope="col">Assigned</th><th scope="col">In process</th><th scope="col">On hold</th><th scope="col">Overdue</th>
              <th scope="col">Declined</th><th scope="col">Returned</th>
              <th scope="col">Avg time to accept</th><th scope="col">Avg processing</th><th scope="col">Avg total</th>
              <th scope="col">Capacity</th><th scope="col">Availability</th><th scope="col" className="text-left">Status</th>
            </tr>
          </thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="bg-fill">
                  <th scope="rowgroup" colSpan={13} className="text-left"><GroupToggle q={q} k={g.key} label={g.label} open={open} /> <span className="text-[13px] font-normal text-ink-2">{g.rows.length} processor{g.rows.length === 1 ? "" : "s"}</span></th>
                </tr>
                {open && g.rows.map((r) => (
                  <tr key={r.id} data-dp-row={r.name}>
                    <th scope="row" className="text-left font-semibold"><Link href={link(r)} scroll={false} className="link" aria-label={`${r.name}: open jobs, declined and returned`}>{r.name}</Link></th>
                    <td className="text-center">{r.assigned}</td><td className="text-center">{r.inProcess}</td><td className="text-center">{r.onHold}</td>
                    <td className={`text-center ${r.overdue ? "font-semibold text-bad-fg" : ""}`}>{r.overdue}</td>
                    <td className="text-center">{r.declined}</td><td className="text-center">{r.returned}</td>
                    <td className="text-center"><AvgCell a={r.accept} /></td><td className="text-center"><AvgCell a={r.processing} /></td><td className="text-center"><AvgCell a={r.total} /></td>
                    <td className="text-center">{r.avail.capacity}</td>
                    <td className="text-center"><AvailCell a={r.avail} /></td>
                    <td><StatusChip a={r.avail} until={r.leaveUntil} stacked /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line text-ink-2" data-subtotal={g.label}>
                  <th scope="row" className="text-left text-[13px] font-semibold">Subtotal</th>
                  <td className="text-center">{g.sub.assigned}</td><td className="text-center">{g.sub.inProcess}</td><td className="text-center">{g.sub.onHold}</td><td className="text-center">{g.sub.overdue}</td>
                  <td className="text-center">{g.sub.declined}</td><td className="text-center">{g.sub.returned}</td>
                  <td className="text-center"><AvgCell a={g.sub.accept} /></td><td className="text-center"><AvgCell a={g.sub.processing} /></td><td className="text-center"><AvgCell a={g.sub.total} /></td>
                  <td className="text-center">-</td><td className="text-center">{g.sub.availPct === null ? "-" : `${g.sub.availPct}% average`}</td><td />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      {/* Phone and tablet: cards. */}
      <div className="flex flex-col gap-3 lg:hidden" data-dp-cards>
        {m.groups.map((g) => {
          const open = !q.collapsed.includes(g.key);
          return (
            <div key={g.key} className="flex flex-col gap-2" data-group={g.label}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <GroupToggle q={q} k={g.key} label={g.label} open={open} />
                <span className="text-[13px] text-ink-2">{g.sub.assigned + g.sub.inProcess + g.sub.onHold} open · {g.sub.overdue} overdue</span>
              </div>
              {open && g.rows.map((r) => (
                <Link key={r.id} href={link(r)} scroll={false} className="card flex flex-col gap-2 p-3 no-underline hover:bg-fill" data-dp-row={r.name}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[16px] font-bold text-navy">{r.name}</span>
                    <StatusChip a={r.avail} until={r.leaveUntil} />
                  </span>
                  <span className="text-[13px] text-ink-2">{r.avail.text}</span>
                  <span className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] sm:grid-cols-4">
                    <span>Assigned <strong>{r.assigned}</strong></span><span>In process <strong>{r.inProcess}</strong></span>
                    <span>On hold <strong>{r.onHold}</strong></span><span className={r.overdue ? "font-semibold text-bad-fg" : ""}>Overdue <strong>{r.overdue}</strong></span>
                    <span>Declined <strong>{r.declined}</strong></span><span>Returned <strong>{r.returned}</strong></span>
                  </span>
                  <span className="flex flex-col text-[13px] text-ink">
                    <span>To accept: {avgText(r.accept)}</span><span>Processing: {avgText(r.processing)}</span><span>Total: {avgText(r.total)}</span>
                  </span>
                </Link>
              ))}
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

// ---------------------------------------------------------------------------
// LTO monitor
// ---------------------------------------------------------------------------

async function LtoTab({ user, q, now, offices }: { user: CurrentUser; q: MonitorQuery; now: Date; offices: { id: string; name: string }[] }) {
  const manage = can(user, PERMISSIONS.LTO_REPORTS_MANAGE);
  if (q.view === "day") return <ByDayTable d={await ltoByDay(user, q)} q={q} what="office" />;
  const [m, drill] = await Promise.all([ltoMonitor(user, q, now), q.open && q.officeId ? ltoDrill(user, q, q.officeId, now) : Promise.resolve(null)]);
  return (
    <>
      <LtoTiles m={m} />
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
    <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile label="Offices with an active advisory" value={t.withAdvisory} note="As of now" />
      <Tile label="Jobs at an LTO now" value={t.atNow} note="As of now" />
      <Tile label="Average time at the LTO" value={daysText(t.avgAt.days)} sub={`${t.avgAt.n} job${t.avgAt.n === 1 ? "" : "s"} picked up · ${HOLD_NOTE.toLowerCase()}`} />
      <Tile label="Busiest office" value={t.busiest ? t.busiest.used : "-"} sub={t.busiest ? `${t.busiest.name} · transactions in the period` : "No transactions in the period"} />
    </section>
  );
}

const money = (c: number | null) => (c === null ? "No estimate" : peso(c));
function LtoTable({ m, q }: { m: LtoMonitor; q: MonitorQuery }) {
  const link = (r: LtoRow) => monitorHref(q, { office: r.id, open: "1" });
  const cols = m.showAmounts ? 9 : 7;
  return (
    <section aria-label="LTO offices" className="flex flex-col gap-3">
      <div className="card hidden overflow-x-auto lg:block">
        <table className="table mon-table w-full text-[13px]" data-lto-table>
          <caption className="sr-only">LTO offices by area. At the LTO now as of now; the rest for {q.range.label}.</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Office</th><th scope="col">Distance</th><th scope="col">Transactions</th><th scope="col">At the LTO now</th>
              <th scope="col">Avg time at the LTO</th><th scope="col" className="text-left">Active advisories</th>
              {m.showAmounts && <><th scope="col">Estimated travel cash</th><th scope="col">Actual spent</th></>}
              <th scope="col" className="text-left">Status</th>
            </tr>
          </thead>
          {m.groups.map((g) => {
            const open = !q.collapsed.includes(g.key);
            return (
              <tbody key={g.key} data-group={g.label}>
                <tr className="bg-fill"><th scope="rowgroup" colSpan={cols} className="text-left"><GroupToggle q={q} k={g.key} label={g.label} open={open} /></th></tr>
                {open && g.rows.map((r) => (
                  <tr key={r.id} data-lto-row={r.name}>
                    <th scope="row" className="text-left font-semibold"><Link href={link(r)} scroll={false} className="link" aria-label={`${r.name}: jobs at the LTO and picked up`}>{r.name}</Link></th>
                    <td className="text-center">{r.distanceKm != null ? `${r.distanceKm} km` : "-"}</td>
                    <td className="text-center">{r.used}</td><td className="text-center">{r.atNow}</td><td className="text-center"><AvgCell a={r.avgAt} /></td>
                    <td className="max-w-[320px] text-[13px]">{r.activeAdvisories ? <><strong>{r.activeAdvisories}</strong> · {r.latest?.typeLabel}, {r.latest?.filedBy}</> : "None"}</td>
                    {r.money && <><td className="text-center">{money(r.money.estimateCents)}</td><td className="text-center">{peso(r.money.spentCents)}</td></>}
                    <td>{r.activeAdvisories ? <ToneChip tone="act">Advisory</ToneChip> : <ToneChip tone="ok">No advisory</ToneChip>}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line text-ink-2" data-subtotal={g.label}>
                  <th scope="row" className="text-left text-[13px] font-semibold">Subtotal</th><td />
                  <td className="text-center">{g.sub.used}</td><td className="text-center">{g.sub.atNow}</td><td className="text-center"><AvgCell a={g.sub.avgAt} /></td>
                  <td className="text-[13px]">{g.sub.activeAdvisories}</td>
                  {m.showAmounts && <><td className="text-center">{money(g.sub.estimateCents)}</td><td className="text-center">{peso(g.sub.spentCents)}</td></>}
                  <td />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="flex flex-col gap-3 lg:hidden" data-lto-cards>
        {m.groups.map((g) => {
          const open = !q.collapsed.includes(g.key);
          return (
            <div key={g.key} className="flex flex-col gap-2" data-group={g.label}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <GroupToggle q={q} k={g.key} label={g.label} open={open} />
                <span className="text-[13px] text-ink-2">{g.sub.used} transactions · {g.sub.atNow} at the LTO now</span>
              </div>
              {open && g.rows.map((r) => (
                <Link key={r.id} href={link(r)} scroll={false} className="card flex flex-col gap-1.5 p-3 no-underline hover:bg-fill" data-lto-row={r.name}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[16px] font-bold text-navy">{r.name}</span>
                    {r.activeAdvisories ? <ToneChip tone="act">Advisory</ToneChip> : <ToneChip tone="ok">No advisory</ToneChip>}
                  </span>
                  <span className="text-[13px] text-ink-2">{r.distanceKm != null ? `${r.distanceKm} km` : "No distance set"}</span>
                  <span className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                    <span>Transactions <strong>{r.used}</strong></span><span>At the LTO now <strong>{r.atNow}</strong></span>
                    <span className="col-span-2">Avg time at the LTO: {avgText(r.avgAt)}</span>
                    {r.money && <span className="col-span-2">Travel cash: {money(r.money.estimateCents)} estimated · {peso(r.money.spentCents)} spent</span>}
                  </span>
                  {r.latest && <span className="text-[13px] text-act-fg">{r.latest.warning}</span>}
                </Link>
              ))}
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
// By day
// ---------------------------------------------------------------------------

function ByDayTable({ d, q, what }: { d: ByDay; q: MonitorQuery; what: "processor" | "office" }) {
  const unit = d.unit === "day" ? "Day" : "Week";
  return (
    <section aria-label={`By ${d.unit}`} className="flex flex-col gap-2" data-by-day={d.unit}>
      <p className="text-[13px] text-ink-2">{d.unit === "week" ? "Over 92 days: one row per week (Monday to Sunday). " : ""}Counted on the day each thing happened, in Philippine time. {what === "processor" ? "Grouped by the processors' branches" : "Grouped by area"} unless one is picked.</p>
      {d.groups.length === 0 ? <p className="card px-4 py-5 text-[15px] text-ink-2">Nothing happened in {q.range.label}.</p> : (
        <div className="card overflow-x-auto">
          <table className="table mon-table w-full text-[13px]">
            <caption className="sr-only">By {d.unit}, {q.range.label}</caption>
            <thead><tr><th scope="col" className="text-left">{unit}</th>{d.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
            {d.groups.map((g) => {
              const open = !q.collapsed.includes(g.key);
              return (
                <tbody key={g.key} data-group={g.label}>
                  <tr className="bg-fill"><th scope="rowgroup" colSpan={d.columns.length + 1} className="text-left"><GroupToggle q={q} k={g.key} label={g.label} open={open} /></th></tr>
                  {open && g.rows.map((r) => (
                    <tr key={r.key}><th scope="row" className="whitespace-nowrap text-left font-normal">{r.label}</th>{d.columns.map((c) => <td key={c.key} className="text-center">{r.counts[c.key] || <span className="text-ink-2">0</span>}</td>)}</tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold" data-subtotal={g.label}><th scope="row" className="text-left text-[13px]">Subtotal</th>{d.columns.map((c) => <td key={c.key} className="text-center">{g.sub[c.key]}</td>)}</tr>
                </tbody>
              );
            })}
            <tfoot><tr className="font-bold"><th scope="row" className="text-left">Total</th>{d.columns.map((c) => <td key={c.key} className="text-center">{d.total[c.key]}</td>)}</tr></tfoot>
          </table>
        </div>
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
            <li>Grouped by the processor&rsquo;s branches (a processor of two branches has one group with both names).</li>
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
