import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { LoanDetail } from "@/lib/services/queries";
import { loadJourney } from "@/lib/services/journey";
import { checklistStatusOf } from "@/lib/services/workflow";
import { getTatMap } from "@/lib/settings";
import { openHold, openProblem, txnTat } from "@/lib/jobs/view";
import { businessDate, fmtDate, fmtShort } from "@/lib/time";
import { txnName } from "@/lib/ui/plain";
import { sentBack } from "@/lib/ui/rounds";
import { holdReasonName, journeyHoldResumed, journeyHoldStarted, journeyHoldTransferred } from "@/lib/ui/holds";
import { txnStatus, type TxnStatus } from "@/lib/ui/txn-status";
import { holdDays, problemDays } from "@/lib/workflow/tat";
import { STEP_STATE_LABEL, undoubleRole, type JPhase, type JStep, type Journey, type StepState } from "@/lib/workflow/build-journey";
import {
  FLAG_WORD, STORY_FILTERS, WHERE_WORD, spanText, storyDays, storyShowOf, timeText,
  type DocColumn, type Flag, type JourneyStory, type Milestone, type StoryLine, type WhereKind, type WhereLine,
} from "@/lib/workflow/journey-story";
import { RoleChip } from "@/components/chips";
import {
  AlertIcon, ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, CoinsIcon, HourglassIcon, MinusIcon, PauseIcon, WarningIcon,
} from "@/components/ui/icons";
import { LiveSince } from "./live-since";
import { DocsList, type DocItem } from "./docs-list";
import { SimulatorBlock } from "./simulator-block";
import { JourneySwitch, LogControls, MilestoneButton } from "./journey-client";

/**
 * The Journey of a loan, read three ways from the same records (lib/workflow/journey-story.ts):
 *   "Where it is now" (always on top), then Story (default), By document, or Full log.
 * The choice and the filters live in the address (?tab=journey&journey=story&show=attention&txn=NOTARY),
 * so a refresh keeps them. Reading only: nothing here records or changes anything.
 */

export interface JourneyParams {
  journey?: string; show?: string; txn?: string; flag?: string; order?: string; log?: string; sys?: string; na?: string;
  /** Older addresses (scope=DOCS opened the papers list): they open the Full log. */
  scope?: string;
}
type View = "story" | "docs" | "log";

