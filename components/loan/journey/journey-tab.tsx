import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { LoanDetail } from "@/lib/services/queries";
import { loadJourney } from "@/lib/services/journey";
import { businessDate, fmtDate, fmtDateTime, fmtShort } from "@/lib/time";
import { roundEntries } from "@/lib/ui/rounds";
import { txnName } from "@/lib/ui/plain";
import { journeyHoldResumed, journeyHoldStarted, journeyHoldTransferred } from "@/lib/ui/holds";
import {
  dayCells, SEG_LABEL, STEP_STATE_LABEL, businessSpan,
  type CellState, type JPhase, type JStep, type JTxn, type Journey, type SegState, type StepState,
} from "@/lib/workflow/build-journey";
import { RoleChip } from "@/components/chips";
import { TatChip } from "@/components/jobs/chips";
import {
  AlertIcon, CheckIcon, ChevronRightIcon, ClockIcon, HourglassIcon, ListIcon, MinusIcon, PauseIcon, WarningIcon,
} from "@/components/ui/icons";
import { LiveSince } from "./live-since";
import { DocsList, type DocItem } from "./docs-list";
import { SimulatorBlock } from "./simulator-block";

/**
 * The one Journey of a loan: where it is now, who holds it, what happened, how long each part took
 * and where it was held up. Built from the stored records (lib/workflow/build-journey.ts). The
 * selection lives in the address: ?tab=journey&scope=NOTARY&filter=issues&view=bars.
 */

export interface JourneyParams { scope?: string; filter?: string; view?: string }

const STATE_STYLE: Record<StepState, { cls: string; Icon: typeof ClockIcon }> = {
  waiting: { cls: "c-mute", Icon: HourglassIcon },
  now: { cls: "c-act", Icon: ClockIcon },
  hold: { cls: "c-hold", Icon: PauseIcon },
  problem: { cls: "c-bad", Icon: AlertIcon },
  done: { cls: "c-ok", Icon: CheckIcon },
  later: { cls: "c-mute", Icon: ChevronRightIcon },
  na: { cls: "c-mute", Icon: MinusIcon },
};

export function StateChip({ state, label }: { state: StepState; label?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`chip ${s.cls} h-6 shrink-0 px-2.5 align-middle text-xs`} data-state={state}>
      <s.Icon size={13} strokeWidth={2.4} />
      {label ?? STEP_STATE_LABEL[state]}
    </span>
  );
}

