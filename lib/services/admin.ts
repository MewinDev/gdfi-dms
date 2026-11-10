import { FIELD_TYPES, fieldKey, type EvidenceField } from "@/lib/stages/rules";
import { STEP_KEY, TYPE_ID, TYPE_NOUN } from "@/lib/funds/access";
import { refuseInProduction } from "@/lib/env";
import "server-only";
import { checkPn } from "@/lib/pn";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { KIND_PERMISSION, PERMISSIONS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { setSetting, getSetting, type SettingKey } from "@/lib/settings";
import { UserError } from "./errors";
import { isTestMode } from "@/lib/test-mode";
import { inactiveRefusal } from "./settings-status";
import { checkLockout } from "./lockout";
import { applyAccess, branchGrants, parseAccess, type AccessInput } from "./access";
import { rebuildAccess } from "@/lib/branches/access";
import { KIND_SCHEMA, saveExpenseKind } from "./expense-kinds";
import { decimalToCents, peso } from "@/lib/funds/rules";

const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });

function firstIssue(e: z.ZodError): UserError {
  const i = e.issues[0];
  return new UserError(i.message, String(i.path[0] ?? ""));
}

const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const int = (label: string, min = 0, max = 365) =>
  z.coerce.number({ message: `${label} must be a whole number.` }).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);
const text = (label: string, max = 120) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const money = (label: string) => z.coerce.number({ message: `${label} must be a number.` }).positive(`${label} must be above 0.`);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const USER_SCHEMA = z.object({
  name: text("Name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").refine((e) => e.endsWith("@gdfi.ph"), "Use a @gdfi.ph email."),
  roleId: text("Role"),
  active: bool,
  /** Older callers and the users import: single-branch grants. The Users screen sends `access` instead. */
  branchIds: z.array(z.string()).optional(),
  /** Branch access (where the person works): { all, grants, homeBranchId } or its JSON. */
  access: z.unknown().optional(),
});

export const NO_ACCESS_MANAGE = "Ask an Admin to turn on \"Change branch access\" for your role.";

export async function saveUser(user: CurrentUser, id: string | null, raw: Record<string, unknown>) {
  if (!can(user, PERMISSIONS.USERS_EDIT)) throw new UserError("Your role does not allow adding or editing users.");
  const p = USER_SCHEMA.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const d = p.data;
  const role = await prisma.role.findUnique({ where: { id: d.roleId } });
  if (!role) throw new UserError("Pick a role.", "roleId");
  if (id && role.id !== (await prisma.user.findUnique({ where: { id }, select: { roleId: true } }))?.roleId && !role.active) {
    throw new UserError(`${role.name} is inactive. Pick an active role.`, "roleId");
  }
  if (!id && !role.active) throw new UserError(`${role.name} is inactive. Pick an active role.`, "roleId");
  if (id === user.id) {
    if (can(user, PERMISSIONS.ROLES_MANAGE) && !effectivePermissions(role).has(PERMISSIONS.ROLES_MANAGE)) {
      throw new UserError("You cannot take \"Manage roles\" away from yourself. Ask another person who can manage roles.", "roleId");
    }
  }
  if (id) {
    const cur = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!cur) throw new UserError("User not found.");
    // Making inactive: same hard limits as the button.
    if (cur.active && !d.active) {
      const refusal = await inactiveRefusal("user", { id, active: true }, user);
      if (refusal) throw new UserError(refusal, "active");
    }
    // Lock-out: someone active must keep "Manage roles" and "Change branch access".
    const why = await checkLockout({ kind: "user", userId: id, roleId: role.id, active: d.active });
    if (why) throw new UserError(why, d.active ? "roleId" : "active");
  }
  // Branch access is its own tick ("Change branch access"): without it the form sends none and keeps it.
  const sentAccess = (d.access !== undefined && d.access !== null && d.access !== "") || d.branchIds !== undefined;
  if (sentAccess && !can(user, PERMISSIONS.ACCESS_MANAGE)) throw new UserError(NO_ACCESS_MANAGE, "access");
  // Branch access: what the form sent; a new user without one gets the role's default (All, or none yet).
  const access: AccessInput | null = d.access !== undefined && d.access !== null && d.access !== ""
    ? parseAccess(d.access)
    : d.branchIds
      ? { all: false, grants: branchGrants(d.branchIds), homeBranchId: d.branchIds[0] ?? null }
      : id ? null : { all: role.branchAccess === "ALL", grants: [], homeBranchId: null };

  await prisma.$transaction(async (tx) => {
    const before = id ? await tx.user.findUnique({ where: { id }, include: { role: true } }) : null;
    if (id && !before) throw new UserError("User not found.");
    if (!id && (await tx.user.findUnique({ where: { email: d.email } }))) throw new UserError("A user with this email already exists.", "email");
    const saved = id
      ? await tx.user.update({
          where: { id },
          data: {
            name: d.name, roleId: role.id, active: d.active,
            ...(before && before.active !== d.active ? (d.active ? { deactivatedAt: null, deactivatedById: null } : { deactivatedAt: new Date(), deactivatedById: user.id }) : {}),
          },
        })
      : await tx.user.create({ data: { name: d.name, email: d.email, roleId: role.id, active: d.active, isTestUser: true } });
    if (before && before.active !== d.active) {
      await writeAudit(tx, {
        actor: actorOf(user), mode: "MANUAL", action: d.active ? "made_active" : "made_inactive", entityType: "user", entityId: saved.id,
        summary: `User ${saved.name} made ${d.active ? "active" : "inactive"}`, before: { active: before.active }, after: { active: d.active },
      });
    }
    // Where the person works: validated, written and audited on its own (who, before, after).
    const where = access ? await applyAccess(tx, actorOf(user), saved.id, role, access, { isNew: !id }) : null;
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: id ? "user_updated" : "user_created", entityType: "User", entityId: saved.id,
      summary: `${id ? "Updated" : "Added test"} user ${saved.email}`,
      before: before ? { name: before.name, role: before.role.name, active: before.active } : undefined,
      after: { name: d.name, role: role.name, active: d.active, ...(where ? { access: where.summary } : {}) },
    });
  }, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Settings (reference data). Every change is audited.
