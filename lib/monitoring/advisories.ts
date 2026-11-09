/**
 * LTO advisories ("maintenance report"): the words and the small rules, in one place (pure, so the
 * server, the screens and the unit tests say the same thing). An advisory warns; it never blocks.
 */
import { z } from "zod";
import { elapsed } from "@/lib/time";
import { remarksSchema } from "@/lib/ui/holds";

export const ADVISORY_TYPES = ["SYSTEM_DOWN", "OFFICE_CLOSED", "LONG_QUEUE", "OTHER"] as const;
export type AdvisoryType = (typeof ADVISORY_TYPES)[number];
export const ADVISORY_LABEL: Record<AdvisoryType, string> = {
  SYSTEM_DOWN: "System down",
  OFFICE_CLOSED: "Office closed",
  LONG_QUEUE: "Long queue",
  OTHER: "Other",
};

/** Older than this, people who can resolve it see "Still active? Please confirm". */
export const ADVISORY_STALE_HOURS = 24;
export const STALE_PROMPT = "Still active? Please confirm";
/** How far back the start time may go when filing. */
export const ADVISORY_MAX_BACKDATE_DAYS = 7;

export const advisoryTypeSchema = z.enum(ADVISORY_TYPES, { message: "Pick what is wrong." });
export const fileAdvisorySchema = z.object({ type: advisoryTypeSchema, remarks: remarksSchema });
export const resolveAdvisorySchema = z.object({ remarks: remarksSchema });

export interface AdvisoryFacts {
  officeName: string;
  type: AdvisoryType;
  filedByLabel: string;
  filedById: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
}

/** "LTO Quezon City District Office: System down, reported by DP 1, 2 h ago". */
export function advisoryWarning(a: AdvisoryFacts, now: Date = new Date()): string {
  return `${a.officeName}: ${ADVISORY_LABEL[a.type]}, reported by ${a.filedByLabel}, ${elapsed(a.startedAt, now)} ago`;
}

/** Active for more than 24 hours. */
export const isStale = (a: Pick<AdvisoryFacts, "startedAt" | "resolvedAt">, now: Date = new Date()) =>
  !a.resolvedAt && now.getTime() - a.startedAt.getTime() > ADVISORY_STALE_HOURS * 3_600_000;

/** Who may resolve it: the person who filed it, and people with ltoreports:manage (Admin has it). */
export function mayResolveAdvisory(a: Pick<AdvisoryFacts, "filedById" | "resolvedAt">, user: { id: string; permissions: Set<string> }): boolean {
  if (a.resolvedAt) return false;
  return a.filedById === user.id || user.permissions.has("ltoreports:manage");
}

/** Who may edit the type and remarks: people with ltoreports:manage, and the filer while it is active. */
export const mayEditAdvisory = mayResolveAdvisory;

/**
 * The start time typed in the form ("YYYY-MM-DDTHH:mm", Philippine time), or now when blank. Not in
 * the future (a minute of clock difference allowed) and not more than 7 days back.
 */
export function parseStartedAt(raw: string | null | undefined, now: Date = new Date()): { ok: true; at: Date } | { ok: false; error: string } {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true, at: now };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return { ok: false, error: "Enter the start date and time." };
  const at = new Date(`${v.length === 16 ? `${v}:00` : v}+08:00`);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Enter the start date and time." };
  if (at.getTime() > now.getTime() + 60_000) return { ok: false, error: "The start time cannot be in the future." };
  if (now.getTime() - at.getTime() > ADVISORY_MAX_BACKDATE_DAYS * 86_400_000) return { ok: false, error: `The start time can be at most ${ADVISORY_MAX_BACKDATE_DAYS} days ago.` };
  return { ok: true, at };
}