/** "2d 3h", "5h 10m", "12m" (elapsed time). */
export function msText(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "under 1 min";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

const SEG_BG: Record<SegState, string> = { waiting: "bg-[rgb(12_35_64/0.22)]", processing: "bg-gold", hold: "bg-[var(--hold-stripe)]", problem: "bg-[var(--bad-fg)]" };

export async function JourneyTab({ loan, user, params }: { loan: LoanDetail; user: CurrentUser; params: JourneyParams }) {
  const { journey: j, holidays } = await loadJourney(user, loan);
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const codes = live.map((t) => t.type.code);
  const scope = params.scope === "DOCS" ? "DOCS" : codes.find((c) => c === params.scope?.toUpperCase()) ?? "ALL";
  const filter = params.filter === "issues" || params.filter === "mine" ? params.filter : "all";
  const view = params.view === "bars" ? "bars" : "list";
  const base = `/loans/${loan.pn}?tab=journey`;
  const href = (p: Partial<{ scope: string; filter: string; view: string }>) => {
    const q = { scope, filter, view, ...p };
    return `${base}${q.scope !== "ALL" ? `&scope=${q.scope}` : ""}${q.filter !== "all" ? `&filter=${q.filter}` : ""}${q.view !== "list" ? `&view=${q.view}` : ""}`;
  };
  const inScope = (code: string | null) => scope === "ALL" || scope === "DOCS" || code === scope;
  const txns = j.txns.filter((t) => t.state !== "na" && inScope(t.code));
  const now = j.now;

  const scopes: [string, string][] = [["ALL", "Whole loan"], ...live.map((t) => [t.type.code, txnName(t.type.code, t.type.name)] as [string, string]), ["DOCS", "Documents"]];
  const filters: [string, string][] = [["all", "All"], ["issues", "Problems and holds"], ["mine", "My steps"]];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-journey>
      <WhereNow txns={txns} now={now} />

      <nav aria-label="Journey view" className="flex min-w-0 flex-col gap-2">
        <ChipRow label="Show" items={scopes.map(([k, l]) => ({ key: k, label: l, href: href({ scope: k }), on: scope === k }))} />
        {scope !== "DOCS" && (
          <div className="flex flex-wrap items-center gap-2">
            <ChipRow label="Filter" items={filters.map(([k, l]) => ({ key: k, label: l, href: href({ filter: k }), on: filter === k }))} />
            <div role="group" aria-label="View" className="ml-auto inline-flex overflow-hidden rounded-xl border border-line-strong">
              {(["list", "bars"] as const).map((v) => (
                <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined} scroll={false}
                  className={`inline-flex min-h-11 items-center gap-1.5 px-4 text-sm font-semibold no-underline ${view === v ? "bg-navy text-white" : "bg-white text-navy hover:bg-fill"}`}>
                  {v === "list" ? <ListIcon size={16} /> : <BarsIcon />} {v === "list" ? "List" : "Bars"}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {scope !== "DOCS" && <Rounds txns={live.filter((t) => inScope(t.type.code))} now={now} />}
      {scope === "DOCS" && <DocsList docs={docItems(j, live.map((t) => t.type.code))} />}
      {scope !== "DOCS" && view === "list" && <ListView phases={j.phases} scope={scope} filter={filter} userId={user.id} now={now} />}
      {scope !== "DOCS" && view === "bars" && <BarsView txns={txns} holidays={holidays} now={now} />}

      <SimulatorBlock loan={loan} user={user} />
    </div>
  );
}

/**
 * Rounds with the processor, per transaction, in order: Sent (round 1), Declined by DP or Returned
 * by DP (reason and findings, DP, date and time PHT, how long), Sent again (round 2), and so on.
 * Shown for a transaction that was sent back at least once.
 */
function Rounds({ txns, now }: { txns: LoanDetail["transactions"]; now: Date }) {
  const withRounds = txns.map((t) => ({ t, rows: roundEntries(t.dpAssignments, now) })).filter((x) => x.rows.some((r) => r.round > 1 || r.outcome.endsWith("by DP")));
  if (!withRounds.length) return null;
  return (
    <section aria-labelledby="rounds-h" className="card p-3 sm:p-4" data-rounds>
      <h2 id="rounds-h" className="text-[17px] font-bold text-navy">Rounds with the processor</h2>
      {withRounds.map(({ t, rows }) => (
        <div key={t.id} className="mt-2 border-t border-line pt-2 first-of-type:border-t-0" data-rounds-txn={t.type.code}>
          <h3 className="text-[15px] font-semibold text-ink">{txnName(t.type.code, t.type.name)}</h3>
          <ol className="mt-1 flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <li key={i} className="rounded-lg bg-fill p-2 text-[13px]" data-round-entry={r.round}>
                <p className="font-semibold text-ink">
                  <span className="tag mr-1.5">Round {r.round}</span>{r.sentText} to {r.dpName}{r.sentBy ? ` by ${r.sentBy}` : ""} · {fmtDateTime(r.sentAt)}
                </p>
                <p className="text-ink" data-round-outcome>
                  {r.outcome}{r.outcomeAt ? ` · ${fmtDateTime(r.outcomeAt)}` : ""} · {r.outcomeAt ? "took" : "so far"} {r.duration}
                </p>
                {r.findings && <p className="break-words text-ink-2" data-round-findings>{r.findings}</p>}
                {r.papers.map((line, k) => <p key={k} className="text-ink" data-round-papers>{line}</p>)}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function ChipRow({ label, items }: { label: string; items: { key: string; label: string; href: string; on: boolean }[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-[13px] font-semibold text-ink-2">{label}</span>
      {items.map((i) => (
        <Link key={i.key} href={i.href} scroll={false} aria-current={i.on ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold no-underline sm:min-h-9 ${i.on ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-fill"}`}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

const BarsIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M4 12h16M4 17h7" /></svg>
);

// ---------------------------------------------------------------------------
// "Where it is now": the open segment of each transaction
// ---------------------------------------------------------------------------

function WhereNow({ txns, now }: { txns: JTxn[]; now: Date }) {
  return (
    <section aria-labelledby="where-now" className="card border-2 border-navy p-3 sm:p-4" data-where-now>
      <h2 id="where-now" className="text-[17px] font-bold text-navy">Where it is now</h2>
      <ul className="mt-2 flex flex-col">
        {txns.length === 0 && <li className="text-[15px] text-ink-2">No transactions.</li>}
        {txns.map((t) => (
          <li key={t.id} className="flex flex-col gap-1.5 border-t border-line py-2 first:border-t-0 md:flex-row md:items-center md:gap-3" data-strip={t.code}>
            <p className="min-w-0 flex-1 text-[15px] leading-7 text-ink">
              <StateChip state={t.state} />{" "}
              <strong className="font-semibold">{txnName(t.code, t.name)}</strong>
              {" · "}{t.owner ? t.owner.text : "Done"}
              {t.owner && !t.done && <> since {fmtShort(t.owner.since)} <span className="whitespace-nowrap text-[13px] text-ink-2">(<LiveSince since={t.owner.since.toISOString()} now={now.toISOString()} />)</span></>}
            </p>
            {t.tat && <span className="shrink-0"><TatChip data={t.tat} /></span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// List view: the 10 phases, compact step rows, nested holds, problems and attempts
// ---------------------------------------------------------------------------

function ListView({ phases, scope, filter, userId, now }: { phases: JPhase[]; scope: string; filter: string; userId: string; now: Date }) {
  const keep = (s: JStep) =>
    (scope === "ALL" || s.txnCode === scope)
    && (filter !== "issues" || s.holds.length > 0 || s.problems.length > 0 || s.state === "hold" || s.state === "problem")
    && (filter !== "mine" || s.ownerIds.includes(userId));
  const shown = phases.map((p) => ({ ...p, steps: p.steps.filter(keep) })).filter((p) => p.steps.length > 0 || (scope === "ALL" && filter === "all"));
  if (!shown.length) {
    return <p className="card p-4 text-[15px] text-ink-2">{filter === "issues" ? "No problems or holds here." : filter === "mine" ? "None of these steps are yours." : "Nothing to show."}</p>;
  }
  return (
    <ol aria-label="Journey" className="flex min-w-0 flex-col gap-3">
      {shown.map((p) => (
        <li key={p.n} className="card min-w-0 overflow-hidden" data-phase={p.n}>
          <h2 className="flex flex-wrap items-center gap-2 border-b border-line bg-fill px-3 py-2 sm:px-4">
            <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${p.state === "done" ? "bg-ok-fg text-white" : p.state === "current" ? "bg-gold text-navy" : "bg-fill-strong text-navy"}`}>{p.n}</span>
            <span className="min-w-0 flex-1 text-[15px] font-bold text-navy">Phase {p.n}: {p.title}</span>
            <span className="chip c-mute h-6 text-xs">{p.state === "done" ? "Done" : p.state === "current" ? "Now" : "Later"}</span>
          </h2>
          <ul className="flex flex-col">
            {p.steps.map((s) => <StepRow key={s.key} s={s} now={now} />)}
          </ul>
          {p.events.length > 0 && scope === "ALL" && filter === "all" && (
            <details className="border-t border-line px-3 py-1 sm:px-4">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-navy">Other events in this phase ({p.events.length})</summary>
              <Events events={p.events} />
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function StepRow({ s, now }: { s: JStep; now: Date }) {
  const reached = s.state !== "later" && s.state !== "na";
  const total = s.durationMs ?? 0;
  const parts = (Object.keys(s.stateMs) as SegState[]).filter((k) => s.stateMs[k] > 0);
  return (
    <li
      className={`flex min-w-0 flex-col gap-1.5 border-t border-line px-3 py-2.5 first:border-t-0 sm:px-4 ${s.open ? "border-l-4 border-l-gold bg-gold-soft" : ""} ${s.state === "problem" ? "border-l-[var(--bad-fg)]" : s.state === "hold" ? "border-l-navy" : ""}`}
      data-step={s.key} aria-current={s.open ? "step" : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StateChip state={s.state} />
        <span className="mono text-xs text-ink-2">{s.stepId}</span>
        <span className={`min-w-0 text-[15px] font-semibold ${s.state === "na" ? "text-ink-2" : "text-ink"}`}>{s.title}</span>
        {s.txnName && <span className="chip c-wait h-6 text-xs">{txnName(s.txnCode ?? "", s.txnName)}</span>}
        {s.simulated && <span className="chip c-act h-6 text-xs">Simulated</span>}
        <span className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {s.ownerRoles.map((r) => <RoleChip key={r} role={r} />)}
          {s.ownerName && <span className="text-[13px] text-ink">{s.ownerName}</span>}
        </span>
      </div>

      {s.state === "na" && <p className="text-[13px] text-ink-2">Not applicable{s.note ? ` · ${s.note}` : ""}</p>}
      {s.state === "later" && <p className="text-[13px] text-ink-2">Later · Target: {s.tat.targetText}{s.note ? ` · ${s.note}` : ""}</p>}
      {reached && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-ink-2">
          {s.start && <span>Started {fmtShort(s.start)}</span>}
          {s.end ? <span>Ended {fmtShort(s.end)}</span> : s.start ? <span className="font-semibold text-ink">Still open{s.openSince ? <> · <LiveSince since={s.openSince.toISOString()} now={now.toISOString()} /></> : null}</span> : null}
          {s.durationMs !== null && <span>Took {msText(total)}</span>}
          <span>Target: {s.tat.targetText}</span>
          {s.tat.actualText && <span className={s.tat.late > 0 ? "font-semibold text-bad-fg" : "text-ink"}>{s.tat.actualText}</span>}
          {s.note && <span>{s.note}</span>}
        </p>
      )}

      {reached && total > 0 && parts.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span aria-hidden="true" className="flex h-1.5 w-full max-w-md overflow-hidden rounded-full bg-fill-strong">
            {s.segments.map((g, i) => {
              const w = Math.max(0, ((g.end ?? now).getTime() - g.start.getTime()) / total) * 100;
              return <span key={i} className={SEG_BG[g.state]} style={{ width: `${w}%` }} />;
            })}
          </span>
          <span className="text-xs text-ink-2">{parts.map((k) => `${SEG_LABEL[k]} ${msText(s.stateMs[k])}`).join(" · ")}</span>
        </div>
      )}

      {s.stages && s.stages.length > 0 && (
        <ol className="ml-1 flex min-w-0 flex-col gap-1.5 border-l-2 border-gold/60 pl-3" aria-label="Stages" data-journey-stages>
          {s.stages.map((g) => (
            <li key={g.id} className={`rounded-lg p-2 text-[13px] ${g.state === "now" ? "bg-select-bg" : "bg-fill"}`} data-journey-stage={g.state}>
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">
                {g.state === "done" ? <CheckIcon size={14} /> : null}
                {g.name}
                <span className="font-normal text-ink-2">· {g.state === "done" ? "Done" : g.state === "now" ? (g.startedAt ? "Now" : "Next") : "Later"}</span>
              </p>
              {(g.startedAt || g.finishedAt) && (
                <p className="text-ink-2">
                  {g.startedAt ? `Started ${fmtShort(g.startedAt)}` : g.migrated ? "Recorded before stages existed" : ""}
                  {g.finishedAt ? ` · finished ${fmtShort(g.finishedAt)}` : ""}
                  {g.durationMs !== null && g.startedAt ? ` · ${msText(g.durationMs)}` : ""}
                  {g.by ? ` · ${g.by}` : ""}
                </p>
              )}
              {g.summary && <p className="text-ink">{g.summary}</p>}
              {(g.attempts.length > 0 || g.holds.length > 0 || g.problems.length > 0) && (
                <p className="text-ink-2">
                  {[
                    g.attempts.length ? `${g.attempts.length} attempt${g.attempts.length === 1 ? "" : "s"}` : "",
                    ...g.holds.map((h) => `On hold: ${h.reason}`),
                    ...g.problems.map((p) => `Problem: ${p.reason}${p.resolvedAt ? " (resolved)" : ""}`),
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {(s.holds.length > 0 || s.problems.length > 0 || s.attempts.length > 0) && (
        <ul className="ml-1 flex min-w-0 flex-col gap-1.5 border-l-2 border-line pl-3" aria-label="Holds, problems and attempts">
          {s.holds.map((h) => (
            <li key={h.id} className={`p-2 text-[13px] ${h.resumedAt ? "rounded-lg bg-fill" : "hold-card pl-4"}`} data-sub="hold">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                <span className="text-hold-fg"><PauseIcon size={14} /></span>
                On hold: {h.reason}
                <span className="font-normal">· {h.days} business day{h.days === 1 ? "" : "s"}</span>
                {h.simulated && <span className="chip c-act h-5 text-[11px]">Simulated</span>}
              </p>
              {/* Two entries: when it started (with the remarks) and when it resumed (with how long it waited). */}
              <p className="break-words text-ink" data-hold-started>{journeyHoldStarted({ reason: h.reason, note: h.note, raisedBy: h.raisedBy, raisedAt: h.raisedAt })}</p>
              {(h.transfers ?? []).map((x, i) => <p key={i} className="break-words text-ink" data-hold-transferred>{journeyHoldTransferred(x)}</p>)}
              {h.resumedAt
                ? <p className="break-words text-ink" data-hold-resumed>{journeyHoldResumed({ raisedAt: h.raisedAt, resumedAt: h.resumedAt, resumedBy: h.resumedBy, resumeNote: h.resumeNote })}</p>
                : <p className="text-ink-2">Still on hold (<LiveSince since={h.raisedAt.toISOString()} now={now.toISOString()} />). The TAT clock keeps running.</p>}
            </li>
          ))}
          {s.problems.map((p) => (
            <li key={p.id} className={`rounded-lg p-2 text-[13px] ${p.resolvedAt ? "bg-fill" : "bg-bad-bg text-bad-fg"}`} data-sub="problem">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                <AlertIcon size={14} /> Problem: {p.reason}
                <span className="font-normal">· {p.days} business day{p.days === 1 ? "" : "s"}</span>
                {p.outsideControl && <span className="chip c-wait h-5 text-[11px]">Outside our control</span>}
                {p.simulated && <span className="chip c-act h-5 text-[11px]">Simulated</span>}
              </p>
              <p className={p.resolvedAt ? "text-ink-2" : ""}>
                {fmtShort(p.raisedAt)} to {p.resolvedAt ? fmtShort(p.resolvedAt) : <>now (<LiveSince since={p.raisedAt.toISOString()} now={now.toISOString()} />)</>}
                {" · "}raised by {p.raisedBy}{p.resolvedBy ? `, resolved by ${p.resolvedBy}` : ""}
                {p.note ? ` · ${p.note}` : ""}{p.resolutionNote ? ` · ${p.resolutionNote}` : ""}
              </p>
            </li>
          ))}
          {s.attempts.map((a) => (
            <li key={a.id} className="rounded-lg bg-fill p-2 text-[13px]" data-sub="attempt">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                {a.result === "DONE" ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
                Attempt on {fmtDate(a.date)}: {a.result === "DONE" ? "Done" : `Not processed (${a.reason ?? "no reason"})`}
                {a.simulated && <span className="chip c-act h-5 text-[11px]">Simulated</span>}
              </p>
              <p className="text-ink-2">by {a.by}{a.note ? ` · ${a.note}` : ""}</p>
            </li>
          ))}
        </ul>
      )}

      {s.events.length > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[13px] font-semibold text-navy sm:min-h-8">
            <ChevronRightIcon size={16} className="transition-transform group-open:rotate-90" /> Details ({s.events.length})
          </summary>
          <Events events={s.events} />
        </details>
      )}
    </li>
  );
}

function Events({ events }: { events: { at: Date; text: string; simulated: boolean }[] }) {
  return (
    <ol className="mb-2 flex flex-col gap-1.5 pl-5">
      {events.map((e, i) => (
        <li key={i} className="text-[13px]">
          <span className="text-ink">{e.text}</span>{" "}
          <span className="whitespace-nowrap text-ink-2">{fmtShort(e.at)}</span>
          {e.simulated && <span className="chip c-act ml-1.5 h-5 text-[11px]">Simulated</span>}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Bars view: one row per transaction, a cell per day coloured by state
// ---------------------------------------------------------------------------

const CELL: Record<CellState, string> = {
  waiting: "bg-[rgb(12_35_64/0.22)]", processing: "bg-gold", hold: "bg-[var(--hold-line)] text-hold-fg", problem: "bg-[var(--bad-fg)] text-white", done: "bg-ok-fg text-white", none: "bg-white",
};
const CELL_WORD: Record<CellState, string> = { waiting: "Waiting", processing: "Processing", hold: "On hold", problem: "Problem", done: "Done", none: "Nothing" };

function BarsView({ txns, holidays, now }: { txns: JTxn[]; holidays: ReadonlySet<string>; now: Date }) {
  if (!txns.length) return <p className="card p-4 text-[15px] text-ink-2">Nothing to show.</p>;
  const rows = txns.map((t) => ({ t, cells: dayCells(t, holidays, now) }));
  const first = rows.map((r) => r.cells[0]?.date).filter(Boolean).sort()[0]!;
  const last = rows.map((r) => r.cells.at(-1)?.date).filter(Boolean).sort().at(-1)!;
  const dates: string[] = [];
  for (let d = first; d <= last && dates.length < 400; d = addDay(d)) dates.push(d);
  const today = businessDate(now);
  return (
    <section aria-labelledby="bars-h" className="card flex min-w-0 flex-col gap-3 p-3 sm:p-4" data-bars>
      <h2 id="bars-h" className="text-[17px] font-bold text-navy">Days by state</h2>
      <Legend />
      {/* The picture (the table below has the same data for screen readers). Scrolls inside its own box. */}
      <div aria-hidden="true" className="min-w-0 overflow-x-auto" data-bars-scroll>
        <div className="inline-grid gap-y-1.5" style={{ gridTemplateColumns: `minmax(96px,140px) repeat(${dates.length}, 26px)` }}>
          <span />
          {dates.map((d) => (
            <span key={d} className={`text-center text-[10px] leading-tight ${d === today ? "font-bold text-navy" : "text-ink-2"}`} title={fmtDate(d)}>
              {d.slice(8)}<br />{["S", "M", "T", "W", "T", "F", "S"][new Date(`${d}T12:00:00Z`).getUTCDay()]}
            </span>
          ))}
          {rows.map(({ t, cells }) => {
            const byDate = new Map(cells.map((c) => [c.date, c]));
            return [
              <span key={`${t.id}-n`} className="flex items-center pr-2 text-[13px] font-semibold text-navy">{txnName(t.code, t.name)}</span>,
              ...dates.map((d) => {
                const c = byDate.get(d);
                const st: CellState = c?.state ?? "none";
                const off = c ? c.offDay : !isWorkday(d, holidays);
                return (
                  <span key={`${t.id}-${d}`} title={`${txnName(t.code, t.name)} · ${fmtDate(d)} · ${CELL_WORD[st]}${off ? " (weekend or holiday)" : ""}${c?.deadline ? " · Target date" : ""}`}
                    className={`relative flex h-7 items-center justify-center border-y border-l border-white ${CELL[st]} ${off ? "opacity-40" : ""} ${st === "none" ? "border-line" : ""}`}>
                    {st === "hold" && <PauseIcon size={11} strokeWidth={3} />}
                    {st === "problem" && <AlertIcon size={11} strokeWidth={3} />}
                    {c?.deadline && <span className="absolute inset-y-[-4px] right-[-2px] border-r-2 border-dashed border-navy" />}
                    {d === today && <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-navy" />}
                  </span>
                );
              }),
            ];
          })}
        </div>
      </div>
      <BarsTable txns={txns} holidays={holidays} now={now} />
    </section>
  );
}

function Legend() {
  const items: [CellState | "deadline" | "off", string][] = [["waiting", "Waiting"], ["processing", "Processing"], ["hold", "On hold"], ["problem", "Problem"], ["done", "Done"], ["off", "Weekend or holiday (dimmed)"], ["deadline", "Target date (dashed line)"]];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink" aria-label="Legend">
      {items.map(([k, l]) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          {k === "deadline" ? <span aria-hidden="true" className="h-4 w-0 border-r-2 border-dashed border-navy" />
            : k === "off" ? <span aria-hidden="true" className="h-3.5 w-3.5 rounded-sm bg-gold opacity-40" />
              : <span aria-hidden="true" className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm ${CELL[k]}`}>{k === "hold" && <PauseIcon size={9} strokeWidth={3} />}</span>}
          {l}
        </li>
      ))}
    </ul>
  );
}

/** The same data as the bars, as a table: each state span of each transaction. */
function BarsTable({ txns, holidays, now }: { txns: JTxn[]; holidays: ReadonlySet<string>; now: Date }) {
  return (
    <details className="group" open>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-navy">
        <ChevronRightIcon size={16} className="transition-transform group-open:rotate-90" /> The same as a table
      </summary>
      <div className="min-w-0 overflow-x-auto">
        <table className="table whitespace-nowrap" data-bars-table>
          <caption className="sr-only">Time in each state, per transaction (business days skip weekends and holidays)</caption>
          <thead><tr><th scope="col">Transaction</th><th scope="col">State</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Business days</th></tr></thead>
          <tbody>
            {txns.flatMap((t) => [
              ...t.segments.map((g, i) => (
                <tr key={`${t.id}-${i}`}>
                  <th scope="row" className="font-semibold">{txnName(t.code, t.name)}</th>
                  <td>{SEG_LABEL[g.state]}</td>
                  <td>{fmtShort(g.start)}</td>
                  <td>{g.end ? fmtShort(g.end) : "Now"}</td>
                  <td>{businessSpan(g.start, g.end ?? now, holidays)}</td>
                </tr>
              )),
              ...(t.done && t.end ? [<tr key={`${t.id}-done`}><th scope="row" className="font-semibold">{txnName(t.code, t.name)}</th><td>Done</td><td>{fmtShort(t.end)}</td><td>-</td><td>-</td></tr>] : []),
              ...(t.deadline ? [<tr key={`${t.id}-dl`}><th scope="row" className="font-semibold">{txnName(t.code, t.name)}</th><td>Target date</td><td colSpan={3}>{fmtDate(t.deadline)}</td></tr>] : []),
            ])}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function addDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function isWorkday(ymd: string, holidays: ReadonlySet<string>) {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(ymd);
}

// ---------------------------------------------------------------------------
// Documents scope
// ---------------------------------------------------------------------------

function docItems(j: Journey, liveCodes: string[]): DocItem[] {
  return j.docs
    .filter((d) => !d.txnCode || liveCodes.includes(d.txnCode))
    .map((d) => ({
      id: d.id, documentId: d.documentId, label: d.label, original: d.originality === "ORIGINAL",
      txnName: d.txnCode ? txnName(d.txnCode, d.txnName ?? undefined) : null,
      holder: d.holder, place: d.place, sinceText: fmtShort(d.since),
      trail: d.trail.map((m) => ({ id: m.id, label: m.label, when: fmtShort(m.at), by: m.by, place: m.place, ack: m.acknowledgedBy, remarks: m.remarks, simulated: m.simulated })),
      periods: d.periods.map((p) => ({ holder: p.holder, place: p.place, from: fmtShort(p.from), to: p.to ? fmtShort(p.to) : null, held: msText(p.ms) })),
    }));
}
