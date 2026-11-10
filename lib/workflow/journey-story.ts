/**
 * Journey v2: the same stored records read three ways, so the views always agree.
 *   - "Where it is now": one line per place (transactions in the same place and state share a line).
 *   - Story: one plain sentence per real event, newest first, grouped by Philippine day. The same
 *     action by the same person in the same minute on several transactions is one line; automatic
 *     (System) steps are one line at the bottom of their day; holds, problems, returns, declines and
 *     missing paper are flagged.
 *   - By document: per transaction, the same milestones in order (Opened, Papers checked, With the
 *     processor, In process, Back to the branch, Done) with done, now and later, time and who, and
 *     markers for what held it up.
 * Pure and read only: it arranges what buildJourney and the loader already read. Nothing is written,
 * nothing new is recorded, and the TAT clock is the same one (it never pauses).
 */
import { APP_TIMEZONE, businessDate } from "@/lib/time";
import { txnName } from "@/lib/ui/plain";
import { clockText } from "@/lib/ui/txn-status";
import {
  fundsWords, undoubleRole,
  type EventRec, type JStep, type JTxn, type Journey, type JourneyInput, type TxnRec,
} from "./build-journey";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What held it up: shown with a word and an icon (never colour alone). */
export type Flag = "return" | "decline" | "hold" | "problem" | "missing";
export const FLAG_WORD: Record<Flag, string> = { return: "Returned", decline: "Declined", hold: "On hold", problem: "Problem", missing: "Missing paper" };

export interface TxnTag { code: string; name: string }

export interface StoryLine {
  key: string;
  at: Date;
  /** One plain sentence in the active voice, no full stop ("DP 1 returned Notary: ... (Round 1)"). */
  sentence: string;
  /** Who did it; empty for things nobody did by hand. */
  who: string;
  txns: TxnTag[];
  flag: Flag | null;
  simulated: boolean;
  /** The one line for the automatic steps of a day: how many (they are listed in the Full log). */
  system?: { count: number };
}

export interface StoryDay {
  date: string;
  /** "Today", "Yesterday", else "Nov 9". */
  label: string;
  /** The date row: "Today · Tue, Nov 10, 2026", "Yesterday · Mon, Nov 9, 2026", "Fri, Nov 7, 2026". */
  heading: string;
  lines: StoryLine[];
}

/** The one status pill of a "Where it is now" line. */
export type WhereKind = "now" | "hold" | "problem" | "returned" | "done";
export const WHERE_WORD: Record<WhereKind, string> = { now: "Now", hold: "On hold", problem: "Problem", returned: "Returned", done: "Done" };

export interface WhereLine {
  key: string;
  /** "All 4 transactions", "Notary and EDST", "Notary". */
  label: string;
  codes: string[];
  kind: WhereKind;
  /** "With LA 1", "Waiting on Grace Tan · On hold: waiting for the client's papers". */
  text: string;
  since: Date | null;
  /** "7 h 30 min" since then (null when done). */
  forText: string | null;
  /** "Day 1 of 2", "Due today", "+1 day late" (grey; red when late). */
  note: { text: string; late: boolean } | null;
}

export type MilestoneState = "done" | "now" | "later";
export interface Marker { kind: Flag | "funds"; word: string; text: string; round: number | null; open: boolean }
export interface Milestone {
  key: "opened" | "checked" | "processor" | "process" | "back" | "done";
  label: string;
  state: MilestoneState;
  /** When it was done (done milestones). */
  at: Date | null;
  who: string | null;
  /** The current milestone: since when, and for how long. */
  since: Date | null;
  forText: string | null;
  /** Time spent reaching it (from the milestone before); the thin bar under it. */
  durationMs: number | null;
  /** One grey line: "To LA 2", "Stage 2 of 3: Drop at the LTO", "Entered in EDST". */
  sub: string | null;
  markers: Marker[];
  /** The same text the Full log has for it (newest first). */
  details: { at: Date; text: string }[];
}
export interface DocColumn {
  id: string; code: string; name: string;
  kind: WhereKind;
  /** Something blocks it (hold, problem, returned) or it is late. */
  attention: boolean;
  note: { text: string; late: boolean } | null;
  milestones: Milestone[];
}

