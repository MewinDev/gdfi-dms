/**
 * How often a loan is checked against MyLoans (fallback polling, when there is no changed-since
 * feed). Pure. Only active loans: closed and cancelled ones are never checked.
 *   A  work in progress (sent or in process, cash out, an open review item): every 60 minutes
 *   B  not yet sent (checking papers, ready to send): every 4 hours
 *   C  finished steps but not closed (vault, DigiCur, pull-out, QA): once a day
 */
export type Tier = "A" | "B" | "C";
export interface TierMinutes { A: number; B: number; C: number }
export const DEFAULT_TIER_MINUTES: TierMinutes = { A: 60, B: 240, C: 1440 };

const NEVER = ["Closed", "Archived", "Disposed", "Cancelled in MyLoans"];
const WORK = ["Assigned to DP", "In process", "Awaiting LA acceptance"];
const NOT_SENT = ["Opened", "For checklist", "No DP assignment required"];

export function tierOf(stage: string, o: { cancelled?: boolean; closed?: boolean; openReview?: boolean; cashOut?: boolean } = {}): Tier | null {
  if (o.cancelled || o.closed || NEVER.includes(stage)) return null;
  if (o.openReview || o.cashOut || WORK.includes(stage)) return "A";
  if (NOT_SENT.includes(stage)) return "B";
  return "C";
}

export const nextCheckAt = (now: Date, tier: Tier | null, m: TierMinutes = DEFAULT_TIER_MINUTES): Date | null =>
  tier ? new Date(now.getTime() + m[tier] * 60_000) : null;

/** The pause between calls with random jitter: between the pause and one and a half times it. */
export const jitteredPause = (pauseMs: number, rnd: number = Math.random()) => Math.round(pauseMs + Math.min(Math.max(rnd, 0), 1) * pauseMs * 0.5);

/** Adaptive slowdown: halve on trouble (429, timeouts, slow answers); grow back a quarter when healthy. */
export function nextCap(cap: number, max: number, trouble: boolean): number {
  if (trouble) return Math.max(1, Math.floor(cap / 2));
  return Math.min(max, cap + Math.max(1, Math.ceil(max / 4)));
}
