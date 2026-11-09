import { PERMISSION_DEFS, dependentsOf, permissionDef, permissionLabel, withRequirements } from "@/lib/auth/permissions";

/**
 * Pure helpers for the role editor (Settings > Roles): what a tick change does to the other ticks, and
 * what saving does to the people who have the role. Safe in the browser and on the server.
 */

/** In catalogue order. */
const ordered = (keys: Iterable<string>) => {
  const s = new Set(keys);
  return PERMISSION_DEFS.map((d) => d.key as string).filter((k) => s.has(k));
};
const words = (keys: string[]) => keys.map(permissionLabel).join(", ");

export interface TickResult {
  next: Set<string>;
  /** "Also ticked: See branches (needed by Change branches)." or null. */
  note: string | null;
}

/** Ticks or unticks one key; ticking adds what it needs, unticking removes what needs it. */
export function tick(current: Iterable<string>, key: string, on: boolean): TickResult {
  return tickMany(current, [key], on, permissionLabel(key));
}

/** Same for several keys at once ("Tick all in this group" / "Clear this group"). */
export function tickMany(current: Iterable<string>, keys: string[], on: boolean, what: string): TickResult {
  const cur = new Set(current);
  if (on) {
    const next = withRequirements([...cur, ...keys]);
    const extra = ordered([...next].filter((k) => !cur.has(k) && !keys.includes(k)));
    return { next, note: extra.length ? `Also ticked: ${words(extra)} (needed by ${what}).` : null };
  }
  const deps = ordered(new Set(keys.flatMap((k) => dependentsOf(k)))).filter((k) => cur.has(k) && !keys.includes(k));
  const next = new Set([...cur].filter((k) => !keys.includes(k) && !deps.includes(k)));
  return { next, note: deps.length ? `Also unticked: ${words(deps)} (${deps.length === 1 ? "it needs" : "they need"} ${what}).` : null };
}

export interface RoleImpact {
  users: number;
  added: string[];
  removed: string[];
  /** "3 users gain: Refresh a loan from MyLoans. 0 users lose anything." */
  text: string;
}

const people = (n: number) => `${n} ${n === 1 ? "user" : "users"}`;

/** What the people who have the role gain and lose when it is saved (before → after). */
export function roleImpact(before: Iterable<string>, after: Iterable<string>, activeUsers: number): RoleImpact {
  const b = new Set([...before].filter((k) => permissionDef(k)));
  const a = new Set([...after].filter((k) => permissionDef(k)));
  const added = ordered([...a].filter((k) => !b.has(k)));
  const removed = ordered([...b].filter((k) => !a.has(k)));
  // Nothing changes for anyone: "0 users gain anything" / "0 users lose anything" (the wording asked for).
  const verb = (one: string, many: string) => (activeUsers === 1 ? one : many);
  const gain = added.length && activeUsers ? `${people(activeUsers)} ${verb("gains", "gain")}: ${words(added)}.` : "0 users gain anything.";
  const lose = removed.length && activeUsers ? `${people(activeUsers)} ${verb("loses", "lose")}: ${words(removed)}.` : "0 users lose anything.";
  return { users: activeUsers, added, removed, text: `${gain} ${lose}` };
}

/** "Last changed Nov 9, 2026 by Admin: added Refresh a loan from MyLoans" (the text after the date and who). */
export function lastChangeWhat(entry: { summary: string; details: unknown }): string {
  const d = (entry.details ?? {}) as { added?: string[]; removed?: string[] };
  const parts = [
    d.added?.length ? `added ${words(ordered(d.added))}` : "",
    d.removed?.length ? `removed ${words(ordered(d.removed))}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : entry.summary;
}
