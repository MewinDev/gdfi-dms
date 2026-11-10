import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { bandRolesFor } from "@/lib/funds/rules";
import { STEP_KEY, TYPE_ID, TYPE_KEYS, TYPE_NOUN, stepKeys, type FundsStep, type TypeKey, type TypeRef } from "@/lib/funds/access";

/**
 * Who handles each funds type: the people told about a request (approve, release, settle) and the
 * "Who handles it" block and health line in Settings. Read from active people whose active role has the
 * type's tick; never from a role's name. When nobody has it, the people who can manage roles (Admin) are
 * told instead, so a request never waits unseen.
 */
type Db = Tx | typeof prisma;

/** Active people whose active role has the step's tick for this type (either built-in type's tick for a type added later). */
export async function handlerIds(db: Db, step: FundsStep, type: TypeRef | string | null | undefined): Promise<string[]> {
  const keys = stepKeys(step, type);
  const rows = await db.user.findMany({ where: { active: true, role: { active: true, permissions: { hasSome: keys } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The people who can manage roles (Admin): told when nobody can handle a step of a type. */
export async function roleManagerIds(db: Db): Promise<string[]> {
  const rows = await db.user.findMany({ where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.ROLES_MANAGE } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The step's handlers for the type, or the Admins when there are none. */
export async function handlersOrAdmins(db: Db, step: FundsStep, type: TypeRef | string | null | undefined): Promise<string[]> {
  const ids = await handlerIds(db, step, type);
  return ids.length ? ids : roleManagerIds(db);
}

/**
 * The approvers of an amount of a type: people with the type's Approve tick whose role is one of the
 * roles of the type's approval band for that amount. Nobody (no band, nobody in the band's role): the Admins.
 */
export async function typeBandApprovers(db: Db, amountCents: number, type: TypeRef | string | null | undefined): Promise<string[]> {
  const fundsTypeId = bandTypeId(type);
  const roleIds = bandRolesFor(amountCents, await db.approvalBand.findMany({ where: { fundsTypeId } }));
  if (roleIds.length) {
    const rows = await db.user.findMany({ where: { active: true, roleId: { in: roleIds }, role: { active: true, permissions: { hasSome: stepKeys("approve", type) } } }, select: { id: true } });
    if (rows.length) return rows.map((r) => r.id);
  }
  return roleManagerIds(db);
}

/** The bands a request uses: its own built-in type's; a type added later uses the Cash advance bands. */
export const bandTypeId = (type: TypeRef | string | null | undefined): string => {
  const id = typeof type === "string" ? type : type?.fundsTypeId ?? null;
  return id === TYPE_ID.FT ? TYPE_ID.FT : TYPE_ID.CA;
};

export type HandlerStep = Extract<FundsStep, "approve" | "release" | "settle">;
export const HANDLER_STEPS: HandlerStep[] = ["approve", "release", "settle"];
export const STEP_TITLE: Record<HandlerStep, string> = { approve: "Approve", release: "Release", settle: "Settle and close" };
const STEP_VERB: Record<HandlerStep, string> = { approve: "approve", release: "release", settle: "settle and close" };

export interface Handlers { type: TypeKey; steps: { step: HandlerStep; people: { name: string; role: string }[] }[]; gaps: string[] }

/** Settings, Funds types: who can approve, release, settle each type (active people), and what nobody can do. */
export async function fundsHandlers(db: Db = prisma): Promise<Handlers[]> {
  const people = await db.user.findMany({
    where: { active: true, role: { active: true } },
    select: { name: true, role: { select: { name: true, permissions: true } } },
    orderBy: { name: "asc" },
  });
  return TYPE_KEYS.map((type) => {
    const steps = HANDLER_STEPS.map((step) => ({
      step, people: people.filter((p) => p.role.permissions.includes(STEP_KEY[type][step])).map((p) => ({ name: p.name, role: p.role.name })),
    }));
    return { type, steps, gaps: steps.filter((s) => s.people.length === 0).map((s) => gapText(type, s.step)) };
  });
}

/** "Nobody can release fund transfers." */
export const gapText = (type: TypeKey, step: HandlerStep) => `Nobody can ${STEP_VERB[step]} ${TYPE_NOUN[type]}.`;

/** Every gap, both types ("Nobody can release fund transfers."), for the Roles page and the Funds page (Admin). */
export async function fundsGaps(db: Db = prisma): Promise<string[]> {
  return (await fundsHandlers(db)).flatMap((h) => h.gaps);
}

/** "Ana Cruz, Ben Uy, ... +3 more" (up to 5 names). */
export function namesText(names: string[], max = 5): string {
  if (!names.length) return "Nobody";
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max} more` : names.join(", ");
}
