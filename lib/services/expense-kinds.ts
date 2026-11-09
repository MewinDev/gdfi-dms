import "server-only";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { decimalToCents, peso, toCents } from "@/lib/funds/rules";
import {
  OTHER, amountModeText, checkKindAmount, cleanName, codeFromName, kindNameProblem, kindText, nameKey, otherSuggestions, sortKinds, type AmountMode,
} from "@/lib/funds/kinds";
import { UserError } from "./errors";

/**
 * Settings > Expense kinds. A kind is never deleted (made inactive instead); Other is built in. A change
 * to a kind's amount affects only new lines: every line keeps the amount, source and lock it was made with.
 */

type Db = Tx | typeof prisma;
export type KindRow = Awaited<ReturnType<typeof allKinds>>[number];

export async function allKinds(db: Db = prisma) {
  return sortKinds(await db.expenseKind.findMany());
}

/** code -> name, for labels on screens, the CSV and the Journey. */
export async function kindNames(db: Db = prisma): Promise<Map<string, string>> {
  return new Map((await db.expenseKind.findMany({ select: { code: true, name: true } })).map((k) => [k.code, k.name]));
}

/** "Other: Courier", "Notary fee". */
export const lineKindText = (names: Map<string, string>, l: { kind: string; otherDescription?: string | null }) => kindText(l.kind, names.get(l.kind), l.otherDescription);

/** The kind options a form needs (browser-safe shape). */
export function kindOption(k: KindRow) {
  return { code: k.code, name: k.name, active: k.active, builtIn: k.builtIn, sortOrder: k.sortOrder, amountMode: k.amountMode as AmountMode, amountCents: k.amountCents };
}

const modeOf = (v: unknown): AmountMode => {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "SUGGESTED" || s === "FIXED" ? s : "TYPED";
};

export const KIND_SCHEMA = z.object({
  name: z.string().default(""),
  amountMode: z.preprocess(modeOf, z.enum(["TYPED", "SUGGESTED", "FIXED"])),
  amount: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string()),
});

/** Checks a kind as the form or the import sends it. Throws UserError with the field. */
export async function checkKind(db: Db, id: string | null, raw: { name?: unknown; amountMode?: unknown; amount?: unknown }) {
  const p = KIND_SCHEMA.parse(raw);
  const cur = id ? await db.expenseKind.findUnique({ where: { id } }) : null;
  if (id && !cur) throw new UserError("Kind not found. It may have been changed by someone else.");
  const isOther = cur?.code === OTHER;
  const name = isOther ? cur!.name : cleanName(p.name);
  if (isOther && cleanName(p.name) && cleanName(p.name) !== cur!.name) throw new UserError("Other is built in: it cannot be renamed.", "name");
  const why = kindNameProblem(name);
  if (why) throw new UserError(why, "name");
  const key = nameKey(name);
  const twin = await db.expenseKind.findFirst({ where: { nameKey: key, ...(id ? { NOT: { id } } : {}) } });
  if (twin) throw new UserError(`${twin.name} already exists${twin.active ? "" : " (inactive: make it active instead)"}. Names must be different, ignoring capitals and spaces.`, "name");
  const typed = p.amount.trim();
  const cents = typed === "" ? null : toCents(typed);
  if (typed !== "" && cents === null && p.amountMode !== "TYPED") throw new UserError("Type the amount in pesos: whole pesos or two decimals, for example 500 or 1,250.50.", "amount");
  const amt = checkKindAmount(cur?.code ?? "", p.amountMode, cents);
  if (!amt.ok) throw new UserError(amt.message, isOther ? "amountMode" : "amount");
  // A fixed amount cannot be changed by the processor, so it must fit every rule's maximum for this kind.
  if (p.amountMode === "FIXED" && amt.cents !== null && cur) {
    const rules = await db.cashAdvanceRule.findMany({ where: { kind: cur.code, active: true }, include: { transactionType: true } });
    const over = rules.find((r) => (decimalToCents(r.maxAmount) ?? 0) < amt.cents!);
    if (over) throw new UserError(`A fixed amount of ${peso(amt.cents)} is above the maximum of ${peso(decimalToCents(over.maxAmount) ?? 0)} in the ${over.transactionType.name} rule. Lower the amount, use Suggested, or raise the rule's maximum.`, "amount");
  }
  return { name, nameKey: key, amountMode: p.amountMode, amountCents: amt.cents, cur };
}