export interface JourneyStory {
  where: WhereLine[];
  /** Newest first; each day's automatic-steps line is last of its day (see storyDays). */
  lines: StoryLine[];
  columns: DocColumn[];
  /** How many flagged lines of each kind. */
  counts: Record<Flag, number>;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "A", "A and B", "A, B and C". */
export function listWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "under 1 min", "45 min", "7 h 30 min", "2 d 3 h". */
export function spanText(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "under 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" });
const fullDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, weekday: "short", month: "short", day: "numeric", year: "numeric" });
/** "11:54 PM" (PHT). */
export const timeText = (d: Date) => timeFmt.format(d).replace(/ /g, " ");

/** "Today", "Yesterday", else "Nov 9" (Philippine calendar days). */
export function dayLabel(date: string, now: Date): string {
  if (date === businessDate(now)) return "Today";
  if (date === businessDate(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return dayFmt.format(new Date(`${date}T12:00:00+08:00`));
}

/** The date row of a day: the word (Today, Yesterday) with the full date, or the full date alone. */
export function dayHeading(date: string, now: Date): string {
  const full = fullDayFmt.format(new Date(`${date}T12:00:00+08:00`));
  const word = dayLabel(date, now);
  return word === "Today" || word === "Yesterday" ? `${word} · ${full}` : full;
}

const actor = (label: string) => label.replace(/ \(Simulated\)$/, "").trim();
/** A stored sentence as a Story line: the role word once, no full stop at the end. */
const clean = (s: string) => undoubleRole(s).trim().replace(/\s*\.$/, "");
const tagOf = (t: Pick<TxnRec, "code" | "name">): TxnTag => ({ code: t.code, name: txnName(t.code, t.name) });

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

/** Kept as their own records (sends, decisions, holds, problems, attempts): their audit rows would say it twice. */
const FROM_RECORDS = new Set([
  "assigned_to_dp", "dp_assignment_accepted", "dp_assignment_declined", "dp_assignment_returned", "job_returned_to_la", "sent_job_pulled_back",
  "hold_started", "hold_ended", "hold_transferred", "problem_raised", "problem_resolved", "attempt_logged",
  "dp_processing_recorded", "package_forwarded", "transaction_completed", "papers_received_back",
]);
/** Not part of the loan's story (still in the Full log where recorded). */
const NOT_STORY = new Set(["signed_in", "signed_out", "stage_started"]);
/** Automatic steps: one line per day. */
const SYSTEM_ACTIONS = new Set(["classification_applied", "mortgage_determined", "document_ids_generated", "dp_notified", "stage_changed", "source_refresh_failed"]);

interface Raw {
  /** Same tpl, who, minute, flag and extra on several transactions: one line. Null: never merged. */
  tpl: string | null;
  at: Date;
  who: string;
  txn: TxnTag | null;
  flag: Flag | null;
  simulated: boolean;
  extra: string;
  render: (names: string, count: number) => string;
}

/** Round of each send (1, 2, ...): one more after every decline or return (the app's rounds). */
function roundsOf(t: TxnRec): Map<string, number> {
  const out = new Map<string, number>();
  let r = 1;
  for (const a of [...t.assignments].sort((x, y) => x.endorsedAt.getTime() - y.endorsedAt.getTime())) {
    out.set(a.id, r);
    if (a.status === "DECLINED" || (a.status === "WITHDRAWN" && a.returnedAt)) r += 1;
  }
  return out;
}
const findingsOf = (f: string | null | undefined) => (f && f.trim() ? f.trim().replace(/\s*\.$/, "") : "no findings were written");

function rawLines(input: JourneyInput): { raw: Raw[]; system: EventRec[] } {
  const raw: Raw[] = [];
  const system: EventRec[] = [];
  const byId = new Map(input.transactions.map((t) => [t.id, t]));

  for (const e of input.events) {
    if (FROM_RECORDS.has(e.action) || NOT_STORY.has(e.action)) continue;
    const t = e.txnId ? byId.get(e.txnId) : undefined;
    const txn = t ? tagOf(t) : null;
    const who = actor(e.by);
    const base = { at: e.at, who, txn, simulated: e.simulated, extra: "" };
    if (e.action === "transactions_generated") {
      const made = input.transactions.filter((x) => Math.abs(x.createdAt.getTime() - e.at.getTime()) < 120_000).map(tagOf);
      const names = made.map((x) => x.name);
      raw.push({ ...base, tpl: null, txn: null, who: "", flag: null, render: () => (names.length ? `${names.length} transaction${names.length === 1 ? "" : "s"} created: ${listWords(names)}` : clean(e.text)) });
      continue;
    }
    if (e.action === "exception_resolved" && /missing paper/i.test(e.text)) {
      raw.push({ ...base, tpl: "missing-in", who: "", flag: null, render: (n) => `Missing paper received${n ? ` for ${n}` : ""}` });
      continue;
    }
    if (who === "System" || SYSTEM_ACTIONS.has(e.action)) { system.push(e); continue; }
    if (e.action === "checklist_saved") {
      // Saving part of the papers is in the Full log; the Story says when they were all checked.
      if (!/checked all the/i.test(e.text)) continue;
      raw.push({ ...base, tpl: "checked", flag: null, render: (n) => `${who} checked the papers for ${n}` });
      continue;
    }
    if (e.action === "paper_verified") {
      raw.push({ ...base, tpl: "verified", flag: null, render: (n, c) => `${who} checked ${c} paper${c === 1 ? "" : "s"} back for ${n}` });
      continue;
    }
    const missing = e.action === "exception_raised" && /missing paper/i.test(e.text);
    raw.push({ ...base, tpl: null, flag: missing ? "missing" : null, render: () => clean(e.text) });
  }

  for (const t of input.transactions) {
    const txn = tagOf(t);
    const rounds = roundsOf(t);
    for (const a of t.assignments) {
      const r = rounds.get(a.id) ?? 1;
      const dp = a.second ? `${a.dp.name} and ${a.second.name}` : a.dp.name;
      const sender = a.assignedBy.name;
      raw.push({ tpl: "sent", at: a.endorsedAt, who: sender, txn, flag: null, simulated: false, extra: `${dp}|${r}`, render: (n) => `${sender} sent ${n} to ${dp}${r > 1 ? ` again (Round ${r})` : ""}` });
      if (a.status === "DECLINED") {
        raw.push({ tpl: null, at: a.decidedAt ?? a.closedAt ?? a.endorsedAt, who: a.dp.name, txn, flag: "decline", simulated: false, extra: "", render: () => `${a.dp.name} declined ${txn.name}: ${findingsOf(a.findings)} (Round ${r})` });
      } else if (a.decidedAt) {
        raw.push({ tpl: "accepted", at: a.decidedAt, who: a.dp.name, txn, flag: null, simulated: false, extra: "", render: (n) => `${a.dp.name} accepted ${n}` });
      }
      if (a.status === "PULLED_BACK") {
        raw.push({ tpl: "pulled", at: a.closedAt ?? a.endorsedAt, who: sender, txn, flag: null, simulated: false, extra: a.dp.name, render: (n) => `${sender} pulled ${n} back before ${a.dp.name} accepted` });
      }
      if (a.status === "WITHDRAWN" && a.returnedAt) {
        raw.push({ tpl: null, at: a.returnedAt, who: a.dp.name, txn, flag: "return", simulated: false, extra: "", render: () => `${a.dp.name} returned ${txn.name}: ${findingsOf(a.findings)} (Round ${r})` });
      }
      if (a.papersHandedAt) raw.push({ tpl: "handed", at: a.papersHandedAt, who: a.dp.name, txn, flag: null, simulated: false, extra: sender, render: (n) => `${a.dp.name} handed the ${n} papers back to ${sender}` });
      if (a.papersReceivedAt) {
        const by = a.papersReceivedBy ?? sender;
        raw.push({ tpl: "back-in", at: a.papersReceivedAt, who: by, txn, flag: null, simulated: false, extra: a.dp.name, render: (n) => `${by} received the ${n} papers back from ${a.dp.name}` });
      }
      if (a.processedAt) raw.push({ tpl: "processed", at: a.processedAt, who: a.dp.name, txn, flag: null, simulated: false, extra: "", render: (n) => `${dp} finished the work on ${n}` });
      if (a.forwardedAt) {
        const to = a.receivingLa?.name ?? "the branch";
        raw.push({ tpl: "forwarded", at: a.forwardedAt, who: a.dp.name, txn, flag: null, simulated: false, extra: to, render: (n) => `${a.dp.name} forwarded ${n} to ${to}` });
      }
    }
    if (t.completedAt && t.status === "COMPLETED") raw.push({ tpl: "done", at: t.completedAt, who: "", txn, flag: null, simulated: false, extra: "", render: (n) => `${n} done` });
    for (const h of t.holds) {
      raw.push({ tpl: null, at: h.raisedAt, who: h.raisedBy, txn, flag: "hold", simulated: h.simulated, extra: "", render: () => `${h.raisedBy} put ${txn.name} on hold: ${h.reason}${h.note.trim() ? ` (${h.note.trim()})` : ""}` });
      for (const x of h.transfers ?? []) {
        raw.push({ tpl: null, at: x.at, who: x.byLabel, txn, flag: null, simulated: h.simulated, extra: "", render: () => `${x.byLabel} moved the hold on ${txn.name} from ${x.fromLabel} to ${x.toLabel}${x.note ? ` (${x.note})` : ""}` });
      }
      if (h.resumedAt) {
        const by = h.resumedBy && h.resumedBy !== "System" ? h.resumedBy : null;
        raw.push({ tpl: null, at: h.resumedAt, who: by ?? "", txn, flag: null, simulated: h.simulated, extra: "", render: () => (by ? `${by} resumed ${txn.name}${h.resumeNote.trim() ? `: ${h.resumeNote.trim()}` : ""}` : `The hold on ${txn.name} ended when the work was finished`) });
      }
    }
    for (const p of t.problems) {
      raw.push({ tpl: null, at: p.raisedAt, who: p.raisedBy, txn, flag: "problem", simulated: p.simulated, extra: "", render: () => `${p.raisedBy} raised a problem on ${txn.name}: ${p.reason}${p.note.trim() ? ` (${p.note.trim()})` : ""}` });
      if (p.resolvedAt) {
        const by = p.resolvedBy ?? "Someone";
        raw.push({ tpl: null, at: p.resolvedAt, who: p.resolvedBy ?? "", txn, flag: null, simulated: p.simulated, extra: "", render: () => `${by} solved the problem on ${txn.name}: ${p.reason}${p.resolutionNote.trim() ? ` (${p.resolutionNote.trim()})` : ""}` });
      }
    }
    for (const x of t.attempts) {
      raw.push({ tpl: null, at: x.createdAt, who: x.by, txn, flag: null, simulated: x.simulated, extra: "", render: () => `${x.by} logged an attempt on ${txn.name}: ${x.result === "DONE" ? "done" : `not processed (${x.reason ?? "no reason"})`}` });
    }
  }
  return { raw, system };
}

/** Story lines, newest first: same-minute identical actions merged, no sentence said twice. */
export function storyLines(input: JourneyInput): StoryLine[] {
  const { raw, system } = rawLines(input);
  // Merge: the same action by the same person in the same minute, on several transactions.
  const groups = new Map<string, { first: Raw; idx: number; txns: TxnTag[]; count: number; sim: boolean }>();
  raw.forEach((r, idx) => {
    const key = r.tpl === null ? `u${idx}` : `${r.tpl}|${r.who}|${Math.floor(r.at.getTime() / 60_000)}|${r.flag}|${r.extra}`;
    const g = groups.get(key);
    if (!g) { groups.set(key, { first: r, idx, txns: r.txn ? [r.txn] : [], count: 1, sim: r.simulated }); return; }
    g.count += 1;
    g.sim ||= r.simulated;
    if (r.txn && !g.txns.some((x) => x.code === r.txn!.code)) g.txns.push(r.txn);
  });
  const seen = new Set<string>();
  const lines: (StoryLine & { idx: number })[] = [];
  for (const [key, g] of groups) {
    const sentence = g.first.render(listWords(g.txns.map((x) => x.name)), g.count);
    const once = `${Math.floor(g.first.at.getTime() / 60_000)}|${sentence}`;
    if (seen.has(once)) continue;
    seen.add(once);
    lines.push({ key, at: g.first.at, sentence, who: g.first.who, txns: g.txns, flag: g.first.flag, simulated: g.sim, idx: g.idx });
  }

  // Automatic steps: one line per Philippine day.
  const openDay = input.loan.openedAt ? businessDate(input.loan.openedAt) : null;
  const sysByDay = new Map<string, EventRec[]>();
  for (const e of system) sysByDay.set(businessDate(e.at), [...(sysByDay.get(businessDate(e.at)) ?? []), e]);
  for (const [day, evs] of sysByDay) {
    const sorted = [...evs].sort((a, b) => a.at.getTime() - b.at.getTime());
    lines.push({
      key: `system-${day}`, at: sorted[0].at, idx: -1,
      sentence: day === openDay ? "Loan opened and checked automatically" : "Checked automatically",
      who: "", txns: [], flag: null, simulated: evs.some((e) => e.simulated),
      system: { count: evs.length },
    });
  }
  lines.sort((a, b) => b.at.getTime() - a.at.getTime() || b.idx - a.idx);
  return lines.map((l) => ({ key: l.key, at: l.at, sentence: l.sentence, who: l.who, txns: l.txns, flag: l.flag, simulated: l.simulated, ...(l.system ? { system: l.system } : {}) }));
}

/** Lines grouped under their Philippine day, newest day first; the automatic-steps line ends its day. */
export function storyDays(lines: StoryLine[], now: Date): StoryDay[] {
  const days = new Map<string, StoryLine[]>();
  for (const l of lines) {
    const d = businessDate(l.at);
    days.set(d, [...(days.get(d) ?? []), l]);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, ls]) => ({ date, label: dayLabel(date, now), heading: dayHeading(date, now), lines: [...ls.filter((l) => !l.system), ...ls.filter((l) => l.system)] }));
}

