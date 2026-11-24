import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import { classifyByKeywords, classificationWord, type ClassificationRules, type ClassificationValue, type ClassifyResult } from "@/lib/rules/classify";
import { getClassificationRules, recheckClassifications } from "./classification";
import { UserError } from "./errors";
import { notify } from "@/lib/notify";
import { holdsWhere } from "@/lib/auth/holders";
import { setSetting } from "@/lib/settings";
import { recordReferenceChange } from "./reference-changes";

/**
 * D-049: myloans products (API 5) and their classification. The list is read whole from API 5 and matched by
 * myloans' ProductID, so a rename keeps a manual setting. "Manage product classification" sets any product to
 * Financing or Refinancing (overrides the keywords) with a reason; every change is audited and open loan files are
 * re-checked ("Classification changed since accepted").
 */

/** Read API 5 and bring the product list up to date. Products no longer sent are made inactive (never deleted). */
export async function refreshProducts(now: Date = new Date()): Promise<{ added: number; renamed: number; inactive: number; total: number }> {
  const r = await myLoansClientV1({ ceiling: false }).products();
  if (!r.ok) throw new UserError(r.message);
  const known = new Map((await prisma.product.findMany()).map((p) => [p.sourceProductId, p]));
  let added = 0, renamed = 0;
  const firstRead = known.size === 0;
  const rules = await getClassificationRules();
  const classifiers = firstRead ? [] : (await prisma.user.findMany({ where: holdsWhere(PERMISSIONS.SETTINGS_CLASSIFICATION), select: { id: true } })).map((u) => u.id);
  for (const p of r.data.items) {
    const was = known.get(p.productId);
    if (!was) {
      await prisma.product.create({ data: { sourceProductId: p.productId, code: p.productCode, name: p.name, active: p.active, seenAt: now } });
      added++;
      // D-054: a new product is classified by the keywords; the people who manage classification are told.
      // (Not on the very first read, which brings the whole list.)
      if (p.active && classifiers.length) {
        const c = classifyByKeywords(p.name, rules, p.productCode);
        await prisma.$transaction((tx) => notify(tx, { userIds: classifiers, title: `New product: ${p.name}`, body: `New product: ${p.name}, classified as ${classificationWord(c.classification)}${c.step === "DEFAULT" ? " by default" : ""}. Change it in Settings, Product classification if it is wrong.`, link: "/admin/settings?open=classification" }));
      }
      continue;
    }
    if (was.name !== p.name) {
      renamed++;
      // D-012, D-053: a product rename is reference data: logged in Reference data changes (with a notice).
      await prisma.$transaction((tx) => recordReferenceChange(tx, { entity: "PRODUCT", key: p.productCode, oldValue: was.name, newValue: p.name, source: "myloans API 5", at: now }));
    }
    await prisma.product.update({ where: { id: was.id }, data: { code: p.productCode, name: p.name, active: p.active, seenAt: now } });
  }
  const sent = new Set(r.data.items.map((p) => p.productId));
  const gone = await prisma.product.updateMany({ where: { active: true, sourceProductId: { notIn: [...sent] } }, data: { active: false } });
  if (renamed) await recheckClassifications(prisma);
  await setSetting("products.lastReadAt", now.toISOString());
  return { added, renamed, inactive: gone.count, total: r.data.items.length };
}

export interface ProductRow {
  id: string; code: string; name: string;
  manual: ClassificationValue | null; note: string; by: string; at: Date | null;
  before: ClassifyResult; after: ClassifyResult; changes: boolean;
  /** D-052: the product's history (each change with who, when and the reason), newest first. */
  history: { at: Date; by: string; text: string }[];
}

const how = (r: ClassifyResult) => (r.step === "MANUAL" ? "set by hand" : r.step === "DEFAULT" ? "by default" : `"${r.keyword}"`);
export const resultText = (r: ClassifyResult) => `${classificationWord(r.classification)} (${how(r)})`;

/**
 * "Test keyword rules" over all active products (D-049): each product with the saved rules (before) and with the
 * rules being tried (after). Manual settings count in both. Changed rows first, then by name.
 */
export async function productPreview(tried?: ClassificationRules): Promise<{ rows: ProductRow[]; moving: { from: string; to: string; n: number }[] }> {
  const [saved, products] = await Promise.all([getClassificationRules(), prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  const audits = await prisma.auditLog.findMany({ where: { action: "product_classification_set", entityType: "Product", entityId: { in: products.map((p) => p.id) } }, orderBy: { at: "desc" }, select: { entityId: true, at: true, actorLabel: true, summary: true } });
  const after = tried ? { ...tried, manual: saved.manual } : saved;
  const rows = products.map((p) => {
    const b = classifyByKeywords(p.name, saved, p.code), a = classifyByKeywords(p.name, after, p.code);
    return {
      id: p.id, code: p.code, name: p.name, manual: p.classification, note: p.classificationNote, by: p.classifiedByLabel, at: p.classifiedAt,
      before: b, after: a, changes: b.classification !== a.classification || b.step !== a.step,
      history: audits.filter((a) => a.entityId === p.id).map((a) => ({ at: a.at, by: a.actorLabel, text: a.summary })),
    };
  }).sort((x, y) => Number(y.changes) - Number(x.changes) || x.name.localeCompare(y.name));
  const label = (r: ClassifyResult) => `${classificationWord(r.classification)}${r.step === "DEFAULT" ? " (default)" : r.step === "MANUAL" ? " (set by hand)" : ""}`;
  const moves = new Map<string, number>();
  for (const r of rows.filter((x) => x.before.classification !== x.after.classification)) {
    const k = `${label(r.before)}→${label(r.after)}`;
    moves.set(k, (moves.get(k) ?? 0) + 1);
  }
  return { rows, moving: [...moves.entries()].map(([k, n]) => { const [from, to] = k.split("→"); return { from, to, n }; }) };
}

/**
 * Set a product to Financing or Refinancing, or back to the keywords (value null). "Manage product classification";
 * a reason (5 to 300 characters) is required; audited; open loan files are re-checked.
 */
export async function setProductClassification(u: CurrentUser, productId: string, value: ClassificationValue | null, reason: string) {
  if (!can(u, PERMISSIONS.SETTINGS_CLASSIFICATION)) throw new UserError("Ask a Superadmin to turn on \"Manage product classification\" for your role.");
  const why = reason.trim();
  if (why.length < 5) throw new UserError("Say why (at least 5 characters).", "reason");
  if (why.length > 300) throw new UserError("Keep the reason under 300 characters.", "reason");
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) throw new UserError("Pick a product.");
  if (p.classification === value) throw new UserError(value ? `It is already set to ${classificationWord(value)}.` : "It already follows the keywords.");
  return prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: p.id }, data: value ? { classification: value, classificationNote: why, classifiedById: u.id, classifiedByLabel: u.name, classifiedAt: new Date() } : { classification: null, classificationNote: why, classifiedById: u.id, classifiedByLabel: u.name, classifiedAt: new Date() } });
    const flagged = await recheckClassifications(tx);
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "product_classification_set", entityType: "Product", entityId: p.id,
      summary: `${p.name} (${p.code}): ${value ? `set to ${classificationWord(value)}` : "back to the keywords"} by ${u.name}. Reason: ${why}. ${flagged.flagged} open loan file${flagged.flagged === 1 ? "" : "s"} flagged.`,
      before: { classification: p.classification }, after: { classification: value, reason: why },
    });
    return flagged;
  }, { timeout: 120_000 });
}
