/**
 * Who may see and handle each funds type (pure, browser-safe). Cash advances and fund transfers are
 * handled by different people (confirmed by the users on 10 November 2026): every Finance step is two
 * ticks, one per type (lib/auth/permissions.ts). A request's type is its built-in funds type (the ids
 * the seed and the migrations give Cash advance and Fund transfer). A type the Admin adds later is not
 * split: it is seen and handled by everyone who has the step for either built-in type.
 * No rule here reads a role's name.
 */
import { PERMISSIONS as P, type Permission } from "@/lib/auth/permissions";

export type FundsStep = "view" | "approve" | "release" | "settle" | "editLines" | "changeType" | "print";
export type TypeKey = "CA" | "FT";
export const TYPE_KEYS: TypeKey[] = ["CA", "FT"];
/** The built-in types' ids (SEEDED_FUNDS_TYPES, migration 20261119090001_funds_types). */
export const TYPE_ID: Record<TypeKey, string> = { CA: "fundstype_ca", FT: "fundstype_ft" };

export const STEP_KEY: Record<TypeKey, Record<FundsStep, Permission>> = {
  CA: { view: P.FUNDS_CA_VIEW, approve: P.FUNDS_CA_APPROVE, release: P.FUNDS_CA_RELEASE, settle: P.FUNDS_CA_SETTLE, editLines: P.FUNDS_CA_EDIT_LINES, changeType: P.FUNDS_CA_CHANGE_TYPE, print: P.FUNDS_CA_PRINT },
  FT: { view: P.FUNDS_FT_VIEW, approve: P.FUNDS_FT_APPROVE, release: P.FUNDS_FT_RELEASE, settle: P.FUNDS_FT_SETTLE, editLines: P.FUNDS_FT_EDIT_LINES, changeType: P.FUNDS_FT_CHANGE_TYPE, print: P.FUNDS_FT_PRINT },
};
/** "cash advances", "fund transfers" (plain words for lines and the view-only note). */
export const TYPE_NOUN: Record<TypeKey, string> = { CA: "cash advances", FT: "fund transfers" };
export const TYPE_TITLE: Record<TypeKey, string> = { CA: "Cash advances", FT: "Fund transfers" };

/** Anything that names its type: a request, a top-up, a funds type row. */
export interface TypeRef { fundsTypeId?: string | null; id?: string }
/** CA or FT for a built-in type; null for a type added later. */
export function typeKeyOf(t: TypeRef | string | null | undefined): TypeKey | null {
  const id = typeof t === "string" ? t : t?.fundsTypeId ?? null;
  return id === TYPE_ID.CA ? "CA" : id === TYPE_ID.FT ? "FT" : null;
}

type Perms = { permissions: Set<string> } | Set<string> | Iterable<string>;
const setOf = (p: Perms): Set<string> => (p instanceof Set ? p : "permissions" in (p as object) ? (p as { permissions: Set<string> }).permissions : new Set(p as Iterable<string>));

/** The step's key(s) for a type: one key for CA or FT; both for a type added later (either is enough). */
export function stepKeys(step: FundsStep, type: TypeRef | string | null | undefined): Permission[] {
  const k = typeKeyOf(type);
  return k ? [STEP_KEY[k][step]] : [STEP_KEY.CA[step], STEP_KEY.FT[step]];
}
/** May this person do this step on a request of this type? */
export function canFunds(p: Perms, step: FundsStep, type: TypeRef | string | null | undefined): boolean {
  const s = setOf(p);
  return stepKeys(step, type).some((k) => s.has(k));
}
/** The built-in types this person may do a step for (["CA"], ["FT"], both or none). */
export function typesFor(p: Perms, step: FundsStep = "view"): TypeKey[] {
  const s = setOf(p);
  return TYPE_KEYS.filter((t) => s.has(STEP_KEY[t][step]));
}
/** May this person do a step for at least one type (the Funds page, the menu, Home)? */
export const canFundsAny = (p: Perms, step: FundsStep = "view") => typesFor(p, step).length > 0;
/** Every per-type key of a step (for "any type" page checks). */
export const anyStepKeys = (step: FundsStep): Permission[] => [STEP_KEY.CA[step], STEP_KEY.FT[step]];

/**
 * The Prisma filter on a funds request's type for what this person may see (lists, counts, totals, CSV,
 * search). Both types: no filter. One type: everything but the other built-in type (types added later
 * stay visible). None: nothing.
 */
export function typeWhere(p: Perms, step: FundsStep = "view"): { fundsTypeId?: { notIn: string[] }; id?: string } {
  const t = typesFor(p, step);
  if (t.length === 2) return {};
  if (t.length === 0) return { id: "__no_funds_type__" };
  return { fundsTypeId: { notIn: [TYPE_ID[t[0] === "CA" ? "FT" : "CA"]] } };
}

/** "Approving fund transfers needs the 'Approve fund transfers' tick on your role." */
export const stepVerb: Record<Exclude<FundsStep, "view">, string> = {
  approve: "Approving", release: "Releasing", settle: "Confirming returned cash and closing", editLines: "Changing the lines of", changeType: "Changing the type of", print: "Printing",
};