// ---------------------------------------------------------------------------

export type SettingsKind = "branch" | "transactionType" | "documentType" | "checklistRule" | "tat" | "loanType" | "ltoOffice" | "caRule" | "holiday" | "approvalBand" | "problemReason" | "holdReason" | "returnReason" | "processingStage" | "fundsType" | "expenseKind";

/** An optional number (blank means none), within limits. */
const optNumber = (label: string, min: number, max: number) => z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
  z.number({ message: `${label} must be a number.` }).min(min, `${label} cannot be below ${min}.`).max(max, `${label} is too large.`).nullable(),
);

/** Short codes: capitals (and digits after the first letter). */
export const codeOf = (label: string, min: number, max: number, hyphen = false) =>
  z.string().trim().toUpperCase()
    .min(min, `${label} must be at least ${min} characters.`).max(max, `${label} must be at most ${max} characters.`)
    .regex(hyphen ? /^[A-Z][A-Z0-9-]*$/ : /^[A-Z][A-Z0-9]*$/, `${label}: use capital letters${hyphen ? ", numbers and -" : " and numbers"}, no spaces.`);

const realDate = (d: string) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/**
 * Form rules for every Settings list. Import (lib/import) validates each file row with these same
 * schemas. Status (active / inactive) is not a form field: it changes only through Make inactive /
 * Make active (lib/services/settings-status.ts), which has the hard limits and the audit row.
 */
