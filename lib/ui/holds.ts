/**
 * The words of a hold, in one place, so every screen says the same thing (Loan File banner, Check
 * documents, the DP job, Open items, rows, the Resume form and the Journey). Pure: the server and
 * the browser use the same text.
 *
 * Summary lines, in this order:
 *   "On hold: {reason}"
 *   the remarks, in full, as typed (or "No details were written." for older holds without remarks)
 *   "Put on hold by {name} · {date and time PHT} · {n days / hours} ago"
 *   "To continue: press Resume and write what changed"
 */
import { z } from "zod";
import { fmtDateTime } from "@/lib/time";

/**
 * THE remark limits (one place): Put on hold remarks, Resume remarks, "Add details", the DP's
 * Decline and Return to LA findings. Trimmed; the server enforces both ends with the same message.
 */
export const REMARKS_MIN = 5;
export const REMARKS_MAX = 500;
/** The counter under a remarks box turns amber from here. */
export const REMARKS_WARN = 450;
export const REMARKS_HELP = `At least ${REMARKS_MIN} characters, up to ${REMARKS_MAX}.`;
export const REMARKS_LIMIT_MESSAGE = `Write ${REMARKS_MIN} to ${REMARKS_MAX} characters.`;
/** Kept names (older imports). */
export const HOLD_REMARKS_MIN = REMARKS_MIN;
export const HOLD_REMARKS_MAX = REMARKS_MAX;
export const RESUME_REMARKS_MIN = REMARKS_MIN;

/** Any remarks box with the shared limits ("Write 5 to 500 characters." for too short and too long). */
export const remarksSchema = z.string({ message: REMARKS_LIMIT_MESSAGE }).trim()
  .min(REMARKS_MIN, REMARKS_LIMIT_MESSAGE)
  .max(REMARKS_MAX, REMARKS_LIMIT_MESSAGE);
/** Put on hold and Add details: always required (not only for "Other"). */
export const holdRemarksSchema = remarksSchema;
/** Resume: what changed. */
export const resumeRemarksSchema = remarksSchema;

/** The counter state of a remarks box: the length typed, amber from 450, Save allowed only from 5 to 500 (trimmed). */
export function remarksCounter(value: string): { count: number; warn: boolean; over: boolean; ok: boolean } {
  const n = value.trim().length;
  return { count: n, warn: n >= REMARKS_WARN, over: n > REMARKS_MAX, ok: n >= REMARKS_MIN && n <= REMARKS_MAX };
}

/** The hold's reason as it was when the hold started (the stored copy), else the list's current name. */
export const holdReasonName = (h: { reasonName?: string | null; reason: { name: string } }) => h.reasonName || h.reason.name;

/** The refusal on a held transaction (screen and server). */
/**
 * The refusal on a held transaction (screen and server): who put it on hold, since when, and who can
 * resume it (the hold owner; after a transfer that is someone else). A hold without an owner can be
 * resumed by nobody until a supervisor or Admin transfers it.
 */
export function lockedMessage(raisedBy: string, since: Date, owner: string | null = raisedBy): string {
  return `Locked: on hold by ${raisedBy} since ${fmtDateTime(since)}. ${owner ? `Only ${owner} can resume.` : NO_OWNER}`;
}
/** Finance actions refused on a held transaction (approve, release, top-up, carry-over, request). */
export function financeLockedMessage(raisedBy: string, since: Date): string {
  return `Locked: on hold by ${raisedBy} since ${fmtDateTime(since)}.`;
}
export const NO_OWNER = "Nobody can resume it until a supervisor or Admin transfers the hold.";
/** For people who cannot transfer it: who must resume it, and what to do if they are away. */
export const needsResumeBy = (owner: string | null) =>
  owner ? `Needs to be resumed by ${owner}. Ask your supervisor if ${owner} is away.` : `${NO_OWNER} Ask your supervisor.`;