/** Open requests (not yet released) that use the kind: they keep their amounts when the kind's amount changes. */
export async function openRequestsUsing(code: string, db: Db = prisma) {
  return db.cashAdvance.count({ where: { status: { in: ["REQUESTED", "APPROVED"] }, lines: { some: { kind: code } } } });
}

/** Rules and request lines that use each kind ("Used in"). */
export async function kindUsage(db: Db = prisma): Promise<Map<string, { rules: number; lines: number }>> {
  const [rules, lines] = await Promise.all([
    db.cashAdvanceRule.groupBy({ by: ["kind"], _count: { _all: true } }),
    db.cashAdvanceLine.groupBy({ by: ["kind"], _count: { _all: true } }),
  ]);
  const out = new Map<string, { rules: number; lines: number }>();
  for (const r of rules) out.set(r.kind, { rules: r._count._all, lines: 0 });
  for (const l of lines) out.set(l.kind, { rules: out.get(l.kind)?.rules ?? 0, lines: l._count._all });
  return out;
}

function needManage(u: CurrentUser) {
  if (!can(u, PERMISSIONS.FUNDS_KINDS_MANAGE)) throw new UserError("Your role does not allow adding or changing expense kinds.");
}

/** Add or edit a kind (Settings form). Audited. */
export async function saveExpenseKind(u: CurrentUser, id: string | null, raw: { name?: unknown; amountMode?: unknown; amount?: unknown }) {
  needManage(u);
  return prisma.$transaction(async (tx) => {
    const d = await checkKind(tx, id, raw);
    if (d.cur) {
      const saved = await tx.expenseKind.update({ where: { id: d.cur.id }, data: { name: d.name, nameKey: d.nameKey, amountMode: d.amountMode, amountCents: d.amountCents } });
      await writeAudit(tx, {
        actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "setting_updated", entityType: "expenseKind", entityId: saved.id,
        summary: `Expense kind ${d.cur.name === d.name ? d.name : `${d.cur.name} renamed to ${d.name}`}: ${amountModeText(d.amountMode, d.amountCents)} (was ${amountModeText(d.cur.amountMode as AmountMode, d.cur.amountCents)}). Old records keep their amounts.`,
        before: { name: d.cur.name, amountMode: d.cur.amountMode, amountCents: d.cur.amountCents }, after: { name: d.name, amountMode: d.amountMode, amountCents: d.amountCents },
      });
      return saved;
    }
    return createKind(tx, u, d, "Settings");
  });
}

async function createKind(tx: Tx, u: CurrentUser, d: { name: string; nameKey: string; amountMode: AmountMode; amountCents: number | null }, where: string) {
  const all = await tx.expenseKind.findMany({ select: { code: true, sortOrder: true } });
  const code = codeFromName(d.name, all.map((k) => k.code));
  const sortOrder = Math.max(0, ...all.filter((k) => k.code !== OTHER).map((k) => k.sortOrder)) + 1;
  const saved = await tx.expenseKind.create({ data: { code, name: d.name, nameKey: d.nameKey, amountMode: d.amountMode, amountCents: d.amountCents, sortOrder } });
  await writeAudit(tx, {
    actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "expense_kind_added", entityType: "expenseKind", entityId: saved.id,
    summary: `${u.name} added the expense kind ${d.name} (${amountModeText(d.amountMode, d.amountCents)}) from ${where}`,
    after: { code, name: d.name, amountMode: d.amountMode, amountCents: d.amountCents },
  });
  return saved;
}

/** "+ Add new kind" on the funds screens: saved Active, returned so the dropdown can select it. */
export async function quickAddKind(u: CurrentUser, raw: { name?: unknown; amountMode?: unknown; amount?: unknown }, where = "a funds screen") {
  needManage(u);
  return prisma.$transaction(async (tx) => createKind(tx, u, await checkKind(tx, null, raw), where));
}