export const SETTINGS_SCHEMAS = {
  /**
   * A branch. Code: the 3-digit MyLoans code (100 to 999); blank only on an existing "Code needed" branch.
   * For a branch from MyLoans only the DMS fields (usual LTO office) may change (checkSettingsRow).
   */
  branch: z.object({
    code: z.string().trim().nullish().transform((s) => s || null)
      .refine((c) => c === null || /^[1-9]\d{2}$/.test(c), "The branch code must be 3 digits (100 to 999)."),
    name: text("Name"),
    address: z.string().trim().max(300, "The address is too long.").nullish().transform((s) => s ?? ""),
    divisionId: z.string().trim().nullish().transform((s) => s || null),
    areaId: z.string().trim().nullish().transform((s) => s || null),
    usualLtoOfficeId: z.string().trim().nullish().transform((s) => s || null),
  }),
  transactionType: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,12}$/, "Short code: 2 to 12 capital letters, no spaces or numbers."),
    name: text("Name"), description: z.string().max(300).default(""),
    ownerRole: z.enum(["LA", "DP"], { message: "Done by must be LA or DP." }), requiresDp: bool, sortOrder: int("Order", 0, 99),
    needsLto: bool.default(false),
  }).refine((t) => !t.needsLto || t.requiresDp, { message: "Needs LTO processing needs a processor: turn on Needs a processor first.", path: ["needsLto"] }),
  documentType: z.object({
    code: codeOf("Short code", 2, 12), name: text("Name"),
    defaultOriginality: z.enum(["ORIGINAL", "COPY", "EITHER"], { message: "Original or copy must be Original, Copy or Either." }),
    notes: z.string().trim().max(300, "Notes are too long.").default(""),
  }),
  // "Required" switch + optional pick-one group; the stored kind follows from them.
  // A change affects NEW loan files only (open loan files keep the flag copied when they were opened).
  checklistRule: z.object({
    transactionTypeId: text("Transaction type"), documentTypeId: text("Document type"), label: text("Paper"),
    required: bool,
    /** Belongs to the borrower: can be copied to a replacement PN. */
    reusable: bool.default(false),
    oneOfGroup: z.string().trim().max(60).nullish().transform((s) => s || null),
    originality: z.enum(["ORIGINAL", "COPY"], { message: "Original or copy must be Original or Copy." }), sortOrder: int("Order", 0, 99),
  }).transform((r) => ({ ...r, kind: (r.oneOfGroup ? "ONE_OF" : r.required ? "REQUIRED" : "OPTIONAL") as "REQUIRED" | "ONE_OF" | "OPTIONAL" })),
  tat: z.object({ businessDays: int("Business days", 0, 365), note: z.string().trim().max(80).default("") }),
  loanType: z.object({ name: text("Name"), description: z.string().max(300).default("") }),
  ltoOffice: z.object({
    code: codeOf("Code", 2, 20, true), name: text("Name"), city: z.string().trim().max(60).default(""),
    // Optional estimates (only to help the approver judge transport and time).
    distanceKm: optNumber("Usual distance (km)", 0, 1000),
    travelHours: optNumber("Usual travel time (hours)", 0, 48),
    suggestedTransport: optNumber("Suggested transport amount", 0, 1_000_000),
  }).transform(({ suggestedTransport, ...o }) => ({ ...o, suggestedTransportCents: suggestedTransport === null ? null : Math.round(suggestedTransport * 100) })),
  // One rule per transaction type and expense kind: optional suggested amount, maximum per transaction.
  caRule: z.object({
    transactionTypeId: text("Transaction type"),
    kind: z.string({ message: "Pick the expense kind." }).trim().min(1, "Pick the expense kind."),
    purpose: text("Purpose"),
    suggestedAmount: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), money("Suggested amount").nullable()),
    maxAmount: money("Maximum amount"),
  }).refine((r) => r.suggestedAmount === null || r.suggestedAmount <= r.maxAmount, { message: "Suggested amount cannot be above the maximum.", path: ["suggestedAmount"] }),
  /** Who approves a funds type, by amount (the band of that type with the highest "from" at or below the amount). */
  approvalBand: z.object({ fromAmount: z.coerce.number({ message: "Amount from must be a number." }).min(0, "Amount from cannot be below 0."), roleId: text("Approving role"), fundsTypeId: z.string().trim().default("fundstype_ca") })
    .transform((b) => ({ fromCents: Math.round(b.fromAmount * 100), roleId: b.roleId, fundsTypeId: b.fundsTypeId })),
  /** Problem reasons (also the result of an attempt that was not processed). */
  problemReason: z.object({ code: codeOf("Code", 2, 20, true), name: text("Name"), sortOrder: int("Order", 0, 99) }),
  /** Hold reasons (waiting on something that is not a fault). */
  holdReason: z.object({ code: codeOf("Code", 2, 20, true), name: text("Name"), sortOrder: int("Order", 0, 99) }),
  /** Funds types (Cash advance, Fund transfer): what Finance enters at release, and whether receipts are needed. */
  fundsType: z.object({
    code: codeOf("Short code", 2, 10), name: text("Name"), sortOrder: int("Order", 0, 99),
    needsReference: bool.default(false), needsAccount: bool.default(false), mustLiquidate: bool.default(true),
  }),
  /** Return reasons (the processor returns an accepted job to the LA for papers). */
  returnReason: z.object({ code: codeOf("Code", 2, 20, true), name: text("Name"), sortOrder: int("Order", 0, 99) }),
  /** Processing stages: the ordered stages of a transaction type (Settings > Processing stages). */
  processingStage: z.object({
    typeId: text("Transaction type"), name: text("Name"), code: codeOf("Short code", 2, 20, true), sortOrder: int("Order", 0, 99),
    targetDays: optNumber("Target (business days)", 0, 365).refine((n) => n === null || Number.isInteger(n), "Target: a whole number of business days."),
    fields: z.preprocess(
      (v) => { if (typeof v !== "string") return v ?? []; try { return JSON.parse(v || "[]"); } catch { return null; } },
      z.array(z.object({
        key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9]{0,29}$/).optional(),
        label: z.string().trim().min(1, "Each evidence field needs a label.").max(60, "Keep each field label under 60 characters."),
        type: z.enum(FIELD_TYPES, { message: "Pick the field type: text, date, number, file or tick." }),
        required: z.boolean(),
      }), { message: "The evidence fields could not be read." }).max(12, "At most 12 evidence fields."),
    ).transform((list) => {
      const out: EvidenceField[] = [];
      for (const f of list) out.push({ key: f.key && !out.some((o) => o.key === f.key) ? f.key : fieldKey(f.label, out.map((o) => o.key)), label: f.label, type: f.type, required: f.required });
      return out;
    }),
  }),
  /** Expense kinds (Settings > Expense kinds): saved by lib/services/expense-kinds.ts (name rules, Other, amounts). */
  expenseKind: KIND_SCHEMA,
  holiday: z.object({ date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.").refine(realDate, "That date does not exist."), name: text("Name") }),
} satisfies Record<SettingsKind, z.ZodType>;
const schemas = SETTINGS_SCHEMAS;

/** Whether a code is in use, so it can no longer change. */
export async function codeInUse(kind: "transactionType" | "documentType", id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  if (kind === "transactionType") {
    const t = await db.transactionType.findUnique({ where: { id }, include: { _count: { select: { rules: true, txns: true, caRules: true } } } });
    return !!t && (t.builtIn || t._count.rules + t._count.txns + t._count.caRules > 0);
  }
  const d = await db.documentType.findUnique({ where: { id }, include: { _count: { select: { rules: true } } } });
  if (!d) return false;
  return d._count.rules > 0 || (await db.documentItem.count({ where: { docTypeCode: d.code } })) > 0;
}

/** Rules that need the database (beyond the form schema). Shared with Import. */
export async function checkSettingsRow(kind: SettingsKind, id: string | null, data: Record<string, unknown>, db: Prisma.TransactionClient | typeof prisma = prisma) {
  if (kind === "tat" && !id) throw new UserError("Turnaround times are fixed per journey step; edit the existing rows.");
  if (kind === "loanType" && !id) throw new UserError("Loan types must match MyLoans exactly (New, Renewal). Edit the existing rows.");
  if ((kind === "transactionType" || kind === "documentType") && id) {
    const cur = kind === "transactionType" ? await db.transactionType.findUnique({ where: { id } }) : await db.documentType.findUnique({ where: { id } });
    if (cur && cur.code !== data.code && (await codeInUse(kind, id, db))) {
      throw new UserError("The short code cannot be changed after it is used.", "code");
    }
  }
  if (kind === "checklistRule") {
    const doc = await db.documentType.findUnique({ where: { id: String(data.documentTypeId) } });
    if (!doc) throw new UserError("Pick a document type.", "documentTypeId");
    const cur = id ? await db.checklistRule.findUnique({ where: { id } }) : null;
    // Inactive document types are not offered for new items; an item that already uses one keeps it.
    if (!doc.active && cur?.documentTypeId !== doc.id) throw new UserError(`${doc.name} is inactive. Pick an active document type.`, "documentTypeId");
    const tt = await db.transactionType.findUnique({ where: { id: String(data.transactionTypeId) } });
    if (!tt) throw new UserError("Pick a transaction.", "transactionTypeId");
  }
  if (kind === "processingStage") {
    const tt = await db.transactionType.findUnique({ where: { id: String(data.typeId) } });
    if (!tt) throw new UserError("Pick a transaction.", "typeId");
    if (!tt.requiresDp) throw new UserError(`${tt.name} has no processor, so it has no stages.`, "typeId");
    const cur = id ? await db.processingStage.findUnique({ where: { id } }) : null;
    if (id && !cur) throw new UserError("Row not found.");
    // The stages the system adds keep their place, type and code; Check and verify keeps its paper checklist.
    if (cur && cur.kind !== "OWN") {
      data.typeId = cur.typeId;
      data.code = cur.code;
      data.sortOrder = cur.sortOrder;
      if (cur.kind === "VERIFY") data.fields = [];
    } else if (cur && cur.typeId !== data.typeId) {
      throw new UserError("A stage stays with its transaction type. Add a new stage to the other type instead.", "typeId");
    }
  }
  if (kind === "branch") await checkBranchRow(id, data, db);
  if (kind === "approvalBand") {
    // Each type has its own bands; the approving role needs that type's Approve tick.
    const typeKey = data.fundsTypeId === TYPE_ID.FT ? "FT" : "CA";
    data.fundsTypeId = TYPE_ID[typeKey];
    const role = await db.role.findUnique({ where: { id: String(data.roleId) } });
    if (!role || !role.active) throw new UserError("Pick an active role.", "roleId");
    if (!effectivePermissions(role).has(STEP_KEY[typeKey].approve)) throw new UserError(`${role.name} cannot approve ${TYPE_NOUN[typeKey]} (Settings > Roles and access).`, "roleId");
  }
  if (kind === "caRule") {
    const tt = await db.transactionType.findUnique({ where: { id: String(data.transactionTypeId) } });
    if (!tt) throw new UserError("Pick a transaction.", "transactionTypeId");
    // The kind: active for a new rule; an existing rule may keep an inactive one.
    const cur = id ? await db.cashAdvanceRule.findUnique({ where: { id } }) : null;
    const k = await db.expenseKind.findUnique({ where: { code: String(data.kind) } });
    if (!k) throw new UserError("Pick the expense kind.", "expenseKind");
    if (!k.active && cur?.kind !== k.code) throw new UserError(`${k.name} is inactive. Pick an active expense kind.`, "expenseKind");
    // A kind's fixed amount cannot be changed by the processor, so the maximum cannot be below it.
    const max = typeof data.maxAmount === "number" ? Math.round(data.maxAmount * 100) : decimalToCents(data.maxAmount as never);
    if (k.amountMode === "FIXED" && k.amountCents !== null && max !== null && max < k.amountCents) {
      throw new UserError(`${k.name} has a fixed amount of ${peso(k.amountCents)}. The maximum cannot be below it.`, "maxAmount");
    }
    const twin = await db.cashAdvanceRule.findFirst({ where: { transactionTypeId: tt.id, kind: k.code, active: true, ...(id ? { NOT: { id } } : {}) } });
    if (twin) throw new UserError(`${tt.name} already has an active rule for this expense kind. Change that rule instead.`, "expenseKind");
  }
}

type Delegate = {
  findUnique(a: { where: { id: string } }): Promise<unknown>;
  update(a: { where: { id: string }; data: unknown }): Promise<{ id: string }>;
  create(a: { data: unknown }): Promise<{ id: string }>;
};

const BRANCH_READ_ONLY = [["code", "Code"], ["name", "Name"], ["address", "Address"], ["divisionId", "Division"], ["areaId", "Area"]] as const;

/**
 * Branch rules. A branch from MyLoans: code, name, address, division and area come from MyLoans and
 * change only there (through the Branch review); the usual LTO office is the DMS's own and stays
 * editable. A branch made by hand is fully editable; a new one needs its 3-digit code.
 */
async function checkBranchRow(id: string | null, data: Record<string, unknown>, db: Prisma.TransactionClient | typeof prisma) {
  const cur = id ? await db.branch.findUnique({ where: { id } }) : null;
  if (id && !cur) throw new UserError("Row not found.");
  if (cur && cur.source === "MYLOANS") {
    for (const [k, label] of BRANCH_READ_ONLY) {
      // Not sent (or sent empty): keep the MyLoans value. A different value is refused.
      if (data[k] === undefined || data[k] === null || data[k] === "") { data[k] = cur[k]; continue; }
      if (String(data[k] ?? "") !== String(cur[k] ?? "")) throw new UserError(`${label} comes from MyLoans and can only change there (Settings, Branches, Branch review).`, k);
    }
  }
  if (!cur && !data.code) throw new UserError("Type the 3-digit branch code (as in MyLoans).", "code");
  if (data.code && (await db.branch.findFirst({ where: { code: String(data.code), ...(id ? { NOT: { id } } : {}) } }))) throw new UserError("That code is already used.", "code");
  if (data.areaId && !data.divisionId) throw new UserError("Pick the division of this area too.", "divisionId");
  if (data.divisionId && !(await db.division.findUnique({ where: { id: String(data.divisionId) } }))) throw new UserError("Pick a division from the list.", "divisionId");
  if (data.areaId && !(await db.area.findUnique({ where: { id: String(data.areaId) } }))) throw new UserError("Pick an area from the list.", "areaId");
  if (data.usualLtoOfficeId && data.usualLtoOfficeId !== cur?.usualLtoOfficeId) {
    const o = await db.ltoOffice.findUnique({ where: { id: String(data.usualLtoOfficeId) } });
    if (!o || !o.active) throw new UserError("Pick an active LTO office.", "usualLtoOfficeId");
  }
}

export async function saveSettingsRow(user: CurrentUser, kind: SettingsKind, id: string | null, raw: Record<string, unknown>) {
  if (!KIND_PERMISSION[kind] || !can(user, KIND_PERMISSION[kind])) throw new UserError("Your role does not allow changing this part of Settings.");
  // Expense kinds have their own rules (Other is fixed, names unique ignoring case, amounts).
  if (kind === "expenseKind") { await saveExpenseKind(user, id, raw); return; }
  const schema = schemas[kind];
  if (!schema) throw new UserError("Unknown setting.");
  const p = schema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const data = p.data as Record<string, unknown>;
  await checkSettingsRow(kind, id, data);

  const delegates = (tx: Prisma.TransactionClient): Record<SettingsKind, Delegate> => ({
    branch: tx.branch as unknown as Delegate,
    transactionType: tx.transactionType as unknown as Delegate,
    documentType: tx.documentType as unknown as Delegate,
    checklistRule: tx.checklistRule as unknown as Delegate,
    tat: tx.tatRule as unknown as Delegate,
    loanType: tx.loanType as unknown as Delegate,
    ltoOffice: tx.ltoOffice as unknown as Delegate,
    caRule: tx.cashAdvanceRule as unknown as Delegate,
    approvalBand: tx.approvalBand as unknown as Delegate,
    problemReason: tx.problemReason as unknown as Delegate,
    holdReason: tx.holdReason as unknown as Delegate,
    returnReason: tx.returnReason as unknown as Delegate,
    holiday: tx.holidayCalendar as unknown as Delegate,
    processingStage: tx.processingStage as unknown as Delegate,
    fundsType: tx.fundsType as unknown as Delegate,
    expenseKind: tx.expenseKind as unknown as Delegate,
  });

  try {
    await prisma.$transaction(async (tx) => {
      const del = delegates(tx)[kind];
      const before = id ? await del.findUnique({ where: { id } }) : null;
      if (id && !before) throw new UserError("Row not found.");
      // A hold reason or funds type saved by Admin is no longer "Proposed, to be confirmed".
      const saved = id ? await del.update({ where: { id }, data: kind === "holdReason" || kind === "fundsType" ? { ...data, proposed: false } : data }) : await del.create({ data });
      // A branch's area or division decides who has it through an Area or Division grant.
      if (kind === "branch") await rebuildAccess(tx, "groups");
      await writeAudit(tx, {
        actor: actorOf(user), mode: "MANUAL", action: id ? "setting_updated" : "setting_created", entityType: kind, entityId: saved.id,
        summary: `${id ? "Updated" : "Added"} ${kind.replace(/([A-Z])/g, " $1").toLowerCase()} setting`,
        before: before ?? undefined, after: data,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
      const field = target.includes("name") ? "name" : target.includes("date") ? "date" : "code";
      throw new UserError(field === "name" ? "That name is already used." : field === "date" ? "That date already has a holiday." : "That code is already used.", field);
    }
    throw e;
  }
}

export async function setToggle(user: CurrentUser, key: Extract<SettingKey, "myloans.simulateUnavailable" | "simulator.enabled" | "samples.showDataCheck">, value: boolean) {
  if (!can(user, key === "samples.showDataCheck" ? PERMISSIONS.TESTDATA_RESET : PERMISSIONS.SETTINGS_SYSTEM)) throw new UserError("Your role does not allow changing these switches.");
  refuseInProduction(key === "simulator.enabled" ? "The test simulator" : key === "myloans.simulateUnavailable" ? "Simulate MyLoans unavailable" : "Sample loans");
  if (key === "samples.showDataCheck" && !isTestMode()) throw new UserError("This setting is only available in test mode.");
  await prisma.$transaction(async (tx) => {
    const before = await getSetting(key, tx);
    await setSetting(key, value, tx);
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "setting_updated", entityType: "Setting", entityId: key, summary: `Set ${key} to ${value ? "on" : "off"}`, before: { [key]: before }, after: { [key]: value } });
  });
}

/** Mock only: change a MyLoans field for a PN to demonstrate the source-change flag on refresh. */
export async function setMockOverride(user: CurrentUser, pn: string, amount: number | null) {
  refuseInProduction("The sample MyLoans (mock)");
  if (!can(user, PERMISSIONS.SETTINGS_SYSTEM)) throw new UserError("Your role does not allow changing these switches.");
  const parsed = await checkPn(pn);
  if (!parsed.ok) throw new UserError(`This does not look like a PN. ${parsed.message}`, "pn");
  const key = parsed.pn;
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) throw new UserError("Amount must be above 0.", "amount");
  await prisma.$transaction(async (tx) => {
    const cur = { ...(await getSetting("myloans.mockOverrides", tx)) };
    const before = cur[key] ?? null;
    if (amount === null) delete cur[key];
    else cur[key] = { ...(cur[key] ?? {}), totalReleasedAmount: amount };
    await setSetting("myloans.mockOverrides", cur, tx);
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "setting_updated", entityType: "Setting", entityId: "myloans.mockOverrides", summary: amount === null ? `Cleared mock source change for ${key}` : `Mock MyLoans amount for ${key} set to ${amount}`, before: { [key]: before }, after: { [key]: cur[key] ?? null } });
  });
}