/** Hold lines in the Journey and audit: "Hold transferred from A to B by C · remarks · date and time". */
export function journeyHoldTransferred(t: { fromLabel: string; toLabel: string; byLabel: string; note: string; at: Date }): string {
  return `Hold transferred from ${t.fromLabel} to ${t.toLabel} by ${t.byLabel} · ${t.note} · ${fmtDateTime(t.at)}`;
}
/** The Resume refusal for anyone but the holder (screen and server). */
export const onlyHolderMessage = (holder: string) => `Only ${holder} can resume this.`;

/** Only the hold owner may resume it (Admin and supervisors included: they can transfer, never resume). */
export function mayResumeHold(h: { ownerId: string | null; resumedAt?: Date | null }, user: { id: string }): boolean {
  return !h.resumedAt && !!h.ownerId && h.ownerId === user.id;
}

export const NO_DETAILS = "No details were written.";
export const TO_CONTINUE = "To continue: press Resume and write what changed";
/** The same line for someone who cannot resume it. */
export const TO_CONTINUE_OTHERS = "To continue: the person doing the work presses Resume and writes what changed";
export const CLOCK_NOTE = "The TAT clock keeps running";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "2 days", "5 hours", "12 minutes", "less than a minute": calendar time between two moments. */
export function durationText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "less than a minute";
  if (min < 60) return plural(min, "minute");
  const h = Math.floor(min / 60);
  if (h < 24) return plural(h, "hour");
  return plural(Math.floor(h / 24), "day");
}

/** "3 hours ago", "1 day ago", "just now". */
export function agoText(since: Date, now: Date = new Date()): string {
  const ms = now.getTime() - since.getTime();
  return ms < 60_000 ? "just now" : `${durationText(ms)} ago`;
}

export interface HoldFacts {
  reason: string;
  note: string;
  raisedBy: string;
  raisedAt: Date;
}

export interface HoldSummaryText {
  title: string;
  /** The remarks as typed, or null when none were written (older holds). */
  remarks: string | null;
  byLine: string;
  toContinue: string;
}

export function holdSummaryText(h: HoldFacts, now: Date = new Date()): HoldSummaryText {
  const remarks = h.note.trim() ? h.note : null;
  return {
    title: `On hold: ${h.reason}`,
    remarks,
    byLine: `Put on hold by ${h.raisedBy} · ${fmtDateTime(h.raisedAt)} · ${agoText(h.raisedAt, now)}`,
    toContinue: TO_CONTINUE,
  };
}

/** The one short line under a held transaction's name: "On hold: Waiting on borrower · 2 days". */
export function holdRowLine(reason: string, days: number): string {
  return `On hold: ${reason} · ${plural(Math.max(1, days), "day")}`;
}

/** The first line of the remarks (Open items card), or the fallback when there are none. */
export function firstLine(note: string): string {
  const line = note.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return line || NO_DETAILS;
}

/**
 * "Add details" on an older hold without remarks: only the person who put it on hold (holder only).
 * The server checks the same rule (lib/services/holds.ts addHoldDetails).
 */
export function mayAddDetails(h: { note: string; ownerId: string | null; resumedAt?: Date | null }, user: { id: string }): boolean {
  if (h.note.trim()) return false;
  return mayResumeHold(h, user);
}

/** Journey line for the start of a hold: "Put on hold · Waiting on borrower · Signed page · by Ana Cruz · Nov 7, 2026, 9:12 AM PHT". */
export function journeyHoldStarted(h: HoldFacts): string {
  return ["Put on hold", h.reason, h.note.trim() || NO_DETAILS, `by ${h.raisedBy}`, fmtDateTime(h.raisedAt)].join(" · ");
}

/** Journey line for the end: "Resumed · Borrower signed · by Ana Cruz · Nov 8, 2026, 10:00 AM PHT · was on hold for 1 day". */
export function journeyHoldResumed(h: { raisedAt: Date; resumedAt: Date; resumedBy: string | null; resumeNote: string }): string {
  return ["Resumed", h.resumeNote.trim() || NO_DETAILS, `by ${h.resumedBy ?? "System"}`, fmtDateTime(h.resumedAt), `was on hold for ${durationText(h.resumedAt.getTime() - h.raisedAt.getTime())}`].join(" · ");
}
