/**
 * A person's effective permissions (D-008, D-009). Pure: no database, so the app, the tests and the
 * screens use the same rule.
 *
 *   effective = role ticks + GRANT overrides - DENY overrides, then the fund-type ticks:
 *   - a GRANT adds the key and what it requires (the matrix does the same when a tick is turned on);
 *   - a DENY removes the key and everything that needs it, and wins over the role and over a GRANT;
 *   - the per-type funds keys (view, approve, release, settle, edit lines, change type, print) count only
 *     for a type ticked on the person: Handles CA, Handles FT.
 * Nothing here reads a role's name or key.
 */
import { dependentsOf, permissionDef, RENAMED_PERMISSIONS, withRequirements, type Permission } from "./permissions";
import { STEP_KEY } from "@/lib/funds/access";

export type OverrideEffect = "GRANT" | "DENY";
export interface OverrideLike { key: string; effect: OverrideEffect }
export interface FundTypeTicks { handlesCa: boolean; handlesFt: boolean }

export const CA_KEYS: Permission[] = Object.values(STEP_KEY.CA);
export const FT_KEYS: Permission[] = Object.values(STEP_KEY.FT);

const known = (k: string): string | null => {
  const key = RENAMED_PERMISSIONS[k] ?? k;
  return permissionDef(key) ? key : null;
};

export function userPermissions(roleKeys: Iterable<string>, overrides: OverrideLike[], ticks: FundTypeTicks): Set<Permission> {
  const out = new Set<string>();
  for (const k of roleKeys) { const key = known(k); if (key) out.add(key); }
  const grants = overrides.filter((o) => o.effect === "GRANT").map((o) => known(o.key)).filter((k): k is string => !!k);
  for (const k of withRequirements(grants)) out.add(k);
  for (const o of overrides) {
    if (o.effect !== "DENY") continue;
    const key = known(o.key);
    if (!key) continue;
    out.delete(key);
    for (const d of dependentsOf(key)) out.delete(d);
  }
  if (!ticks.handlesCa) for (const k of CA_KEYS) out.delete(k);
  if (!ticks.handlesFt) for (const k of FT_KEYS) out.delete(k);
  return out as Set<Permission>;
}

/**
 * The fund-type ticks that keep a person's role working as before: a type is ticked when the role has any
 * of that type's keys. Used by the migration backfill, the role migration, the seed and the test kit;
 * a person added on the Users screen starts with neither (D-009).
 */
export function ticksFromRole(roleKeys: Iterable<string>): FundTypeTicks {
  const s = new Set([...roleKeys].map((k) => RENAMED_PERMISSIONS[k] ?? k));
  return { handlesCa: CA_KEYS.some((k) => s.has(k)), handlesFt: FT_KEYS.some((k) => s.has(k)) };
}

/** Where a key comes from on the user screen. */
export type KeySource = "INHERITED" | "GRANTED" | "DENIED" | "NONE";
export function keySource(key: string, roleKeys: Iterable<string>, overrides: OverrideLike[]): KeySource {
  const o = overrides.find((x) => (RENAMED_PERMISSIONS[x.key] ?? x.key) === key);
  if (o?.effect === "DENY") return "DENIED";
  if (o?.effect === "GRANT") return "GRANTED";
  return [...roleKeys].some((k) => (RENAMED_PERMISSIONS[k] ?? k) === key) ? "INHERITED" : "NONE";
}