// ---------------------------------------------------------------------------
// Where it is now
// ---------------------------------------------------------------------------

function whereKind(t: JTxn): WhereKind {
  if (t.done) return "done";
  if (t.state === "hold") return "hold";
  if (t.state === "problem") return "problem";
  if (t.status === "RETURNED") return "returned";
  return "now";
}

/** The most urgent of several day counts: late first, then due today, else the first. */
function urgent(notes: { name: string; note: WhereLine["note"] }[]): WhereLine["note"] {
  const withNote = notes.filter((n) => n.note);
  if (!withNote.length) return null;
  if (withNote.every((n) => n.note!.text === withNote[0].note!.text) && withNote.length === notes.length) return withNote[0].note;
  const pick = withNote.find((n) => n.note!.late) ?? withNote.find((n) => n.note!.text === "Due today") ?? withNote[0];
  return { text: notes.length > 1 ? `${pick.name}: ${pick.note!.text}` : pick.note!.text, late: pick.note!.late };
}

export function whereLines(j: Journey): WhereLine[] {
  const live = j.txns.filter((t) => t.state !== "na");
  const groups = new Map<string, JTxn[]>();
  for (const t of live) {
    const kind = whereKind(t);
    const text = t.owner?.text ?? "Done";
    const since = kind === "done" ? null : t.owner?.since ?? null;
    const key = `${kind}|${text}|${since ? Math.floor(since.getTime() / 60_000) : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].map(([key, ts]) => {
    const kind = whereKind(ts[0]);
    const since = kind === "done" ? null : ts.map((t) => t.owner?.since).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const names = ts.map((t) => txnName(t.code, t.name));
    return {
      key,
      label: ts.length === live.length && ts.length > 1 ? `All ${ts.length} transactions` : listWords(names),
      codes: ts.map((t) => t.code),
      kind,
      text: ts[0].owner?.text ?? "Done",
      since,
      forText: since ? spanText(j.now.getTime() - since.getTime()) : null,
      note: kind === "done" ? null : urgent(ts.map((t) => ({ name: txnName(t.code, t.name), note: clockText(t.tat) }))),
    };
  });
}

// ---------------------------------------------------------------------------
// By document: milestones per transaction
// ---------------------------------------------------------------------------

type StepKind = "CHECK" | "LA_DO" | "SEND" | "ACCEPT" | "PROCESS" | "FORWARD" | "RECEIVE";
const KIND_OF: Record<string, StepKind> = { "3.1": "CHECK", "3.3": "LA_DO", "3.6": "SEND", "4.1": "ACCEPT", "4.2": "PROCESS", "4.3": "PROCESS", "4.4": "PROCESS", "4.6": "FORWARD", "5.1": "RECEIVE" };

interface Def { key: Milestone["key"]; label: string; at: Date | null; who: string | null; sub: string | null; kinds: StepKind[] }

export function docColumns(input: JourneyInput, j: Journey): DocColumn[] {
  const steps = j.phases.flatMap((p) => p.steps);
  const loanSteps = j.phases.slice(0, 2).flatMap((p) => p.steps).filter((s) => !s.txnId);
  return input.transactions.filter((t) => t.status !== "CANCELLED").map((t) => {
    const jt = j.txns.find((x) => x.id === t.id)!;
    const mine = steps.filter((s) => s.txnId === t.id);
    const step = (k: StepKind) => mine.find((s) => KIND_OF[s.stepId] === k) ?? null;
    const sends = [...t.assignments].sort((a, b) => a.endorsedAt.getTime() - b.endorsedAt.getTime());
    const last = sends.filter((a) => a.status !== "PULLED_BACK").at(-1) ?? sends.at(-1) ?? null;
    const dpName = last ? (last.second ? `${last.dp.name} and ${last.second.name}` : last.dp.name) : null;
    const stages = last?.stages ?? [];
    const hasStages = t.requiresDp && stages.length > 0;
    const check = step("CHECK");

    const defs: Def[] = [
      { key: "opened", label: "Opened", at: t.createdAt, who: input.loan.openedBy.name, sub: null, kinds: [] },
      { key: "checked", label: "Papers checked", at: check?.end ?? null, who: check?.ownerName ?? null, sub: null, kinds: ["CHECK"] },
    ];
    let current: number;
    if (t.requiresDp) {
      const accepted = [...sends].reverse().find((a) => a.decidedAt && a.status !== "DECLINED")?.decidedAt ?? null;
      defs.push({ key: "processor", label: dpName ? `With the processor (${dpName})` : "With the processor", at: hasStages ? accepted : last?.processedAt ?? null, who: dpName, sub: null, kinds: hasStages ? ["SEND", "ACCEPT"] : ["SEND", "ACCEPT", "PROCESS"] });
      if (hasStages) {
        const doneN = stages.filter((s) => s.status === "DONE").length;
        const cur = stages.find((s) => s.status !== "DONE");
        defs.push({ key: "process", label: "In process", at: last?.processedAt ?? null, who: dpName, sub: cur ? `Stage ${doneN + 1} of ${stages.length}: ${cur.name}` : `All ${stages.length} stages done`, kinds: ["PROCESS"] });
      }
      defs.push({ key: "back", label: "Back to the branch", at: last?.forwardedAt ?? null, who: last?.dp.name ?? null, sub: last?.receivingLa ? `To ${last.receivingLa.name}` : null, kinds: ["FORWARD"] });
      defs.push({ key: "done", label: "Done", at: t.completedAt, who: last?.receivingLa?.name ?? null, sub: null, kinds: ["RECEIVE"] });
      const idx = (k: Milestone["key"]) => defs.findIndex((d) => d.key === k);
      current = t.status === "FOR_CHECKLIST" ? idx("checked")
        : ["READY", "RETURNED", "ASSIGNED"].includes(t.status) ? idx("processor")
          : t.status === "IN_PROCESS" ? (last?.processedAt ? idx("back") : hasStages ? idx("process") : idx("processor"))
            : t.status === "FORWARDED" ? idx("done")
              : defs.length;
    } else {
      defs.push({ key: "done", label: "Done", at: t.completedAt, who: step("LA_DO")?.ownerName ?? input.loan.openedBy.name, sub: t.code === "EDST" ? "Entered in EDST" : null, kinds: ["LA_DO"] });
      current = t.status === "FOR_CHECKLIST" ? 1 : t.status === "COMPLETED" ? defs.length : 2;
    }

    const now = j.now;
    const nowSince = jt.owner?.since ?? jt.openSegment?.start ?? null;
    const ms: Milestone[] = defs.map((d, i) => {
      const state: MilestoneState = i < current ? "done" : i === current ? "now" : "later";
      const prev = defs.slice(0, i).reverse().find((x) => x.at)?.at ?? null;
      const at = state === "done" ? d.at : null;
      const details = (d.key === "opened" ? loanSteps : d.kinds.flatMap((k) => mine.filter((s) => KIND_OF[s.stepId] === k)))
        .flatMap((s: JStep) => s.events.map((e) => ({ at: e.at, text: undoubleRole(e.text) })))
        .sort((a, b) => b.at.getTime() - a.at.getTime());
      return {
        key: d.key, label: d.label, state, at, who: state === "later" ? null : d.who,
        since: state === "now" ? nowSince : null,
        forText: state === "now" && nowSince ? spanText(now.getTime() - nowSince.getTime()) : null,
        durationMs: state === "done" && at && prev && at >= prev ? at.getTime() - prev.getTime() : null,
        sub: state === "later" ? null : d.sub,
        markers: [],
        details,
      };
    });

    // Markers on the milestone they affect: the one whose time span holds the moment it happened.
    const place = (at: Date, m: Marker) => {
      let target = ms.find((x, i) => x.state === "done" && x.at && at < x.at && i > 0) ?? ms.find((x) => x.state === "now") ?? ms.filter((x) => x.state === "done").at(-1) ?? ms[0];
      if (target.key === "opened" && ms.length > 1) target = ms[1];
      target.markers.push(m);
    };
    const rounds = roundsOf(t);
    for (const a of sends) {
      const r = rounds.get(a.id) ?? 1;
      if (a.status === "DECLINED") place(a.decidedAt ?? a.closedAt ?? a.endorsedAt, { kind: "decline", word: "Declined", text: findingsOf(a.findings), round: r, open: false });
      if (a.status === "WITHDRAWN" && a.returnedAt) place(a.returnedAt, { kind: "return", word: "Returned", text: findingsOf(a.findings), round: r, open: t.status === "RETURNED" && a === last });
    }
    for (const h of t.holds) place(h.raisedAt, { kind: "hold", word: "On hold", text: h.reason, round: null, open: !h.resumedAt });
    for (const p of t.problems) place(p.raisedAt, { kind: "problem", word: "Problem", text: p.reason, round: null, open: !p.resolvedAt });
    for (const e of input.events.filter((x) => x.txnId === t.id && x.action === "exception_raised" && /missing paper/i.test(x.text))) {
      place(e.at, { kind: "missing", word: "Missing paper", text: clean(/: ([^:]+)$/.exec(e.text)?.[1] ?? e.text), round: null, open: false });
    }
    for (const a of t.advances) place(a.requestedAt, { kind: "funds", word: "Funds", text: `${a.number}: ${fundsWords(a)}`, round: null, open: false });

    const kind = whereKind(jt);
    const note = jt.done ? null : clockText(jt.tat);
    return {
      id: t.id, code: t.code, name: txnName(t.code, t.name), kind,
      attention: kind === "hold" || kind === "problem" || kind === "returned" || !!note?.late,
      note, milestones: ms,
    };
  });
}

// ---------------------------------------------------------------------------
// All three
// ---------------------------------------------------------------------------

export function buildJourneyStory(input: JourneyInput, j: Journey): JourneyStory {
  const lines = storyLines(input);
  const counts: Record<Flag, number> = { return: 0, decline: 0, hold: 0, problem: 0, missing: 0 };
  for (const l of lines) if (l.flag) counts[l.flag] += 1;
  return { where: whereLines(j), lines, columns: docColumns(input, j), counts };
}

/** The Story's filter row: All · Needs attention (plus the transaction pills). There is no "Mine". */
export const STORY_FILTERS: [StoryShow, string][] = [["all", "All"], ["attention", "Needs attention"]];
export type StoryShow = "all" | "attention";
/** The filter from the address; anything else (an old ?show=mine) is All, without an error. */
export const storyShowOf = (raw: string | undefined): StoryShow => (raw === "attention" ? "attention" : "all");