export async function JourneyTab({ loan, user, params }: { loan: LoanDetail; user: CurrentUser; params: JourneyParams }) {
  const [{ journey: j, story, holidays }, tats] = await Promise.all([loadJourney(user, loan), getTatMap()]);
  const view: View = params.journey === "docs" || params.journey === "log" ? params.journey : params.scope === "DOCS" ? "log" : "story";
  const base = `/loans/${loan.pn}?tab=journey`;
  const href = (p: Record<string, string | undefined>) => `${base}${Object.entries(p).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join("")}`;
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const txns = live.map((t) => ({ code: t.type.code, name: txnName(t.type.code, t.type.name) }));

  // The one status word of each transaction (the same words as the rest of the Loan File).
  const words = new Map<string, TxnStatus>(live.map((t) => {
    const c = checklistStatusOf(t.checks);
    const p = openProblem(t.problems);
    const h = openHold(t.holds);
    const missing = loan.exceptions.filter((e) => e.transactionId === t.id && e.type === "LEGAL_DOCS_COMPLETION" && e.status === "OPEN").length;
    return [t.id, txnStatus({
      code: t.type.code, requiresDp: t.type.requiresDp, status: t.status, requiredDone: c.expectedDone, requiredTotal: c.expectedTotal,
      tickedAny: t.checks.some((x) => x.checked), edstReference: t.edstReference,
      returnedForPapers: t.status === "RETURNED" && !!t.dpAssignments[0]?.returnReasonId ? (t.dpAssignments[0].returnReason?.name ?? "Papers needed") : null,
      sentBack: sentBack(t.status, t.dpAssignments)?.kind ?? null,
      tat: txnTat(t, tats, holidays),
      problem: p ? { reason: p.reason.name, days: Math.max(1, problemDays([p], holidays)) } : null,
      hold: h ? { reason: holdReasonName(h), days: Math.max(1, holdDays([h], holidays)) } : null,
      missingPapers: missing,
    })];
  }));

  const views: [View, string][] = [["story", "Story"], ["docs", "By document"], ["log", "Full log"]];
  return (
    <div className="flex min-w-0 flex-col gap-3" data-journey data-journey-view={view}>
      <WhereNow lines={story.where} />
      <JourneySwitch current={view} items={views.map(([k, l]) => ({ key: k, label: l, href: href({ journey: k }) }))} />
      <div id="journey-panel" role="tabpanel" aria-labelledby={`journey-tab-${view}`} className="min-w-0">
        {view === "story" && <StoryView story={story} now={j.now} txns={txns} params={params} href={href} />}
        {view === "docs" && <DocsBoard columns={story.columns} words={words} attentionFirst={params.order === "attention"} href={href} />}
        {view === "log" && <FullLog j={j} open={params.log === "open"} papersOpen={params.scope === "DOCS"} sys={params.sys === "1"} na={params.na === "1"} codes={live.map((t) => t.type.code)} />}
      </div>
      <SimulatorBlock loan={loan} user={user} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills and icons
// ---------------------------------------------------------------------------

const WHERE_STYLE: Record<WhereKind, { cls: string; Icon: typeof ClockIcon }> = {
  now: { cls: "c-wait", Icon: ClockIcon },
  hold: { cls: "c-hold", Icon: PauseIcon },
  problem: { cls: "c-bad", Icon: AlertIcon },
  returned: { cls: "c-act", Icon: ArrowLeftIcon },
  done: { cls: "c-ok", Icon: CheckIcon },
};
function WherePill({ kind }: { kind: WhereKind }) {
  const s = WHERE_STYLE[kind];
  return <span className={`chip ${s.cls} h-6 shrink-0 px-2 text-xs`} data-where-pill={kind}><s.Icon size={12} strokeWidth={2.4} />{WHERE_WORD[kind]}</span>;
}

const FLAG_STYLE: Record<Flag | "funds", { tint: string; chip: string; Icon: typeof ClockIcon }> = {
  return: { tint: "bg-act-bg", chip: "c-act", Icon: ArrowLeftIcon },
  decline: { tint: "bg-act-bg", chip: "c-act", Icon: ArrowLeftIcon },
  missing: { tint: "bg-act-bg", chip: "c-act", Icon: WarningIcon },
  hold: { tint: "bg-hold-bg", chip: "c-hold", Icon: PauseIcon },
  problem: { tint: "bg-bad-bg", chip: "c-bad", Icon: AlertIcon },
  funds: { tint: "bg-fill", chip: "c-mute", Icon: CoinsIcon },
};
function FlagChip({ flag, word }: { flag: Flag | "funds"; word: string }) {
  const s = FLAG_STYLE[flag];
  return <span className={`chip ${s.chip} mr-1.5 h-5 shrink-0 px-1.5 align-[1px] text-[11px]`}><s.Icon size={11} strokeWidth={2.6} />{word}</span>;
}

const TONE_CLS: Record<string, string> = { act: "c-act", wait: "c-wait", ok: "c-ok", bad: "c-bad", mute: "c-mute", navy: "c-wait", hold: "c-hold" };
const TxnPill = ({ name }: { name: string }) => <span className="chip c-mute h-5 shrink-0 px-1.5 text-[11px] font-semibold" data-txn-pill>{name}</span>;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------
// 1. Where it is now
// ---------------------------------------------------------------------------

function WhereNow({ lines }: { lines: WhereLine[] }) {
  return (
    <section aria-labelledby="where-now" className="card px-3 py-2.5 sm:px-4" data-where-now>
      <h2 id="where-now" className="text-[15px] font-bold text-navy">Where it is now</h2>
      <ul className="mt-1 flex flex-col divide-y divide-line">
        {lines.length === 0 && <li className="py-1.5 text-sm text-ink-2">No transactions.</li>}
        {lines.map((l) => (
          <li key={l.key} className="flex flex-col gap-1 py-1.5 sm:flex-row sm:items-center sm:gap-3" data-where-line data-strip={l.codes.join(" ")}>
            <p className="flex min-w-0 flex-1 items-start gap-2 text-sm leading-6 text-ink">
              <WherePill kind={l.kind} />
              <span className="min-w-0 break-words">
                <strong className="font-semibold">{l.label}</strong>: {lowerFirst(undoubleRole(l.text))}
                {l.since && <> since {fmtShort(l.since)} <span className="whitespace-nowrap text-ink-2">({l.forText})</span></>}
              </span>
            </p>
            {l.note && <span className={`shrink-0 pl-[68px] text-xs sm:pl-0 ${l.note.late ? "font-semibold text-bad-fg" : "text-ink-2"}`} data-where-note>{l.note.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Story
// ---------------------------------------------------------------------------

/** All · Needs attention (lib/workflow/journey-story.ts; an old ?show=mine in the address shows All). */
const FILTERS = STORY_FILTERS;

function StoryView({ story, now, txns, params, href }: {
  story: JourneyStory; now: Date; txns: { code: string; name: string }[]; params: JourneyParams;
  href: (p: Record<string, string | undefined>) => string;
}) {
  const show = storyShowOf(params.show);
  const txn = txns.some((t) => t.code === params.txn) ? params.txn! : "";
  const flag = (["return", "problem", "hold", "missing"] as const).find((f) => f === params.flag) ?? "";
  const keep = { journey: "story", show: show === "all" ? undefined : show, txn: txn || undefined, flag: flag || undefined };

  let lines = story.lines;
  if (txn) lines = lines.filter((l) => l.txns.some((t) => t.code === txn));
  if (show === "attention") lines = lines.filter((l) => l.flag);
  if (flag) lines = lines.filter((l) => (flag === "return" ? l.flag === "return" || l.flag === "decline" : l.flag === flag));
  const days = storyDays(lines, now);

  const c = story.counts;
  const counts: [Exclude<Flag, "decline">, number, string][] = [
    ["return", c.return + c.decline, "return"], ["problem", c.problem, "problem"], ["hold", c.hold, "hold"],
    ...(c.missing ? [["missing", c.missing, "missing paper"] as [Exclude<Flag, "decline">, number, string]] : []),
  ];
  const any = counts.some(([, n]) => n > 0);

  return (
    <section aria-label="Story" className="card flex min-w-0 flex-col gap-2 p-3 sm:p-4" data-story>
      {any && (
        // One soft badge per kind, in the colour and icon of its lines (grey at 0); pressing one shows only those lines.
        <div role="group" aria-label="What held it up" className="flex flex-wrap items-center gap-1.5" data-story-counts>
          {counts.map(([k, n, w]) => {
            const st = FLAG_STYLE[k];
            const on = flag === k;
            return (
              <Link key={k} href={href({ ...keep, flag: on ? undefined : k })} scroll={false} aria-current={on ? "true" : undefined}
                className={`chip ${n ? st.chip : "c-mute"} h-auto min-h-11 gap-1 px-2.5 text-xs font-semibold no-underline sm:min-h-7 ${on ? "ring-2 ring-navy ring-offset-1" : ""} ${n ? "" : "opacity-80"}`}
                data-story-count={k} data-count={n}>
                <st.Icon size={12} strokeWidth={2.6} />{n} {w}{n === 1 ? "" : "s"}
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" data-story-filters>
        <div role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-lg border border-line-strong">
          {FILTERS.map(([k, l]) => (
            <Link key={k} href={href({ ...keep, show: k === "all" ? undefined : k })} scroll={false} aria-current={show === k ? "true" : undefined}
              className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold no-underline sm:min-h-8 ${show === k ? "bg-navy text-white" : "bg-white text-navy hover:bg-fill"}`}>{l}</Link>
          ))}
        </div>
        <div role="group" aria-label="Transaction" className="flex min-w-0 flex-wrap gap-1.5">
          {[{ code: "", name: "Whole loan" }, ...txns].map((t) => (
            <Link key={t.code || "all"} href={href({ ...keep, txn: t.code || undefined })} scroll={false} aria-current={txn === t.code ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] font-semibold no-underline sm:min-h-8 ${txn === t.code ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-fill"}`}>{t.name}</Link>
          ))}
        </div>
      </div>

      {story.lines.length === 0 ? <p className="py-2 text-sm text-ink-2" data-story-empty>Nothing has happened yet.</p>
        : days.length === 0 ? <p className="py-2 text-sm text-ink-2" data-story-empty>Nothing here for this filter.</p>
          : days.map((d) => (
            <section key={d.date} aria-labelledby={`day-${d.date}`} className="min-w-0" data-story-day={d.date}>
              {/* The date row; the day's events are its sub-rows, each with its time (newest first). */}
              <h3 id={`day-${d.date}`} className="mt-1 rounded-md bg-fill px-2 py-1 text-[13px] font-bold text-navy" data-story-heading>{d.heading}</h3>
              <ol className="mt-0.5 flex flex-col gap-0.5 border-l-2 border-line pl-2 sm:ml-2 sm:pl-3">
                {d.lines.map((l) => <StoryRow key={l.key} l={l} />)}
              </ol>
            </section>
          ))}
    </section>
  );
}

/** One event under its date row: the time (PHT), the sentence, the transaction pills. */
function StoryRow({ l }: { l: StoryLine }) {
  const tint = l.flag ? FLAG_STYLE[l.flag].tint : "";
  return (
    <li className={`flex min-w-0 gap-2.5 rounded-lg px-2 py-1 sm:gap-3 ${tint}`} data-story-line data-flag={l.flag ?? undefined} data-system={l.system ? "" : undefined}>
      <time dateTime={l.at.toISOString()} className="w-[60px] shrink-0 pt-px text-xs tabular-nums leading-5 text-ink-2 sm:w-[68px]" data-story-time>{timeText(l.at)}</time>
      <p className={`min-w-0 flex-1 break-words text-sm leading-5 ${l.system ? "text-ink-2" : "text-ink"}`}>
        {l.flag && <FlagChip flag={l.flag} word={FLAG_WORD[l.flag]} />}
        <span data-story-sentence>{l.sentence}</span>
        {l.system && <>{" · "}{l.system.count} step{l.system.count === 1 ? "" : "s"}</>}
        {l.txns.length > 0 && <span className="ml-1.5 inline-flex flex-wrap gap-1 align-[1px]">{l.txns.map((t) => <TxnPill key={t.code} name={t.name} />)}</span>}
        {l.simulated && <span className="chip c-act ml-1.5 h-5 px-1.5 align-[1px] text-[11px]">Simulated</span>}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 3. By document
// ---------------------------------------------------------------------------

function DocsBoard({ columns, words, attentionFirst, href }: { columns: DocColumn[]; words: Map<string, TxnStatus>; attentionFirst: boolean; href: (p: Record<string, string | undefined>) => string }) {
  if (!columns.length) return <p className="card p-4 text-sm text-ink-2">No transactions.</p>;
  const cols = attentionFirst ? [...columns.filter((c) => c.attention), ...columns.filter((c) => !c.attention)] : columns;
  const openOnPhone = new Set(cols.some((c) => c.attention) ? cols.filter((c) => c.attention).map((c) => c.id) : [cols.find((c) => c.kind !== "done")?.id ?? cols[0].id]);
  const wide = cols.length > 4;
  return (
    <section aria-label="By document" className="flex min-w-0 flex-col gap-2" data-by-document>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">Each transaction from opened to done. Press a step for its details.</p>
        <Link href={href({ journey: "docs", order: attentionFirst ? undefined : "attention" })} scroll={false} aria-pressed={attentionFirst}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold no-underline sm:min-h-8 ${attentionFirst ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-fill"}`} data-attention-first>
          {attentionFirst && <CheckIcon size={13} strokeWidth={2.6} />}Needs attention first
        </Link>
      </div>

      {/* Tablet and desktop: columns (two per row on tablet; side by side on desktop, scrolling inside the board only). */}
      <div className="relative hidden min-w-0 md:block">
        <div className={`grid min-w-0 grid-cols-2 gap-3 lg:flex lg:overflow-x-auto ${wide ? "lg:pr-10" : ""}`} data-board>
          {cols.map((c) => (
            <section key={c.id} aria-labelledby={`col-${c.code}`} className={`card flex min-w-0 flex-col p-3 lg:min-w-[232px] lg:flex-1 ${c.attention ? "border-act-line" : ""}`} data-doc-column={c.code} data-attention={c.attention || undefined}>
              <ColumnHead c={c} word={words.get(c.id)} id={`col-${c.code}`} />
              <Milestones c={c} />
            </section>
          ))}
        </div>
        {wide && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-12 items-center justify-end bg-gradient-to-l from-white to-transparent pr-1 text-ink-2 lg:flex" data-board-fade>
            <ChevronRightIcon size={18} />
          </div>
        )}
        {wide && <p className="mt-1 hidden text-xs text-ink-2 lg:block">Scroll sideways in the board for more transactions.</p>}
      </div>

      {/* Phone: one card per transaction; the ones that need attention are open. */}
      <div className="flex min-w-0 flex-col gap-2 md:hidden">
        {cols.map((c) => (
          <details key={c.id} open={openOnPhone.has(c.id)} className={`card group min-w-0 ${c.attention ? "border-act-line" : ""}`} data-doc-card={c.code} data-attention={c.attention || undefined}>
            <summary className="flex min-h-12 list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <ColumnHead c={c} word={words.get(c.id)} id={`card-${c.code}`} />
              <ChevronDownIcon size={16} className="ml-auto shrink-0 text-ink-2 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="px-3 pb-3"><Milestones c={c} /></div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ColumnHead({ c, word, id }: { c: DocColumn; word: TxnStatus | undefined; id: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <h3 id={id} className="min-w-0 text-[15px] font-bold text-navy">{c.name}</h3>
      {word && <span className={`chip ${TONE_CLS[word.pill.tone] ?? "c-mute"} h-6 px-2 text-xs`} data-column-status>{word.pill.text}</span>}
      {c.note && <span className={`text-xs ${c.note.late ? "font-semibold text-bad-fg" : "text-ink-2"}`}>{c.note.text}</span>}
    </div>
  );
}

const DOT: Record<Milestone["state"], string> = {
  done: "border-ok-fg bg-ok-fg",
  now: "border-gold bg-[linear-gradient(90deg,var(--gold)_50%,white_50%)]",
  later: "border-line-strong bg-white",
};
const STATE_WORD: Record<Milestone["state"], string> = { done: "done", now: "now", later: "later" };

function Milestones({ c }: { c: DocColumn }) {
  const max = Math.max(1, ...c.milestones.map((m) => m.durationMs ?? 0));
  return (
    <ol className="mt-2 flex min-w-0 flex-col" aria-label={`${c.name} steps`}>
      {c.milestones.map((m, i) => (
        <li key={m.key} className="relative flex min-w-0 gap-2 pb-2 last:pb-0" data-milestone={m.key} data-milestone-state={m.state}>
          {i < c.milestones.length - 1 && <span aria-hidden="true" className={`absolute bottom-0 left-[6px] top-4 w-0.5 ${m.state === "done" ? "bg-ok-fg/50" : "bg-line"}`} />}
          <span aria-hidden="true" className={`relative z-[1] mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${DOT[m.state]}`} />
          <MilestoneButton title={`${c.name}: ${m.label}`} details={m.details.map((d) => ({ when: fmtShort(d.at), text: d.text }))}
            className="-my-0.5 flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-lg px-1.5 py-0.5 text-left hover:bg-fill sm:min-h-0">
            <span className={`block text-sm font-semibold ${m.state === "later" ? "text-ink-2" : "text-ink"}`}>
              {m.label}<span className="sr-only">, {STATE_WORD[m.state]}</span>
            </span>
            {m.state === "done" && (
              <span className="block text-xs text-ink-2" data-milestone-when>
                {m.at ? fmtShort(m.at) : "Done"}{m.who ? ` · ${m.who}` : ""}{m.durationMs !== null ? ` · ${spanText(m.durationMs)}` : ""}
              </span>
            )}
            {m.state === "now" && (
              <span className="block text-xs font-semibold text-navy" data-milestone-when>
                {m.since ? `since ${fmtShort(m.since)} · ${m.forText}` : "Now"}
              </span>
            )}
            {m.state === "later" && <span className="block text-xs text-ink-2">Later</span>}
            {m.sub && <span className="block text-xs text-ink-2">{m.sub}</span>}
            {m.markers.map((k, x) => (
              <span key={x} className={`mt-0.5 block rounded-md px-1.5 py-0.5 text-xs leading-snug text-ink ${FLAG_STYLE[k.kind].tint}`} data-marker={k.kind}>
                <FlagChip flag={k.kind} word={k.word} />{k.text}{k.round ? ` (Round ${k.round})` : ""}
              </span>
            ))}
            {m.state === "done" && m.durationMs !== null && (
              <span aria-hidden="true" className="mt-1 block h-1 w-full rounded-full bg-fill-strong">
                <span className="block h-1 rounded-full bg-navy/40" style={{ width: `${Math.max(3, Math.round((m.durationMs / max) * 100))}%` }} />
              </span>
            )}
          </MilestoneButton>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// 4. Full log (the phases, every step, for checking)
// ---------------------------------------------------------------------------

function FullLog({ j, open, papersOpen, sys, na, codes }: { j: Journey; open: boolean; papersOpen: boolean; sys: boolean; na: boolean; codes: string[] }) {
  const today = businessDate(j.now);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-log-root data-sys-off={sys ? undefined : ""} data-na-off={na ? undefined : ""}>
      <details open={open} className="card group min-w-0 overflow-hidden" data-full-log>
        <summary className="flex min-h-12 cursor-pointer list-none items-start gap-2 px-3 py-2.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon size={18} className="mt-0.5 shrink-0 text-navy transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-navy">Full audit log</span>
            <span className="block text-[13px] text-ink-2">Every step, including automatic ones. For checking.</span>
          </span>
        </summary>
        <LogControls sys={sys} na={na} />
        <ol aria-label="Journey" className="flex min-w-0 flex-col">
          {j.phases.map((p) => <PhaseBlock key={p.n} p={p} now={j.now} today={today} />)}
        </ol>
      </details>
      <details className="card group min-w-0 overflow-hidden" data-papers-log open={papersOpen}>
        <summary className="flex min-h-12 cursor-pointer list-none items-start gap-2 px-3 py-2.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon size={18} className="mt-0.5 shrink-0 text-navy transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-navy">Papers: who has them</span>
            <span className="block text-[13px] text-ink-2">Each paper&apos;s trail: who held it, where and for how long.</span>
          </span>
        </summary>
        <div className="border-t border-line p-3 sm:p-4"><DocsList docs={docItems(j, codes)} /></div>
      </details>
    </div>
  );
}

const STATE_STYLE: Record<StepState, { cls: string; Icon: typeof ClockIcon }> = {
  waiting: { cls: "c-mute", Icon: HourglassIcon },
  now: { cls: "c-act", Icon: ClockIcon },
  hold: { cls: "c-hold", Icon: PauseIcon },
  problem: { cls: "c-bad", Icon: AlertIcon },
  done: { cls: "c-ok", Icon: CheckIcon },
  later: { cls: "c-mute", Icon: ChevronRightIcon },
  na: { cls: "c-mute", Icon: MinusIcon },
};

function StateChip({ state }: { state: StepState }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`chip ${s.cls} h-6 shrink-0 px-2 align-middle text-xs`} data-state={state}>
      <s.Icon size={12} strokeWidth={2.4} />{STEP_STATE_LABEL[state]}
    </span>
  );
}

function PhaseBlock({ p, now, today }: { p: JPhase; now: Date; today: string }) {
  return (
    <li className="min-w-0 border-t border-line" data-phase={p.n}>
      <h3 className="flex flex-wrap items-center gap-2 bg-fill px-3 py-1.5 sm:px-4">
        <span className="min-w-0 flex-1 text-sm font-bold text-navy">Phase {p.n}: {p.title}</span>
        <span className="text-xs text-ink-2">{p.state === "done" ? "Done" : p.state === "current" ? "Now" : "Later"}</span>
      </h3>
      <ul className="flex flex-col">
        {p.steps.map((s) => <LogRow key={s.key} s={s} now={now} today={today} />)}
      </ul>
      {p.events.length > 0 && (
        <details className="border-t border-line px-3 py-1 sm:px-4" data-log-row data-log-who="SYS" data-log-text={p.events.map((e) => e.text).join(" ").toLowerCase()}>
          <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-navy sm:min-h-9">Other events in this phase ({p.events.length})</summary>
          <Events events={p.events} />
        </details>
      )}
    </li>
  );
}

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * One step: the state, the step number (here only, for reference), the title, who, and one phrase
 * for its time ("Done in 4 min · Nov 9, 11:54 PM", "Open since ..."). The target is named only when
 * it is late or due today; holds, problems and attempts nest under it, with its recorded details.
 */
function LogRow({ s, now, today }: { s: JStep; now: Date; today: string }) {
  const system = s.ownerRoles.length > 0 && s.ownerRoles.every((r) => r === "SYS");
  const text = [s.stepId, s.title, s.txnName ?? "", s.ownerName ?? "", s.note ?? "", ...s.events.map((e) => e.text), ...s.holds.map((h) => `${h.reason} ${h.note}`), ...s.problems.map((p) => p.reason)].join(" ").toLowerCase();
  const late = s.tat.late > 0 && s.state !== "na" && s.state !== "later";
  const dueToday = !late && !s.end && s.start && s.tat.deadline === today;
  return (
    <li id={`step-${s.key}`} className={`flex min-w-0 scroll-mt-28 flex-col gap-1 border-t border-line px-3 py-2 first:border-t-0 sm:px-4 ${s.open ? "bg-gold-soft" : ""}`}
      data-step={s.key} data-log-row data-log-sys={system || undefined} data-log-na={s.state === "na" || undefined} data-log-who={s.ownerRoles.join(" ")} data-log-text={text}
      aria-current={s.open ? "step" : undefined}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StateChip state={s.state} />
        <span className="mono text-[11px] text-ink-2">{s.stepId}</span>
        <span className={`min-w-0 text-sm font-semibold ${s.state === "na" ? "text-ink-2" : "text-ink"}`}>{s.title}</span>
        {s.txnName && <span className="chip c-mute h-5 px-1.5 text-[11px]">{txnName(s.txnCode ?? "", s.txnName)}</span>}
        {s.simulated && <span className="chip c-act h-5 px-1.5 text-[11px]">Simulated</span>}
        <span className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {s.ownerRoles.map((r) => <RoleChip key={r} role={r} />)}
          {s.ownerName && <span className="text-[13px] text-ink">{s.ownerName}</span>}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-2 text-[13px] text-ink-2" data-log-time>
        {s.state === "na" ? <span>Not applicable{s.note ? ` · ${s.note}` : ""}</span>
          : s.state === "later" ? <span>Later{s.note ? ` · ${s.note}` : ""}</span>
            : s.end ? <span>{s.durationMs !== null && s.start ? `Done in ${spanText(s.durationMs)}` : "Done"} · {fmtShort(s.end)}</span>
              : s.start ? <span className="font-semibold text-ink">Open since {fmtShort(s.openSince ?? s.start)} · <LiveSince since={(s.openSince ?? s.start).toISOString()} now={now.toISOString()} /></span>
                : <span>{STEP_STATE_LABEL[s.state]}</span>}
        {late && <span className="font-semibold text-bad-fg" data-log-late>{dd(s.tat.late)} late</span>}
        {dueToday && <span className="font-semibold text-act-fg">Due today</span>}
        {s.note && s.state !== "na" && s.state !== "later" && <span>{s.note}</span>}
      </p>

      {s.stages && s.stages.length > 0 && (
        <ol className="ml-1 flex min-w-0 flex-col gap-1 border-l-2 border-gold/60 pl-3" aria-label="Stages" data-journey-stages>
          {s.stages.map((g) => (
            <li key={g.id} className={`rounded-lg px-2 py-1 text-[13px] ${g.state === "now" ? "bg-select-bg" : "bg-fill"}`} data-journey-stage={g.state}>
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">
                {g.state === "done" ? <CheckIcon size={13} /> : null}
                {g.name}
                <span className="font-normal text-ink-2">· {g.state === "done" ? "Done" : g.state === "now" ? (g.startedAt ? "Now" : "Next") : "Later"}</span>
              </p>
              {(g.startedAt || g.finishedAt) && (
                <p className="text-ink-2">
                  {g.startedAt ? `Started ${fmtShort(g.startedAt)}` : g.migrated ? "Recorded before stages existed" : ""}
                  {g.finishedAt ? ` · finished ${fmtShort(g.finishedAt)}` : ""}
                  {g.durationMs !== null && g.startedAt ? ` · ${spanText(g.durationMs)}` : ""}
                  {g.by ? ` · ${g.by}` : ""}
                </p>
              )}
              {g.summary && <p className="text-ink">{g.summary}</p>}
            </li>
          ))}
        </ol>
      )}

      {(s.holds.length > 0 || s.problems.length > 0 || s.attempts.length > 0) && (
        <ul className="ml-1 flex min-w-0 flex-col gap-1 border-l-2 border-line pl-3" aria-label="Holds, problems and attempts">
          {s.holds.map((h) => (
            <li key={h.id} className={`px-2 py-1 text-[13px] ${h.resumedAt ? "rounded-lg bg-fill" : "hold-card pl-4"}`} data-sub="hold">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                <span className="text-hold-fg"><PauseIcon size={13} /></span>
                On hold: {h.reason}
                <span className="font-normal">· {h.days} business day{h.days === 1 ? "" : "s"}</span>
                {h.simulated && <span className="chip c-act h-5 text-[11px]">Simulated</span>}
              </p>
              <p className="break-words text-ink" data-hold-started>{journeyHoldStarted({ reason: h.reason, note: h.note, raisedBy: h.raisedBy, raisedAt: h.raisedAt })}</p>
              {(h.transfers ?? []).map((x, i) => <p key={i} className="break-words text-ink" data-hold-transferred>{journeyHoldTransferred(x)}</p>)}
              {h.resumedAt
                ? <p className="break-words text-ink" data-hold-resumed>{journeyHoldResumed({ raisedAt: h.raisedAt, resumedAt: h.resumedAt, resumedBy: h.resumedBy, resumeNote: h.resumeNote })}</p>
                : <p className="text-ink-2">Still on hold (<LiveSince since={h.raisedAt.toISOString()} now={now.toISOString()} />). The TAT clock keeps running.</p>}
            </li>
          ))}
          {s.problems.map((p) => (
            <li key={p.id} className={`rounded-lg px-2 py-1 text-[13px] ${p.resolvedAt ? "bg-fill" : "bg-bad-bg text-bad-fg"}`} data-sub="problem">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                <AlertIcon size={13} /> Problem: {p.reason}
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
            <li key={a.id} className="rounded-lg bg-fill px-2 py-1 text-[13px]" data-sub="attempt">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                {a.result === "DONE" ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
                Attempt on {fmtDate(a.date)}: {a.result === "DONE" ? "Done" : `Not processed (${a.reason ?? "no reason"})`}
                {a.simulated && <span className="chip c-act h-5 text-[11px]">Simulated</span>}
              </p>
              <p className="text-ink-2">by {a.by}{a.note ? ` · ${a.note}` : ""}</p>
            </li>
          ))}
        </ul>
      )}

      {s.events.length > 0 && (
        <details className="group/d">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[13px] font-semibold text-navy sm:min-h-8">
            <ChevronRightIcon size={15} className="transition-transform group-open/d:rotate-90 motion-reduce:transition-none" /> Details ({s.events.length})
          </summary>
          <Events events={s.events} />
        </details>
      )}
    </li>
  );
}

function Events({ events }: { events: { at: Date; text: string; simulated: boolean }[] }) {
  return (
    <ol className="mb-2 flex flex-col gap-1 pl-5">
      {events.map((e, i) => (
        <li key={i} className="text-[13px]">
          <span className="text-ink">{undoubleRole(e.text)}</span>{" "}
          <span className="whitespace-nowrap text-ink-2">{fmtShort(e.at)}</span>
          {e.simulated && <span className="chip c-act ml-1.5 h-5 text-[11px]">Simulated</span>}
        </li>
      ))}
    </ol>
  );
}

function docItems(j: Journey, liveCodes: string[]): DocItem[] {
  return j.docs
    .filter((d) => !d.txnCode || liveCodes.includes(d.txnCode))
    .map((d) => ({
      id: d.id, documentId: d.documentId, label: d.label, original: d.originality === "ORIGINAL",
      txnName: d.txnCode ? txnName(d.txnCode, d.txnName ?? undefined) : null,
      holder: undoubleRole(d.holder), place: undoubleRole(d.place), sinceText: fmtShort(d.since),
      trail: d.trail.map((m) => ({ id: m.id, label: m.label, when: fmtShort(m.at), by: m.by, place: m.place ? undoubleRole(m.place) : null, ack: m.acknowledgedBy, remarks: m.remarks, simulated: m.simulated })),
      periods: d.periods.map((p) => ({ holder: undoubleRole(p.holder), place: p.place ? undoubleRole(p.place) : null, from: fmtShort(p.from), to: p.to ? fmtShort(p.to) : null, held: spanText(p.ms) })),
    }));
}