export const FUNDS_SETTINGS_SCHEMA = z.object({
  carryOverLimitDays: int("Carry-over limit", 0, 60),
  liquidationDueDays: int("Liquidation due", 1, 90),
  blockLtoUntilFunded: bool,
});

/** Cash-advance switches (Settings > Cash-advance rules). One audit row. */
export async function saveFundsSettings(user: CurrentUser, raw: Record<string, unknown>) {
  if (!can(user, PERMISSIONS.SETTINGS_CASH_ADVANCE)) throw new UserError("Your role does not allow changing cash-advance rules.");
  const p = FUNDS_SETTINGS_SCHEMA.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  await prisma.$transaction(async (tx) => {
    const before = {
      carryOverLimitDays: await getSetting("funds.carryOverLimitDays", tx),
      liquidationDueDays: await getSetting("funds.liquidationDueDays", tx),
      blockLtoUntilFunded: await getSetting("funds.blockLtoUntilFunded", tx),
    };
    await setSetting("funds.carryOverLimitDays", p.data.carryOverLimitDays, tx);
    await setSetting("funds.liquidationDueDays", p.data.liquidationDueDays, tx);
    await setSetting("funds.blockLtoUntilFunded", p.data.blockLtoUntilFunded, tx);
    await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "setting_updated", entityType: "Setting", entityId: "funds", summary: `Cash-advance switches: carry-over limit ${p.data.carryOverLimitDays} business days, liquidation due ${p.data.liquidationDueDays} business days, block At the LTO until funded ${p.data.blockLtoUntilFunded ? "on" : "off"}`, before, after: p.data });
  });
}
