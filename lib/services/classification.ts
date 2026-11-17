import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { classifyByKeywords, classificationWord, parseKeywords, type ClassificationRules, type ClassificationValue } from "@/lib/rules/classify";
import { proposeEffect, type Tracked } from "@/lib/myloans/changes";
import { applyTransactionChanges, txnsNow } from "./source-sync";
import { recomputeStage } from "./stage";
import { UserError, NotInScopeError } from "./errors";

/**
 * Product classification (D-031): the keyword lists in Settings, the re-check of open loan files when they
 * change, the "Test keyword rules" preview, and Reclassify. The rule itself is lib/rules/classify.ts.
 */

type Db = Tx | typeof prisma;
const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });

/** Open loan files: not cancelled, closed or archived. Their classification can still matter. */
const OPEN_LOAN: Prisma.LoanWhereInput = { cancelledAt: null, closedAt: null, archivedAt: null };

export const getClassificationRules = (db: Db = prisma) => getSetting("classification.rules", db);

/** Reads the Settings form (two lists, one keyword per line or comma; the default). Plain-language problems. */
export function rulesFromForm(raw: { refinancing?: unknown; financing?: unknown; fallback?: unknown }): { rules: ClassificationRules; problem: string | null; field?: string } {
  const refi = parseKeywords(String(raw.refinancing ?? ""));
  const fin = parseKeywords(String(raw.financing ?? ""));
  const fallback: ClassificationValue = raw.fallback === "FINANCING" ? "FINANCING" : "REFINANCING";
  const rules = { refinancing: refi.keywords, financing: fin.keywords, fallback };
  if (refi.problem) return { rules, problem: `Refinancing keywords: ${refi.problem}`, field: "refinancing" };
  if (fin.problem) return { rules, problem: `Financing keywords: ${fin.problem}`, field: "financing" };
  if (!refi.keywords.length) return { rules, problem: "Add at least one Refinancing keyword.", field: "refinancing" };
  if (!fin.keywords.length) return { rules, problem: "Add at least one Financing keyword.", field: "financing" };
  return { rules, problem: null };
}

export interface PreviewRow {
  productName: string;
  loans: number;
  /** What the open loans with this name are saved as now (the most common, if they differ). */
  saved: ClassificationValue;
  next: ClassificationValue;
  byDefault: boolean;
  keyword: string | null;
  /** Open loans with this name whose saved classification differs from `next`. */
  changes: number;
}

/** "Test keyword rules": every product name on open loan files, today's saved result and the result with these rules. */
export async function previewClassification(rules: ClassificationRules, db: Db = prisma): Promise<{ rows: PreviewRow[]; loansChanging: number; byDefault: number }> {
  const groups = await db.loan.groupBy({ by: ["productName", "classification"], where: OPEN_LOAN, _count: { _all: true } });
  const byName = new Map<string, { FINANCING: number; REFINANCING: number }>();
  for (const g of groups) {
    const k = g.productName ?? "";
    const row = byName.get(k) ?? { FINANCING: 0, REFINANCING: 0 };
    row[g.classification] += g._count._all;
    byName.set(k, row);
  }
  const rows = [...byName.entries()].map(([productName, n]) => {
    const r = classifyByKeywords(productName, rules);
    const saved: ClassificationValue = n.FINANCING > n.REFINANCING ? "FINANCING" : "REFINANCING";
    return { productName, loans: n.FINANCING + n.REFINANCING, saved, next: r.classification, byDefault: r.step === "DEFAULT", keyword: r.keyword, changes: r.classification === "FINANCING" ? n.REFINANCING : n.FINANCING };
  }).sort((a, b) => b.changes - a.changes || Number(b.byDefault) - Number(a.byDefault) || a.productName.localeCompare(b.productName));
  return { rows, loansChanging: rows.reduce((s, r) => s + r.changes, 0), byDefault: rows.filter((r) => r.byDefault).reduce((s, r) => s + r.loans, 0) };
}

/**
 * Re-check open loan files against the rules (after a keyword save). A loan whose result now differs is
 * flagged ("Classification changed since accepted", classificationNow); nothing else changes until someone
 * reclassifies it. A loan whose result is the same just has its "by default" label brought up to date.
 */
export async function recheckClassifications(db: Db = prisma, rules?: ClassificationRules): Promise<{ flagged: number; cleared: number }> {
  const r = rules ?? (await getClassificationRules(db));
  const loans = await db.loan.findMany({ where: OPEN_LOAN, select: { id: true, productName: true, classification: true, classificationNow: true, classifiedByDefault: true } });
  let flagged = 0, cleared = 0;
  for (const l of loans) {
    const res = classifyByKeywords(l.productName, r);
    const now = res.classification === l.classification ? null : res.classification;
    const data: Prisma.LoanUpdateInput = {};
    if (now !== l.classificationNow) { data.classificationNow = now; if (now) flagged++; else cleared++; }
    if (!now && l.classifiedByDefault !== (res.step === "DEFAULT")) data.classifiedByDefault = res.step === "DEFAULT";
    if (Object.keys(data).length) await db.loan.update({ where: { id: l.id }, data });
  }
  return { flagged, cleared };
}

