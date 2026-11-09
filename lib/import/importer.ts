import { fieldsFromText, fieldsToText, type EvidenceField } from "@/lib/stages/rules";
import { rebuildAccess } from "@/lib/branches/access";
import "server-only";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { LIST_PERMISSION, PERMISSIONS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { SETTINGS_SCHEMAS, USER_SCHEMA, checkSettingsRow, type SettingsKind } from "@/lib/services/admin";
import { applyAccess, branchGrants, checkAccess, type AccessInput } from "@/lib/services/access";
import { applyChange, loadSnapshot, lockoutRefusal } from "@/lib/services/lockout";
import { UserError } from "@/lib/services/errors";
import { checkKind } from "@/lib/services/expense-kinds";
import { OTHER, amountModeText, codeFromName, nameKey, sortKinds, type AmountMode } from "@/lib/funds/kinds";
import { IMPORT_LISTS, MAX_BYTES, MAX_ROWS, type ImportColumn, type ImportListKey } from "./columns";
import { looksLikeFormula, parseCsv, toCsv } from "./csv";

type Db = Prisma.TransactionClient;

export interface PlanRow {
  /** Row number in the file (the column names are row 1). */
  line: number;
  key: string;
  action: "new" | "changed" | "unchanged" | "problem";
  /** "Row 7, Branch code: already used by another branch" */
  problems: string[];
  /** Plain names of the changed fields. */
  changes: string[];
  cells: Record<string, string>;
}
export interface PlanCounts { new: number; changed: number; unchanged: number; problem: number }
export type ImportPlan =
  | { ok: true; list: ImportListKey; fileName: string; rows: PlanRow[]; counts: PlanCounts }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** Turns the file into records keyed by column name. Refuses the whole file for file-level problems. */
export function readImportFile(list: ImportListKey, text: string): { records: { line: number; cells: Record<string, string> }[] } | { error: string } {
  const def = IMPORT_LISTS[list];
  if (new TextEncoder().encode(text).length > MAX_BYTES) return { error: "The file is larger than 2 MB. Split it into smaller files." };
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: "The file is empty. Keep the first row with the column names and add one row per item." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const known = def.columns.map((c) => c.name);
  const unknown = header.filter((h) => h !== "" && !known.includes(h));
  if (unknown.length) return { error: `The file has a column this list does not use: "${unknown[0]}". Do not change the column names. Download the template to see them.` };
  const missing = def.columns.filter((c) => c.required !== "no" && !header.includes(c.name));
  if (missing.length) return { error: `The file is missing the column "${missing[0].name}". Do not change the column names. Download the template to see them.` };
  const dup = header.find((h, i) => h !== "" && header.indexOf(h) !== i);
  if (dup) return { error: `The column "${dup}" appears twice. Keep each column once.` };

  const records: { line: number; cells: Record<string, string> }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => c.trim() === "")) continue; // blank line
    const cells: Record<string, string> = {};
    header.forEach((h, j) => { if (h) cells[h] = (r[j] ?? "").trim(); });
    records.push({ line: i + 1, cells });
  }
  if (records.length === 0) return { error: "The file has no rows to import. Add one row per item under the column names." };
  if (records.length > MAX_ROWS) return { error: `The file has ${records.length.toLocaleString("en-PH")} rows. The most is ${MAX_ROWS.toLocaleString("en-PH")}. Split it into smaller files.` };

  // CSV injection: refuse formula-looking text in text columns.
  const textCols = def.columns.filter((c) => c.text).map((c) => c.name);
  for (const rec of records) {
    for (const c of textCols) {
      const v = rec.cells[c] ?? "";
      if (v && looksLikeFormula(v)) {
        const col = def.columns.find((x) => x.name === c)!;
        return { error: `Row ${rec.line}, ${col.label}: the text starts with "${v.trim()[0]}", which a spreadsheet may run as a formula. Remove it (or start the text with a letter) and check again. Files that look like they contain formulas are refused.` };
      }
    }
  }
  return { records };
}

// ---------------------------------------------------------------------------
// Small converters
// ---------------------------------------------------------------------------

const lower = (v: string | undefined) => (v ?? "").trim().toLowerCase();
function yesNo(v: string | undefined): boolean | "bad" {
  const s = lower(v);
  if (s === "yes") return true;
  if (s === "no") return false;
  return "bad";
}
function statusOf(v: string | undefined): boolean | null | "bad" {
  const s = lower(v);
  if (s === "") return null;
  if (s === "active") return true;
  if (s === "inactive") return false;
  return "bad";
}
const yn = (b: boolean) => (b ? "Yes" : "No");
const st = (b: boolean) => (b ? "Active" : "Inactive");
const ORIG: Record<string, "ORIGINAL" | "COPY" | "EITHER"> = { original: "ORIGINAL", copy: "COPY", either: "EITHER" };
const ORIG_TEXT: Record<string, string> = { ORIGINAL: "Original", COPY: "Copy", EITHER: "Either" };

class Row {
  problems: string[] = [];
  constructor(public line: number, public cells: Record<string, string>, private cols: ImportColumn[]) {}
  label(col: string) { return this.cols.find((c) => c.name === col)?.label ?? col; }
  bad(col: string, msg: string) { this.problems.push(`Row ${this.line}, ${this.label(col)}: ${msg}`); }
  badRow(msg: string) { this.problems.push(`Row ${this.line}: ${msg}`); }
}

/** Runs a form schema; problems are reported against the column that holds the field. */
function validate<T>(row: Row, schema: z.ZodType<T>, raw: Record<string, unknown>, fieldToColumn: Record<string, string>): T | null {
  const p = schema.safeParse(raw);
  if (p.success) return p.data;
  for (const i of p.error.issues) row.bad(fieldToColumn[String(i.path[0] ?? "")] ?? String(i.path[0] ?? ""), i.message);
  return null;
}

async function dbRule(row: Row, kind: SettingsKind, id: string | null, data: Record<string, unknown>, db: Db, fieldToColumn: Record<string, string>) {
  try {
    await checkSettingsRow(kind, id, data, db);
  } catch (e) {
    if (e instanceof UserError) {
      const col = e.field ? fieldToColumn[e.field] : undefined;
      if (col) row.bad(col, e.message);
      else row.badRow(e.message);
    } else throw e;
  }
}