/** Up or down in every dropdown. Other always stays last. */
export async function moveExpenseKind(u: CurrentUser, id: string, dir: -1 | 1) {
  needManage(u);
  await prisma.$transaction(async (tx) => {
    const list = (await allKinds(tx)).filter((k) => k.code !== OTHER);
    const i = list.findIndex((k) => k.id === id);
    if (i < 0) throw new UserError((await tx.expenseKind.findUnique({ where: { id } }))?.code === OTHER ? "Other is always last." : "Kind not found.");
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (const [n, k] of list.entries()) if (k.sortOrder !== n + 1) await tx.expenseKind.update({ where: { id: k.id }, data: { sortOrder: n + 1 } });
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "setting_updated", entityType: "expenseKind", entityId: id, summary: `Expense kind ${list[j].name} moved ${dir < 0 ? "up" : "down"}` });
  });
}

const SUGGESTION_DAYS = 90;

/** "Often typed as Other": descriptions typed 3 or more times in the last 90 days (ignoring case), not yet a kind. */
export async function otherSuggestionList(now: Date = new Date(), db: Db = prisma) {
  const since = new Date(now.getTime() - SUGGESTION_DAYS * 86_400_000);
  const [lines, kinds] = await Promise.all([
    db.cashAdvanceLine.findMany({ where: { kind: OTHER, createdAt: { gte: since }, NOT: { otherDescription: "" } }, select: { otherDescription: true } }),
    db.expenseKind.findMany({ select: { nameKey: true } }),
  ]);
  return otherSuggestions(lines.map((l) => l.otherDescription), new Set(kinds.map((k) => k.nameKey)));
}

/** Old Other lines with this description (ignoring case and spaces). */
async function matchingOtherLines(db: Db, text: string) {
  const key = nameKey(text);
  const rows = await db.cashAdvanceLine.findMany({ where: { kind: OTHER, NOT: { otherDescription: "" } }, select: { id: true, otherDescription: true } });
  return rows.filter((r) => nameKey(r.otherDescription) === key).map((r) => r.id);
}

/**
 * "Add as a kind" from the suggestions: creates the kind (with the amount mode asked in the same modal)
 * and, only when asked, relabels the old Other lines with that description to the new kind (they keep
 * their amounts and the typed text).
 */
export async function addSuggestionAsKind(u: CurrentUser, raw: { name?: unknown; amountMode?: unknown; amount?: unknown; relabel?: unknown }) {
  needManage(u);
  return prisma.$transaction(async (tx) => {
    const d = await checkKind(tx, null, raw);
    const kind = await createKind(tx, u, d, "the Other suggestions");
    let relabelled = 0;
    if (raw.relabel === true || raw.relabel === "on" || raw.relabel === "true") {
      const ids = await matchingOtherLines(tx, d.name);
      if (ids.length) {
        relabelled = (await tx.cashAdvanceLine.updateMany({ where: { id: { in: ids } }, data: { kind: kind.code } })).count;
        await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "expense_kind_relabelled", entityType: "expenseKind", entityId: kind.id, summary: `${u.name} relabelled ${relabelled} old "Other: ${d.name}" line(s) as ${d.name}. Amounts unchanged.`, after: { lineIds: ids } });
      }
    }
    return { kind, relabelled };
  });
}

/** Kind of a line must exist and be active for new work; an inactive one is allowed only if it is already on the record. */
export async function requireUsableKind(db: Db, code: string, current?: string | null) {
  const k = await db.expenseKind.findUnique({ where: { code } });
  if (!k) throw new UserError("Pick an expense kind from the list.", "kind");
  if (!k.active && k.code !== current) throw new UserError(`${k.name} is inactive. Pick an active expense kind.`, "kind");
  return k;
}

/** The LA's funds flag: known kinds only; a kind made inactive stays only if it was already flagged. */
export async function validFlagKinds(db: Db, codes: string[], current: string[] = []): Promise<string[]> {
  const rows = await db.expenseKind.findMany({ where: { code: { in: [...new Set(codes)] } } });
  return sortKinds(rows.filter((k) => k.active || current.includes(k.code))).map((k) => k.code);
}

/** Choices for "What are the funds for?": active kinds, plus any already flagged; Other last. */
export async function flagKindChoices(current: string[] = [], db: Db = prisma): Promise<[string, string][]> {
  return sortKinds((await db.expenseKind.findMany()).filter((k) => k.active || current.includes(k.code))).map((k) => [k.code, k.name]);
}