/** Settings, Product classification: Save (settings:classification). Audited with before and after; re-checks open loans. */
export async function saveClassificationRules(u: CurrentUser, raw: { refinancing?: unknown; financing?: unknown; fallback?: unknown }) {
  if (!can(u, PERMISSIONS.SETTINGS_CLASSIFICATION)) throw new UserError("Ask a Superadmin to turn on \"Change product classification keywords\" for your role.");
  const { rules, problem, field } = rulesFromForm(raw);
  if (problem) throw new UserError(problem, field);
  return prisma.$transaction(async (tx) => {
    const before = await getClassificationRules(tx);
    await setSetting("classification.rules", rules, tx);
    const result = await recheckClassifications(tx, rules);
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "classification_rules_saved", entityType: "Setting", entityId: "classification.rules",
      summary: `Product classification keywords saved. Refinancing: ${rules.refinancing.join(", ")}. Financing: ${rules.financing.join(", ")}. No keyword: ${classificationWord(rules.fallback)}. ${result.flagged} open loan file${result.flagged === 1 ? "" : "s"} flagged "Classification changed since accepted".`,
      before: before as unknown as Prisma.InputJsonValue, after: rules as unknown as Prisma.InputJsonValue,
    });
    return result;
  }, { timeout: 120_000 });
}

const reclassifySchema = z.object({
  note: z.string().trim().min(5, "Write a short note (at least 5 characters).").max(500, "Keep the note under 500 characters."),
  financingType: z.enum(["UNDERTAKING", "NON_UNDERTAKING"]).nullish(),
  orcrStatus: z.enum(["TRANSFERRED", "UNTRANSFERRED"]).nullish(),
});

/**
 * Reclassify (loans:reclassify, the loan's branch in the person's access): applies the result the keyword
 * rules give now, re-running Rules 2 to 4 like Apply does. Unsent transactions are added or removed; sent work
 * never changes (refused with the reason). Audited with before and after.
 */
export async function reclassifyLoan(u: CurrentUser, loanId: string, raw: unknown) {
  if (!can(u, PERMISSIONS.LOANS_RECLASSIFY)) throw new UserError("Ask a Superadmin to turn on \"Reclassify a loan\" for your role.");
  const parsed = reclassifySchema.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message, String(parsed.error.issues[0].path[0] ?? "note"));
  const d = parsed.data;
  return withLoanLock(loanId, async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: loanId } });
    if (!loan || !inScope(u, loan.branchId)) throw new NotInScopeError();
    if (!loan.classificationNow) throw new UserError("Nothing to reclassify: the keyword rules give the same result as the saved one.");
    const rules = await getClassificationRules(tx);
    const next: Tracked = { productName: loan.productName, loanType: loan.loanType, amount: Math.round(Number(loan.totalReleasedAmount.toString()) * 100) } as Tracked;
    const p = proposeEffect({
      category: "MATERIAL", loan: { ...loan, financingType: loan.financingType, orcrStatus: loan.orcrStatus }, txns: await txnsNow(tx, loanId), next, rules,
      picks: { financingType: d.financingType ?? null, orcrStatus: d.orcrStatus ?? null },
    });
    if (p.needsPicks) throw new UserError("It becomes Financing: pick Undertaking or Non-Undertaking and the OR/CR status first.", "financingType");
    if (!p.ruleNext || !p.classificationNext) throw new UserError(p.sentences[0] ?? "The rules cannot run on this loan's data.");
    const locked = p.affected.filter((a) => a.locked);
    if (locked.length) throw new UserError(`${locked.map((a) => a.stateLine).join("; ")}. Reclassify never changes work that was sent. Ask the LA to pull it back or the processor to return it first.`);
    const res = classifyByKeywords(loan.productName, rules);
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        classification: p.classificationNext, mortgageResult: p.mortgageNext as never, ruleFired: p.ruleNext,
        financingType: p.classificationNext === "FINANCING" ? (d.financingType ?? loan.financingType) : null,
        orcrStatus: p.classificationNext === "FINANCING" ? (d.orcrStatus ?? loan.orcrStatus) : null,
        classificationNow: null, classifiedByDefault: res.step === "DEFAULT",
      },
    });
    await applyTransactionChanges(tx, loan.id, p);
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "loan_reclassified", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn,
      summary: `Reclassified by ${u.name}: ${classificationWord(loan.classification)} → ${classificationWord(p.classificationNext)} (keyword rules changed). ${p.sentences.join(" ")} Note: ${d.note}`,
      before: { classification: loan.classification, mortgage: loan.mortgageResult }, after: { classification: p.classificationNext, mortgage: p.mortgageNext, added: p.added, removed: p.removed },
    });
    await recomputeStage(tx, loan.id);
    return p;
  });
}

/** The loan file's line: "Classification changed since accepted: was X, now Y" (null when nothing changed). */
export function classificationChangedText(loan: { classification: ClassificationValue; classificationNow: ClassificationValue | null }): string | null {
  if (!loan.classificationNow || loan.classificationNow === loan.classification) return null;
  return `Classification changed since accepted: was ${classificationWord(loan.classification)}, now ${classificationWord(loan.classificationNow)}.`;
}