function diff(labels: Record<string, string>, before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(labels).filter((k) => String(before[k] ?? "") !== String(after[k] ?? "")).map((k) => labels[k]);
}

/** Running count of active rows, for "the last active ... cannot be made inactive". */
class ActiveCounter {
  constructor(public left: number) {}
  change(from: boolean | null, to: boolean): string | null {
    if (from === true && to === false) {
      if (this.left <= 1) return "this would leave no active row, and the app needs at least one. Keep it Active.";
      this.left--;
    } else if (from !== true && to === true) this.left++;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per list: plan (validate + compare) and apply
// ---------------------------------------------------------------------------

interface Planned {
  row: Row;
  key: string;
  action: "new" | "changed" | "unchanged";
  changes: string[];
  apply: (tx: Db, actor: { id: string }) => Promise<void>;
}

const statusData = (active: boolean, actor: { id: string }) =>
  active ? { active: true, deactivatedAt: null, deactivatedById: null } : { active: false, deactivatedAt: new Date(), deactivatedById: actor.id };

/** Shared shape: key → existing row; validate; compare; create or update. */
async function planList(list: ImportListKey, records: { line: number; cells: Record<string, string> }[], db: Db, user: CurrentUser): Promise<{ planned: Planned[]; problems: Row[] }> {
  const cols = IMPORT_LISTS[list].columns;
  const rows = records.map((r) => new Row(r.line, r.cells, cols));
  const planned: Planned[] = [];
  const problems: Row[] = [];
  const seen = new Map<string, number>();

  const finish = (row: Row, key: string, p: Omit<Planned, "row" | "key"> | null) => {
    const k = key.toLowerCase();
    if (k && seen.has(k)) row.badRow(`the same ${IMPORT_LISTS[list].keyColumns.join(" + ")} appears twice in the file (also row ${seen.get(k)}). Keep one row per item.`);
    else if (k) seen.set(k, row.line);
    if (row.problems.length || !p) problems.push(row);
    else planned.push({ row, key, ...p });
  };

  for (const row of rows) {
    if (lower(row.cells.notes).startsWith("example")) row.badRow("this is an example row from the template. Delete it.");
  }

  switch (list) {
    case "branches": {
      // Matched by the 3-digit code. A branch from MyLoans: only the usual LTO office changes here.
      const [existing, divisions, areas, offices] = await Promise.all([db.branch.findMany(), db.division.findMany(), db.area.findMany(), db.ltoOffice.findMany()]);
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      const names = new Map(existing.map((b) => [b.name.toLowerCase(), b.code ?? b.id]));
      const byName = <T extends { name: string }>(list: T[], v: string) => list.find((x) => x.name.toLowerCase() === v.trim().toLowerCase()) ?? null;
      for (const row of rows) {
        const code = (row.cells.code ?? "").trim();
        const cur = existing.find((b) => b.code === code) ?? null;
        const division = row.cells.division?.trim() ? byName(divisions, row.cells.division) : null;
        const area = row.cells.area?.trim() ? byName(areas, row.cells.area) : null;
        if (row.cells.division?.trim() && !division) row.bad("division", `no division is called "${row.cells.division.trim()}". Divisions come from Import from MyLoans.`);
        if (row.cells.area?.trim() && !area) row.bad("area", `no area is called "${row.cells.area.trim()}". Areas come from Import from MyLoans.`);
        const officeCode = (row.cells.usual_lto_office ?? "").trim().toUpperCase();
        const office = officeCode ? offices.find((o) => o.code === officeCode) ?? null : null;
        if (officeCode && !office) row.bad("usual_lto_office", `no LTO office has the code ${officeCode}.`);
        else if (office && !office.active && office.id !== cur?.usualLtoOfficeId) row.bad("usual_lto_office", `${office.name} is inactive. Pick an active office.`);
        const raw = {
          code, name: row.cells.name, address: row.cells.address ?? (cur?.address ?? ""),
          divisionId: row.cells.division === undefined ? cur?.divisionId ?? null : division?.id ?? null,
          areaId: row.cells.area === undefined ? cur?.areaId ?? null : area?.id ?? null,
          usualLtoOfficeId: row.cells.usual_lto_office === undefined ? cur?.usualLtoOfficeId ?? null : office?.id ?? null,
        };
        const data = validate(row, SETTINGS_SCHEMAS.branch, raw, { code: "code", name: "name", address: "address", divisionId: "division", areaId: "area", usualLtoOfficeId: "usual_lto_office" });
        if (data && !data.code) row.bad("code", "type the 3-digit branch code.");
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (data && cur?.source === "MYLOANS") {
          const ro: [keyof typeof data, string][] = [["name", "name"], ["address", "address"], ["divisionId", "division"], ["areaId", "area"]];
          for (const [k, col] of ro) if (String(data[k] ?? "") !== String(cur[k as keyof typeof cur] ?? "")) row.bad(col, "this branch comes from MyLoans: it changes only there (use Import from MyLoans). Only the usual LTO office can change here.");
          if (active !== cur.active) row.bad("status", "this branch comes from MyLoans: it is switched off or on there.");
        }
        if (data) {
          const other = names.get(data.name.toLowerCase());
          if (other && other !== (cur?.code ?? data.code)) row.bad("name", "already used by another branch.");
          names.set(data.name.toLowerCase(), data.code ?? "");
        }
        if (data && data.areaId && !data.divisionId) row.bad("division", "give the division of this area too.");
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur
          ? diff({ name: "Name", address: "Address", divisionId: "Division", areaId: "Area", usualLtoOfficeId: "Usual LTO office", active: "Status" }, cur, { ...data, active })
          : [];
        finish(row, code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.branch.create({ data: { ...data, source: "DMS", ...statusData(active, actor) } });
            else if (cur.source === "MYLOANS") await tx.branch.update({ where: { id: cur.id }, data: { usualLtoOfficeId: data.usualLtoOfficeId } });
            else await tx.branch.update({ where: { id: cur.id }, data: { name: data.name, address: data.address, divisionId: data.divisionId, areaId: data.areaId, usualLtoOfficeId: data.usualLtoOfficeId, ...(cur.active !== active ? statusData(active, actor) : {}) } });
            if (!cur || cur.divisionId !== data.divisionId || cur.areaId !== data.areaId) await rebuildAccess(tx, "groups");
          },
        });
      }
      break;
    }
    case "lto": {
      const existing = await db.ltoOffice.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.ltoOffice,
          { code: row.cells.code, name: row.cells.name, city: row.cells.city ?? "", distanceKm: row.cells.distance_km ?? "", travelHours: row.cells.travel_hours ?? "", suggestedTransport: row.cells.suggested_transport ?? "" },
          { code: "code", name: "name", city: "city", distanceKm: "distance_km", travelHours: "travel_hours", suggestedTransport: "suggested_transport" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Name", city: "Area or city", distanceKm: "Usual distance", travelHours: "Usual travel time", suggestedTransportCents: "Suggested transport", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.ltoOffice.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.ltoOffice.update({ where: { id: cur.id }, data: { name: data.name, city: data.city, distanceKm: data.distanceKm, travelHours: data.travelHours, suggestedTransportCents: data.suggestedTransportCents, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "loan-types": {
      const existing = await db.loanType.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const cur = existing.find((b) => b.code.toLowerCase() === lower(row.cells.code)) ?? null;
        if (!cur) row.bad("code", `"${row.cells.code}" is not a MyLoans loan type. Loan types cannot be added; use New or Renewal.`);
        const data = validate(row, SETTINGS_SCHEMAS.loanType, { name: row.cells.name, description: row.cells.description ?? "" }, { name: "name", description: "description" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || !cur || row.problems.length) { finish(row, row.cells.code ?? "", null); continue; }
        const lim = counter.change(cur.active, active);
        if (lim) { row.bad("status", lim); finish(row, cur.code, null); continue; }
        const changes = diff({ name: "Display name", description: "Description", active: "Status" }, cur, { ...data, active });
        finish(row, cur.code, {
          action: changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            await tx.loanType.update({ where: { id: cur.id }, data: { ...data, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "transaction-types": {
      const existing = await db.transactionType.findMany();
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const needs = yesNo(row.cells.needs_processor);
        if (needs === "bad") row.bad("needs_processor", "type Yes or No.");
        // Blank keeps the current setting (older files have no needs_lto column).
        const ltoCell = (row.cells.needs_lto ?? "").trim();
        const lto = ltoCell ? yesNo(ltoCell) : cur?.needsLto ?? false;
        if (lto === "bad") row.bad("needs_lto", "type Yes or No.");
        const data = validate(row, SETTINGS_SCHEMAS.transactionType,
          { code: row.cells.code, name: row.cells.name, description: cur?.description ?? "", ownerRole: (row.cells.done_by ?? "").toUpperCase(), requiresDp: needs === true, sortOrder: row.cells.order, needsLto: lto === true },
          { code: "code", name: "name", ownerRole: "done_by", requiresDp: "needs_processor", sortOrder: "order", needsLto: "needs_lto" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (cur?.builtIn && !active) row.bad("status", "the four built-in transaction types are always active.");
        if (!data || needs === "bad" || lto === "bad" || row.problems.length) { finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Name", ownerRole: "Done by", requiresDp: "Needs a processor", needsLto: "Needs LTO processing", sortOrder: "Order", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.transactionType.create({ data: { ...data, builtIn: false, ...statusData(active, actor) } });
            else await tx.transactionType.update({ where: { id: cur.id }, data: { name: data.name, ownerRole: data.ownerRole, requiresDp: data.requiresDp, needsLto: data.needsLto, sortOrder: data.sortOrder, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "document-types": {
      const existing = await db.documentType.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.documentType,
          { code: row.cells.code, name: row.cells.name, defaultOriginality: ORIG[lower(row.cells.original_or_copy)] ?? row.cells.original_or_copy, notes: row.cells.notes ?? "" },
          { code: "code", name: "name", defaultOriginality: "original_or_copy", notes: "notes" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Name", defaultOriginality: "Original or copy", notes: "Notes", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.documentType.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.documentType.update({ where: { id: cur.id }, data: { name: data.name, defaultOriginality: data.defaultOriginality, notes: data.notes, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "checklist": {
      const [types, docs, rules] = await Promise.all([db.transactionType.findMany(), db.documentType.findMany(), db.checklistRule.findMany({ include: { transactionType: true, documentType: true } })]);
      const keyOf = (t: string, d: string, label: string) => `${t}|${d}|${label}`.toLowerCase();
      const ruleKey = new Map(rules.map((r) => [keyOf(r.transactionType.code, r.documentType.code, r.label), r]));
      for (const row of rows) {
        const tcode = (row.cells.transaction_code ?? "").toUpperCase();
        const dcode = (row.cells.document_code ?? "").toUpperCase();
        const tt = types.find((t) => t.code === tcode);
        const doc = docs.find((d) => d.code === dcode);
        if (!tt) row.bad("transaction_code", tcode ? `no transaction type has the code ${tcode}.` : "is required.");
        if (!doc) row.bad("document_code", dcode ? `no document type has the code ${dcode}.` : "is required.");
        const label = (row.cells.paper ?? "").trim() || doc?.name || "";
        const key = keyOf(tcode, dcode, label);
        const cur = ruleKey.get(key) ?? null;
        const required = yesNo(row.cells.required);
        if (required === "bad") row.bad("required", "type Yes or No.");
        // Blank keeps the current value (No for a new row).
        const reusableCell = (row.cells.reusable ?? "").trim() ? yesNo(row.cells.reusable) : (cur?.reusable ?? false);
        if (reusableCell === "bad") row.bad("reusable", "type Yes or No.");
        const oc = ORIG[lower(row.cells.original_or_copy)];
        const raw = {
          transactionTypeId: tt?.id ?? "", documentTypeId: doc?.id ?? "", label,
          required: required === true, reusable: reusableCell === true, oneOfGroup: row.cells.pick_one_group ?? "",
          originality: oc === "EITHER" ? "EITHER" : oc ?? row.cells.original_or_copy, sortOrder: row.cells.order,
        };
        const map = { transactionTypeId: "transaction_code", documentTypeId: "document_code", label: "paper", required: "required", reusable: "reusable", oneOfGroup: "pick_one_group", originality: "original_or_copy", sortOrder: "order" };
        const data = tt && doc ? validate(row, SETTINGS_SCHEMAS.checklistRule, raw, map) : null;
        if (data) await dbRule(row, "checklistRule", cur?.id ?? null, data, db, map);
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || required === "bad" || reusableCell === "bad" || row.problems.length) { finish(row, key, null); continue; }
        const changes = cur ? diff({ originality: "Original or copy", required: "Required", reusable: "Belongs to the borrower", oneOfGroup: "Pick-one group", sortOrder: "Order", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, key, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.checklistRule.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.checklistRule.update({ where: { id: cur.id }, data: { required: data.required, reusable: data.reusable, kind: data.kind, oneOfGroup: data.oneOfGroup, originality: data.originality, sortOrder: data.sortOrder, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "tat": {
      const existing = await db.tatRule.findMany();
      for (const row of rows) {
        const cur = existing.find((t) => t.key.toLowerCase() === lower(row.cells.key)) ?? null;
        if (!cur) row.bad("key", `"${row.cells.key}" is not a step key. Steps are fixed; use Download current data to see them.`);
        const data = validate(row, SETTINGS_SCHEMAS.tat, { businessDays: row.cells.business_days, note: row.cells.display_note ?? "" }, { businessDays: "business_days", note: "display_note" });
        if (!data || !cur || row.problems.length) { finish(row, row.cells.key ?? "", null); continue; }
        const changes = diff({ businessDays: "Business days", note: "Display note" }, cur, data);
        finish(row, cur.key, {
          action: changes.length ? "changed" : "unchanged", changes,
          apply: async (tx) => { await tx.tatRule.update({ where: { id: cur.id }, data }); },
        });
      }
      break;
    }
    case "holidays": {
      const existing = await db.holidayCalendar.findMany();
      for (const row of rows) {
        const cur = existing.find((h) => h.date === (row.cells.date ?? "").trim()) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.holiday, { date: row.cells.date, name: row.cells.name }, { date: "date", name: "name" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, row.cells.date ?? "", null); continue; }
        const changes = cur ? diff({ name: "Holiday name", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.date, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.holidayCalendar.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.holidayCalendar.update({ where: { id: cur.id }, data: { name: data.name, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "cash-advance": {
      const [types, rules, kinds] = await Promise.all([db.transactionType.findMany(), db.cashAdvanceRule.findMany({ include: { transactionType: true } }), db.expenseKind.findMany()]);
      for (const row of rows) {
        const tcode = (row.cells.transaction_code ?? "").toUpperCase();
        const tt = types.find((t) => t.code === tcode);
        if (!tt) row.bad("transaction_code", tcode ? `no transaction type has the code ${tcode}.` : "is required.");
        // The kind by its code or its name (ignoring capitals and spaces).
        const typedKind = (row.cells.kind ?? "").trim();
        const kindRow = kinds.find((k) => k.code === typedKind.toUpperCase()) ?? kinds.find((k) => k.nameKey === nameKey(typedKind));
        if (typedKind && !kindRow) row.bad("kind", `no expense kind is called "${typedKind}". Use a name or code from Settings, Expense kinds.`);
        const kind = kindRow?.code ?? typedKind.toUpperCase();
        const key = `${tcode}|${kind}`;
        const cur = rules.find((r) => `${r.transactionType.code}|${r.kind}` === key) ?? null;
        const map = { transactionTypeId: "transaction_code", kind: "kind", purpose: "purpose", suggestedAmount: "suggested_amount", maxAmount: "max_amount" };
        const num = (v?: string) => (v ?? "").replace(/,/g, "");
        const data = tt && (kindRow || !typedKind) ? validate(row, SETTINGS_SCHEMAS.caRule, { transactionTypeId: tt.id, kind, purpose: row.cells.purpose, suggestedAmount: num(row.cells.suggested_amount), maxAmount: num(row.cells.max_amount) }, map) : null;
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (data && !row.problems.length) await dbRule(row, "caRule", cur?.id ?? null, data as unknown as Record<string, unknown>, db, { ...map, expenseKind: "kind" });
        if (!data || row.problems.length) { finish(row, key, null); continue; }
        const changes = cur
          ? diff({ purpose: "Purpose", suggestedAmount: "Suggested amount", maxAmount: "Maximum per transaction", active: "Status" },
              { ...cur, suggestedAmount: cur.suggestedAmount === null ? "" : Number(cur.suggestedAmount), maxAmount: Number(cur.maxAmount) }, { ...data, suggestedAmount: data.suggestedAmount ?? "", active })
          : [];
        finish(row, key, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.cashAdvanceRule.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.cashAdvanceRule.update({ where: { id: cur.id }, data: { purpose: data.purpose, suggestedAmount: data.suggestedAmount, maxAmount: data.maxAmount, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "problem-reasons": {
      const existing = await db.problemReason.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.problemReason, { code: row.cells.code, name: row.cells.name, sortOrder: row.cells.order }, { code: "code", name: "name", sortOrder: "order" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Reason", sortOrder: "Order", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.problemReason.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.problemReason.update({ where: { id: cur.id }, data: { name: data.name, sortOrder: data.sortOrder, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "funds-types": {
      const existing = await db.fundsType.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      const flag = (row: (typeof rows)[number], col: string, cur: boolean | undefined, fallback: boolean) => {
        const cell = (row.cells[col] ?? "").trim();
        const v = cell ? yesNo(cell) : cur ?? fallback;
        if (v === "bad") row.bad(col, "type Yes or No.");
        return v;
      };
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const ref = flag(row, "needs_reference", cur?.needsReference, false);
        const acc = flag(row, "needs_account", cur?.needsAccount, false);
        const liq = flag(row, "must_liquidate", cur?.mustLiquidate, true);
        const data = validate(row, SETTINGS_SCHEMAS.fundsType,
          { code: row.cells.code, name: row.cells.name, sortOrder: row.cells.order, needsReference: ref === true, needsAccount: acc === true, mustLiquidate: liq === true },
          { code: "code", name: "name", sortOrder: "order", needsReference: "needs_reference", needsAccount: "needs_account", mustLiquidate: "must_liquidate" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || ref === "bad" || acc === "bad" || liq === "bad" || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Name", sortOrder: "Order", needsReference: "Release needs a reference number", needsAccount: "Release needs receiving account details", mustLiquidate: "Must be liquidated with receipts", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.fundsType.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.fundsType.update({ where: { id: cur.id }, data: { name: data.name, sortOrder: data.sortOrder, needsReference: data.needsReference, needsAccount: data.needsAccount, mustLiquidate: data.mustLiquidate, proposed: false, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "expense-kinds": {
      const existing = await db.expenseKind.findMany();
      const MODES: Record<string, AmountMode | undefined> = { "person enters": "TYPED", "person enters it": "TYPED", typed: "TYPED", suggested: "SUGGESTED", fixed: "FIXED" };
      const codes = existing.map((k) => k.code);
      for (const row of rows) {
        const name = (row.cells.name ?? "").trim();
        const cur = existing.find((k) => k.nameKey === nameKey(name)) ?? null;
        const modeCell = lower(row.cells.amount_mode);
        const mode: AmountMode | "bad" = modeCell === "" ? ((cur?.amountMode as AmountMode | undefined) ?? "TYPED") : MODES[modeCell] ?? "bad";
        if (mode === "bad") row.bad("amount_mode", "type Person enters, Suggested or Fixed.");
        const amountCell = (row.cells.amount ?? "").trim();
        const amount = amountCell === "" && modeCell === "" && cur?.amountCents != null ? (cur.amountCents / 100).toFixed(2) : amountCell;
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (cur?.code === OTHER && active === false) row.bad("status", "Other is built in: it is always active.");
        let data: Awaited<ReturnType<typeof checkKind>> | null = null;
        if (mode !== "bad") {
          try { data = await checkKind(db, cur?.id ?? null, { name: cur?.code === OTHER ? cur.name : name, amountMode: mode, amount }); } catch (e) {
            if (!(e instanceof UserError)) throw e;
            row.bad(e.field === "amount" ? "amount" : e.field === "amountMode" ? "amount_mode" : "name", e.message.replace(/^./, (c) => c.toLowerCase()));
          }
        }
        if (!data || row.problems.length) { finish(row, nameKey(name), null); continue; }
        const d = data;
        const changes = cur ? diff({ amount: "Amount", active: "Status" }, { amount: amountModeText(cur.amountMode as AmountMode, cur.amountCents), active: cur.active }, { amount: amountModeText(d.amountMode, d.amountCents), active }) : [];
        finish(row, d.nameKey, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) {
              const code = codeFromName(d.name, codes);
              codes.push(code);
              const sortOrder = Math.max(0, ...sortKinds(await tx.expenseKind.findMany()).filter((k) => k.code !== OTHER).map((k) => k.sortOrder)) + 1;
              await tx.expenseKind.create({ data: { code, name: d.name, nameKey: d.nameKey, amountMode: d.amountMode, amountCents: d.amountCents, sortOrder, ...statusData(active, actor) } });
            } else {
              await tx.expenseKind.update({ where: { id: cur.id }, data: { amountMode: d.amountMode, amountCents: d.amountCents, ...(cur.active !== active ? statusData(active, actor) : {}) } });
            }
          },
        });
      }
      break;
    }
    case "hold-reasons": {
      const existing = await db.holdReason.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.holdReason, { code: row.cells.code, name: row.cells.name, sortOrder: row.cells.order }, { code: "code", name: "name", sortOrder: "order" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Reason", sortOrder: "Order", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.holdReason.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.holdReason.update({ where: { id: cur.id }, data: { name: data.name, sortOrder: data.sortOrder, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "return-reasons": {
      const existing = await db.returnReason.findMany();
      const counter = new ActiveCounter(existing.filter((b) => b.active).length);
      for (const row of rows) {
        const code = (row.cells.code ?? "").toUpperCase();
        const cur = existing.find((b) => b.code === code) ?? null;
        const data = validate(row, SETTINGS_SCHEMAS.returnReason, { code: row.cells.code, name: row.cells.name, sortOrder: row.cells.order }, { code: "code", name: "name", sortOrder: "order" });
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, code, null); continue; }
        const lim = counter.change(cur ? cur.active : null, active);
        if (lim) { row.bad("status", lim); finish(row, code, null); continue; }
        const changes = cur ? diff({ name: "Reason", sortOrder: "Order", active: "Status" }, cur, { ...data, active }) : [];
        finish(row, data.code, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            if (!cur) await tx.returnReason.create({ data: { ...data, ...statusData(active, actor) } });
            else await tx.returnReason.update({ where: { id: cur.id }, data: { name: data.name, sortOrder: data.sortOrder, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "processing-stages": {
      const [types, existing] = await Promise.all([db.transactionType.findMany(), db.processingStage.findMany({ include: { type: true } })]);
      for (const row of rows) {
        const tcode = (row.cells.transaction_code ?? "").toUpperCase();
        const code = (row.cells.code ?? "").trim().toUpperCase();
        const tt = types.find((t) => t.code === tcode);
        if (!tt) row.bad("transaction_code", tcode ? `no transaction type has the code ${tcode}.` : "is required.");
        const key = `${tcode}|${code}`;
        const cur = existing.find((x) => x.type.code === tcode && x.code === code) ?? null;
        const parsed = fieldsFromText(row.cells.evidence_fields ?? "", (cur?.fields as unknown as EvidenceField[] | undefined) ?? []);
        if (!parsed.ok) row.bad("evidence_fields", parsed.error);
        const map = { typeId: "transaction_code", code: "code", name: "name", sortOrder: "order", targetDays: "target_days", fields: "evidence_fields" };
        const data = tt && parsed.ok
          ? validate(row, SETTINGS_SCHEMAS.processingStage, { typeId: tt.id, code: row.cells.code, name: row.cells.name, sortOrder: row.cells.order, targetDays: row.cells.target_days ?? "", fields: JSON.stringify(parsed.fields) }, map)
          : null;
        if (data) await dbRule(row, "processingStage", cur?.id ?? null, data as unknown as Record<string, unknown>, db, map);
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        if (!data || row.problems.length) { finish(row, key, null); continue; }
        const changes = cur ? diff({ name: "Stage name", sortOrder: "Order", targetDays: "Target", fieldsText: "Evidence fields", active: "Status" }, { ...cur, fieldsText: fieldsToText(cur.fields as unknown as EvidenceField[]) }, { ...data, fieldsText: fieldsToText(data.fields), active }) : [];
        finish(row, key, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            const fields = data.fields as unknown as Prisma.InputJsonValue;
            if (!cur) await tx.processingStage.create({ data: { typeId: data.typeId, code: data.code, name: data.name, sortOrder: data.sortOrder, targetDays: data.targetDays, fields, ...statusData(active, actor) } });
            else await tx.processingStage.update({ where: { id: cur.id }, data: { name: data.name, sortOrder: data.sortOrder, targetDays: data.targetDays, fields, ...(cur.active !== active ? statusData(active, actor) : {}) } });
          },
        });
      }
      break;
    }
    case "users": {
      const [users, roles, branches] = await Promise.all([db.user.findMany({ include: { role: true, accessGrants: true } }), db.role.findMany(), db.branch.findMany()]);
      const codeOf = new Map(branches.map((b) => [b.id, b.code ?? b.name]));
      // Lock-out (lib/services/lockout.ts), row after row: someone active keeps "Manage roles" and "Change branch access".
      let snap = await loadSnapshot(db);
      const mayAccess = can(user, PERMISSIONS.ACCESS_MANAGE);
      for (const row of rows) {
        const email = lower(row.cells.email);
        const cur = users.find((u) => u.email === email) ?? null;
        // Role by name (any case); the old role keys (LA, ADMIN, DP ...) still work.
        const typed = (row.cells.role ?? "").trim().toLowerCase();
        const role = roles.find((r) => r.name.toLowerCase() === typed) ?? roles.find((r) => r.key.toLowerCase() === typed);
        if (!role) row.bad("role", typed ? `no role is called "${row.cells.role}". Use a role name from Settings > Roles and access.` : "is required.");
        // "ALL", or single branches (codes). Area and Division grants and exceptions are kept as they are.
        const codes = (row.cells.branches ?? "").split(";").map((c) => c.trim().toUpperCase()).filter(Boolean);
        const allBranches = codes.length === 1 && codes[0] === "ALL";
        const keepBranches = codes.length === 0;
        const branchIds: string[] = [];
        if (!allBranches) for (const c of codes) {
          const b = branches.find((x) => x.code === c);
          if (!b) row.bad("branches", `no branch has the code ${c}.`);
          else if (b.hidden) row.bad("branches", `${b.name} (${c}) is hidden from the DMS.`);
          else branchIds.push(b.id);
        }
        const homeCode = (row.cells.home_branch ?? "").trim();
        const home = homeCode ? branches.find((x) => x.code === homeCode) ?? null : null;
        if (homeCode && !home) row.bad("home_branch", `no branch has the code ${homeCode}.`);
        const s = statusOf(row.cells.status);
        if (s === "bad") row.bad("status", "type Active or Inactive.");
        const active = s === "bad" || s === null ? cur?.active ?? true : s;
        const data = validate(row, USER_SCHEMA, { name: row.cells.name, email: row.cells.email, roleId: role?.id ?? "(unknown)", active }, { name: "name", email: "email", roleId: "role", active: "status" });
        const groups = (cur?.accessGrants ?? []).filter((g) => g.kind !== "BRANCH" || g.exclude).map((g) => ({ kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude }));
        const curBranchIds = (cur?.accessGrants ?? []).filter((g) => g.kind === "BRANCH" && !g.exclude).map((g) => g.branchId!);
        const access: AccessInput = allBranches
          ? { all: true, grants: [], homeBranchId: home?.id ?? cur?.homeBranchId ?? null }
          : keepBranches && cur
            ? { all: cur.allBranches, grants: [...groups, ...branchGrants(curBranchIds)], homeBranchId: home?.id ?? cur.homeBranchId }
            : keepBranches
              ? { all: role?.branchAccess === "ALL", grants: [], homeBranchId: home?.id ?? null }
              : { all: false, grants: [...groups, ...branchGrants(branchIds)], homeBranchId: home?.id ?? (cur?.homeBranchId && branchIds.includes(cur.homeBranchId) ? cur.homeBranchId : null) };
        if (role && !row.problems.length) {
          try {
            await checkAccess(db, role, access, cur ? { grants: cur.accessGrants, homeBranchId: cur.homeBranchId } : null);
          } catch (e) {
            if (!(e instanceof UserError)) throw e;
            row.bad(e.field === "homeBranchId" ? "home_branch" : "branches", e.message.replace(/^./, (c) => c.toLowerCase()));
          }
        }
        if (role && !role.active && cur?.roleId !== role.id) row.bad("role", `${role.name} is inactive. Use an active role.`);
        if (cur && cur.id === user.id) {
          if (!active) row.bad("status", "you cannot make yourself inactive.");
          if (role && can(user, PERMISSIONS.ROLES_MANAGE) && !effectivePermissions(role).has(PERMISSIONS.ROLES_MANAGE)) row.bad("role", "you cannot take \"Manage roles\" away from yourself.");
        }
        if (cur && role) {
          const change = { kind: "user" as const, userId: cur.id, roleId: role.id, active };
          const why = lockoutRefusal(snap, change);
          if (why) row.bad(active ? "role" : "status", why.replace(/^./, (c) => c.toLowerCase()));
          else snap = applyChange(snap, change);
        }
        if (!data || !role || row.problems.length) { finish(row, email, null); continue; }
        const codesText = (all: boolean, ids: string[]) => (all ? "ALL" : ids.map((x) => codeOf.get(x) ?? x).sort().join(";"));
        const beforeBranches = cur ? codesText(cur.allBranches, curBranchIds) : "";
        const afterBranches = codesText(access.all, access.grants.filter((g) => g.kind === "BRANCH" && !g.exclude).map((g) => g.branchId!));
        if (!mayAccess && (cur ? afterBranches !== beforeBranches || (access.homeBranchId ?? null) !== (cur.homeBranchId ?? null) && !!homeCode : !keepBranches || !!homeCode)) {
          row.bad("branches", "your role cannot change branch access. Ask an Admin to turn on \"Change branch access\" for your role.");
          finish(row, email, null); continue;
        }
        const changes = cur
          ? diff({ name: "Name", roleId: "Role", branches: "Branches", home: "Home branch", active: "Status" },
            { ...cur, branches: beforeBranches, home: cur.homeBranchId ? codeOf.get(cur.homeBranchId) ?? "" : "" },
            { name: data.name, roleId: role.id, branches: afterBranches, home: access.homeBranchId ? codeOf.get(access.homeBranchId) ?? "" : cur.homeBranchId ? codeOf.get(cur.homeBranchId) ?? "" : "", active })
          : [];
        finish(row, data.email, {
          action: !cur ? "new" : changes.length ? "changed" : "unchanged", changes,
          apply: async (tx, actor) => {
            // Never sets passwords or sign-in; new users are kept as test users like the Add user form.
            const saved = cur
              ? await tx.user.update({ where: { id: cur.id }, data: { name: data.name, roleId: role.id, ...(cur.active !== active ? statusData(active, actor) : {}) } })
              : await tx.user.create({ data: { name: data.name, email: data.email, roleId: role.id, isTestUser: true, ...statusData(active, actor) } });
            await applyAccess(tx, { id: actor.id, label: user.name }, saved.id, role, access, { isNew: !cur });
          },
        });
      }
      break;
    }
  }
  return { planned, problems };
}

function toPlan(list: ImportListKey, fileName: string, planned: Planned[], problems: Row[]): ImportPlan {
  const rows: PlanRow[] = [
    ...planned.map((p) => ({ line: p.row.line, key: p.key, action: p.action, problems: [], changes: p.changes, cells: p.row.cells })),
    ...problems.map((r) => ({ line: r.line, key: "", action: "problem" as const, problems: r.problems, changes: [], cells: r.cells })),
  ].sort((a, b) => a.line - b.line);
  const counts = {
    new: planned.filter((p) => p.action === "new").length,
    changed: planned.filter((p) => p.action === "changed").length,
    unchanged: planned.filter((p) => p.action === "unchanged").length,
    problem: problems.length,
  };
  return { ok: true, list, fileName, rows, counts };
}

function requireListPermission(user: CurrentUser, list: ImportListKey) {
  // Import needs "Import data" and the permission to change that list.
  if (!can(user, LIST_PERMISSION[list]) || !can(user, PERMISSIONS.SETTINGS_IMPORT)) throw new UserError("Your role does not allow importing this list.");
}

/** Check file: what would happen. Nothing is saved. */
export async function checkImport(user: CurrentUser, list: ImportListKey, fileName: string, text: string): Promise<ImportPlan> {
  requireListPermission(user, list);
  if (!IMPORT_LISTS[list]) return { ok: false, error: "This list cannot be imported." };
  const read = readImportFile(list, text);
  if ("error" in read) return { ok: false, error: read.error };
  const { planned, problems } = await planList(list, read.records, prisma as unknown as Db, user);
  return toPlan(list, fileName, planned, problems);
}

/**
 * Import: checks the file again on the server (never trusts the preview), then applies the valid
 * rows in one transaction. Matching by each list's key: new keys are added, existing keys updated.
 * Nothing is ever deleted; rows not in the file stay as they are. One audit row per import.
 */
export async function runImport(user: CurrentUser, list: ImportListKey, fileName: string, text: string): Promise<ImportPlan> {
  requireListPermission(user, list);
  const read = readImportFile(list, text);
  if ("error" in read) return { ok: false, error: read.error };
  const name = fileName.slice(0, 200) || "file.csv";
  try {
    return await prisma.$transaction(async (tx) => {
      const { planned, problems } = await planList(list, read.records, tx, user);
      const actor = { id: user.id };
      for (const p of planned) if (p.action !== "unchanged") await p.apply(tx, actor);
      const plan = toPlan(list, name, planned, problems);
      if (!plan.ok) return plan;
      const c = plan.counts;
      await writeAudit(tx, {
        actor: { id: user.id, label: user.name }, mode: "MANUAL", action: "settings_imported", entityType: list, entityId: null,
        summary: `Imported ${IMPORT_LISTS[list].title} from ${name}: ${c.new} new, ${c.changed} updated, ${c.unchanged} unchanged, ${c.problem} skipped`,
        details: { file: name, list, counts: c, skipped: plan.rows.filter((r) => r.action === "problem").map((r) => r.problems).flat().slice(0, 50) },
      });
      return plan;
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Someone changed this list while you were importing (a code or name is now used twice). Nothing was saved. Check the file again." };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Export: template and current data (same columns)
// ---------------------------------------------------------------------------

export function templateCsv(list: ImportListKey): string {
  const def = IMPORT_LISTS[list];
  return toCsv(def.columns.map((c) => c.name), def.examples);
}

export async function currentDataRows(list: ImportListKey): Promise<Record<string, string>[]> {
  switch (list) {
    case "branches":
      return (await prisma.branch.findMany({ orderBy: { name: "asc" }, include: { division: true, area: true, usualLtoOffice: true } })).map((b) => ({
        code: b.code ?? "", name: b.name, division: b.division?.name ?? "", area: b.area?.name ?? "", address: b.address, usual_lto_office: b.usualLtoOffice?.code ?? "",
        status: st(b.active), notes: [b.source === "MYLOANS" ? "From MyLoans" : "Made in the DMS", b.code ? "" : "Code needed", b.hidden ? "Hidden from DMS" : ""].filter(Boolean).join("; "),
      }));
    case "lto":
      return (await prisma.ltoOffice.findMany({ orderBy: { name: "asc" } })).map((b) => ({
        code: b.code, name: b.name, city: b.city, distance_km: b.distanceKm == null ? "" : String(b.distanceKm), travel_hours: b.travelHours == null ? "" : String(b.travelHours),
        suggested_transport: b.suggestedTransportCents == null ? "" : (b.suggestedTransportCents / 100).toFixed(2), status: st(b.active), notes: "",
      }));
    case "loan-types":
      return (await prisma.loanType.findMany({ orderBy: { code: "asc" } })).map((b) => ({ code: b.code, name: b.name, description: b.description, status: st(b.active), notes: "" }));
    case "transaction-types":
      return (await prisma.transactionType.findMany({ orderBy: { sortOrder: "asc" } })).map((t) => ({ code: t.code, name: t.name, done_by: t.ownerRole, needs_processor: yn(t.requiresDp), needs_lto: yn(t.needsLto), order: String(t.sortOrder), status: st(t.active), notes: t.builtIn ? "Built-in" : "" }));
    case "document-types":
      return (await prisma.documentType.findMany({ orderBy: { name: "asc" } })).map((d) => ({ code: d.code, name: d.name, original_or_copy: ORIG_TEXT[d.defaultOriginality], status: st(d.active), notes: d.notes }));
    case "checklist":
      return (await prisma.checklistRule.findMany({ include: { transactionType: true, documentType: true }, orderBy: [{ transactionType: { sortOrder: "asc" } }, { sortOrder: "asc" }] })).map((r) => ({
        transaction_code: r.transactionType.code, document_code: r.documentType.code, paper: r.label, original_or_copy: ORIG_TEXT[r.originality],
        required: yn(r.required), reusable: yn(r.reusable), pick_one_group: r.oneOfGroup ?? "", order: String(r.sortOrder), status: st(r.active), notes: "",
      }));
    case "tat":
      return (await prisma.tatRule.findMany({ orderBy: [{ phase: "asc" }, { step: "asc" }] })).map((t) => ({ key: t.key, step: `${t.step} ${t.label}`, business_days: String(t.businessDays), display_note: t.note, notes: "" }));
    case "holidays":
      return (await prisma.holidayCalendar.findMany({ orderBy: { date: "asc" } })).map((h) => ({ date: h.date, name: h.name, status: st(h.active), notes: "" }));
    case "cash-advance":
      return (await prisma.cashAdvanceRule.findMany({ include: { transactionType: true }, orderBy: { createdAt: "asc" } })).map((r) => ({
        transaction_code: r.transactionType.code, kind: r.kind, purpose: r.purpose, suggested_amount: r.suggestedAmount === null ? "" : String(Number(r.suggestedAmount)), max_amount: String(Number(r.maxAmount)),
        status: st(r.active), notes: "",
      }));
    case "problem-reasons":
      return (await prisma.problemReason.findMany({ orderBy: { sortOrder: "asc" } })).map((r) => ({ code: r.code, name: r.name, order: String(r.sortOrder), status: st(r.active), notes: "" }));
    case "funds-types":
      return (await prisma.fundsType.findMany({ orderBy: { sortOrder: "asc" } })).map((r) => ({
        code: r.code, name: r.name, order: String(r.sortOrder), needs_reference: yn(r.needsReference), needs_account: yn(r.needsAccount), must_liquidate: yn(r.mustLiquidate),
        status: st(r.active), notes: r.proposed ? "Proposed, to be confirmed with Finance" : "",
      }));
    case "expense-kinds":
      return sortKinds(await prisma.expenseKind.findMany()).map((k) => ({
        name: k.name, amount_mode: k.amountMode === "FIXED" ? "Fixed" : k.amountMode === "SUGGESTED" ? "Suggested" : "Person enters",
        amount: k.amountCents === null ? "" : (k.amountCents / 100).toFixed(2), status: st(k.active), notes: k.builtIn ? "Built-in: used when nothing else fits" : "",
      }));
    case "hold-reasons":
      return (await prisma.holdReason.findMany({ orderBy: { sortOrder: "asc" } })).map((r) => ({ code: r.code, name: r.name, order: String(r.sortOrder), status: st(r.active), notes: "" }));
    case "return-reasons":
      return (await prisma.returnReason.findMany({ orderBy: { sortOrder: "asc" } })).map((r) => ({ code: r.code, name: r.name, order: String(r.sortOrder), status: st(r.active), notes: "" }));
    case "processing-stages":
      return (await prisma.processingStage.findMany({ include: { type: true }, orderBy: [{ type: { sortOrder: "asc" } }, { sortOrder: "asc" }] })).map((r) => ({
        transaction_code: r.type.code, code: r.code, name: r.name, order: String(r.sortOrder), evidence_fields: fieldsToText(r.fields as unknown as EvidenceField[]),
        target_days: r.targetDays === null ? "" : String(r.targetDays), status: st(r.active), notes: "",
      }));
    case "users":
      return (await prisma.user.findMany({ include: { role: true, homeBranch: true, accessGrants: { include: { branch: true, area: true, division: true } } }, orderBy: { name: "asc" } })).map((u) => {
        const groups = u.accessGrants.filter((g) => g.kind !== "BRANCH").map((g) => (g.kind === "AREA" ? `area ${g.area?.name ?? ""}${g.division ? ` (${g.division.name})` : ""}` : `division ${g.division?.name ?? ""}`));
        const except = u.accessGrants.filter((g) => g.kind === "BRANCH" && g.exclude).map((g) => g.branch?.code ?? g.branch?.name ?? "");
        return {
          name: u.name, email: u.email, role: u.role.name,
          branches: u.allBranches ? "ALL" : u.accessGrants.filter((g) => g.kind === "BRANCH" && !g.exclude).map((g) => g.branch?.code ?? g.branch?.name ?? "").sort().join(";"),
          home_branch: u.homeBranch?.code ?? "", status: st(u.active),
          notes: groups.length ? `Also ${groups.join(", ")}${except.length ? ` except ${except.join(";")}` : ""} (set in Users, Edit)` : "",
        };
      });
  }
}

export async function currentDataCsv(list: ImportListKey): Promise<string> {
  const def = IMPORT_LISTS[list];
  return toCsv(def.columns.map((c) => c.name), await currentDataRows(list));
}
