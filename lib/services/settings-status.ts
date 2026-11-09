import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { ADMIN_ROLE_KEY, KIND_PERMISSION, PERMISSIONS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { UserError } from "./errors";

/**
 * Inactive instead of delete. Nothing in Settings or Users is ever deleted: a row is made inactive
 * (kept, shown with an "Inactive" chip, not offered for new work, not used by automation) and can
 * be made active again. Existing loan files, transactions and history keep it and its name.
 */
export type StatusKind =
  | "branch" | "transactionType" | "documentType" | "checklistRule" | "loanType" | "ltoOffice" | "caRule" | "holiday" | "user" | "approvalBand" | "problemReason" | "holdReason" | "returnReason" | "processingStage" | "fundsType";

export const STATUS_KINDS: StatusKind[] = ["branch", "transactionType", "documentType", "checklistRule", "loanType", "ltoOffice", "caRule", "holiday", "user", "approvalBand", "problemReason", "holdReason", "returnReason", "processingStage", "fundsType"];

const NOUN: Record<StatusKind, string> = {
  branch: "Branch", transactionType: "Transaction type", documentType: "Document type", checklistRule: "Checklist item",
  loanType: "Loan type", ltoOffice: "LTO office", caRule: "Cash-advance rule", holiday: "Holiday", user: "User", approvalBand: "Approval band", problemReason: "Problem reason", holdReason: "Hold reason", returnReason: "Return reason", processingStage: "Processing stage", fundsType: "Funds type",
};

/** Lists the app needs at least one active row of. */
const NEEDS_ONE: Partial<Record<StatusKind, string>> = {
  branch: "branch", approvalBand: "approval band", problemReason: "problem reason", holdReason: "hold reason", returnReason: "return reason", fundsType: "funds type", loanType: "loan type", documentType: "document type", ltoOffice: "LTO office", transactionType: "transaction type",
};

/** Loan file stages that count as "open" (not closed, archived or disposed). */
export const OPEN_STAGES = ["Opened", "For checklist", "No DP assignment required", "Assigned to DP", "In process", "Awaiting LA acceptance", "For Vault Transmittal", "In transit to Vault", "In Safekeeping"];

type Row = { id: string; active: boolean; label: string };

async function loadRow(kind: StatusKind, id: string): Promise<(Row & { builtIn?: boolean; roleKey?: string }) | null> {
  switch (kind) {
    case "branch": { const r = await prisma.branch.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "transactionType": { const r = await prisma.transactionType.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name, builtIn: r.builtIn }; }
    case "documentType": { const r = await prisma.documentType.findUnique({ where: { id } }); return r && { id, active: r.active, label: `${r.name} (${r.code})` }; }
    case "checklistRule": { const r = await prisma.checklistRule.findUnique({ where: { id }, include: { transactionType: true } }); return r && { id, active: r.active, label: `${r.transactionType.name} · ${r.label}` }; }
    case "loanType": { const r = await prisma.loanType.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "ltoOffice": { const r = await prisma.ltoOffice.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "approvalBand": { const r = await prisma.approvalBand.findUnique({ where: { id }, include: { role: true } }); return r && { id, active: r.active, label: `from ${(r.fromCents / 100).toLocaleString("en-PH")} (${r.role.name})` }; }
    case "problemReason": { const r = await prisma.problemReason.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "holdReason": { const r = await prisma.holdReason.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "returnReason": { const r = await prisma.returnReason.findUnique({ where: { id } }); return r && { id, active: r.active, label: r.name }; }
    case "fundsType": { const r = await prisma.fundsType.findUnique({ where: { id } }); return r && { id, active: r.active, label: `${r.name} (${r.code})` }; }
    case "processingStage": { const r = await prisma.processingStage.findUnique({ where: { id }, include: { type: true } }); return r && { id, active: r.active, label: `${r.type.name} · ${r.name}` }; }
    case "caRule": { const r = await prisma.cashAdvanceRule.findUnique({ where: { id }, include: { transactionType: true } }); return r && { id, active: r.active, label: `${r.transactionType.name} · ${r.purpose}` }; }
    case "holiday": { const r = await prisma.holidayCalendar.findUnique({ where: { id } }); return r && { id, active: r.active, label: `${r.name} (${r.date})` }; }
    case "user": { const r = await prisma.user.findUnique({ where: { id }, include: { role: true } }); return r && { id, active: r.active, label: r.name, roleKey: r.role.key }; }
  }
}

async function activeCount(kind: StatusKind): Promise<number> {
  switch (kind) {
    case "branch": return prisma.branch.count({ where: { active: true } });
    case "loanType": return prisma.loanType.count({ where: { active: true } });
    case "documentType": return prisma.documentType.count({ where: { active: true } });
    case "ltoOffice": return prisma.ltoOffice.count({ where: { active: true } });
    case "transactionType": return prisma.transactionType.count({ where: { active: true } });
    case "approvalBand": return prisma.approvalBand.count({ where: { active: true } });
    case "problemReason": return prisma.problemReason.count({ where: { active: true } });
    case "holdReason": return prisma.holdReason.count({ where: { active: true } });
    case "returnReason": return prisma.returnReason.count({ where: { active: true } });
    case "fundsType": return prisma.fundsType.count({ where: { active: true } });
    default: return Number.POSITIVE_INFINITY;
  }
}

/**
 * The hard limits, checked on the server. Returns a plain message when the row may not be made
 * inactive, otherwise null. Used by the button and by Import (with the import's running counts).
 */
export async function inactiveRefusal(
  kind: StatusKind,
  row: { id: string; builtIn?: boolean; roleKey?: string; active?: boolean },
  actor: { id: string },
  counts?: { activeLeft?: number; activeAdminsLeft?: number },
): Promise<string | null> {
  if (kind === "transactionType" && row.builtIn) return "The four built-in transaction types (Notary, For EDST, For Entry PPSR, Mortgage) are always active.";
  if (kind === "user") {
    if (row.id === actor.id) return "You cannot make yourself inactive.";
    if (row.roleKey === ADMIN_ROLE_KEY) {
      const admins = counts?.activeAdminsLeft ?? (await prisma.user.count({ where: { active: true, role: { key: ADMIN_ROLE_KEY } } }));
      if (admins <= 1 && row.active !== false) return "This is the last active Admin. Make another Admin active first.";
    }
    if (!counts && row.active !== false) {
      const u = await prisma.user.findUnique({ where: { id: row.id }, include: { role: true } });
      if (u && effectivePermissions(u.role).has(PERMISSIONS.ROLES_MANAGE) && (await countActiveManagers(row.id)) === 0) {
        return "This is the last active person who can manage roles and access.";
      }
    }
  }
  const noun = NEEDS_ONE[kind];
  if (noun) {
    const left = counts?.activeLeft ?? (await activeCount(kind));
    if (left <= 1 && row.active !== false) return `This is the last active ${noun}. The app needs at least one.`;
  }
  return null;
}

/** What making a row inactive does, in plain words, with counts where known. Shown in the confirm. */
export async function inactiveEffect(kind: StatusKind, id: string): Promise<string> {
  switch (kind) {
    case "branch": {
      const b = await prisma.branch.findUniqueOrThrow({ where: { id } });
      const open = await prisma.loan.count({ where: { branchId: id, stage: { in: OPEN_STAGES } } });
      return `${b.name} has ${open} open loan file${open === 1 ? "" : "s"}. They stay as they are, but no new loan files can be opened for ${b.name}. Make inactive?`;
    }
    case "documentType": {
      const n = await prisma.checklistRule.count({ where: { documentTypeId: id } });
      return `Used by ${n} checklist item${n === 1 ? "" : "s"}. They keep it. It will not appear for new items. Make inactive?`;
    }
    case "transactionType": {
      const n = await prisma.loanTransaction.count({ where: { typeId: id } });
      return `Used on ${n} loan file${n === 1 ? "" : "s"}. They keep it. Loan Associates can no longer add it to a loan file. Make inactive?`;
    }
    case "checklistRule":
      return "Loan files already opened keep this paper. New loan files will not include it. Make inactive?";
    case "loanType": {
      const lt = await prisma.loanType.findUniqueOrThrow({ where: { id } });
      const n = await prisma.loan.count({ where: { loanType: lt.code } });
      return `${n} loan file${n === 1 ? "" : "s"} use ${lt.name}. They stay as they are, but no new loan files with this loan type can be opened. Make inactive?`;
    }
    case "ltoOffice": {
      const n = await prisma.dpAssignment.count({ where: { ltoOfficeId: id } });
      return `Used by ${n} processor assignment${n === 1 ? "" : "s"}. They keep it. It will no longer be offered when sending to a processor. Make inactive?`;
    }
    case "approvalBand":
      return "Advances in this amount range will be approved under the next lower band. Make inactive?";
    case "problemReason": {
      const n = await prisma.problem.count({ where: { reasonId: id } });
      return `Used by ${n} problem${n === 1 ? "" : "s"}. They keep it. It will not be offered for new problems or attempts. Make inactive?`;
    }
    case "holdReason": {
      const n = await prisma.hold.count({ where: { reasonId: id } });
      return `Used by ${n} hold${n === 1 ? "" : "s"}. They keep it. It will not be offered for new holds. Make inactive?`;
    }
    case "fundsType": {
      const n = await prisma.cashAdvance.count({ where: { fundsTypeId: id } });
      return `Used by ${n} funds record${n === 1 ? "" : "s"}. They keep it (and its name). It will not be offered for new requests. Make inactive?`;
    }
    case "returnReason": {
      const n = await prisma.dpAssignment.count({ where: { returnReasonId: id } });
      return `Used by ${n} return${n === 1 ? "" : "s"}. They keep it. It will not be offered for new returns. Make inactive?`;
    }
    case "processingStage": {
      const st = await prisma.processingStage.findUniqueOrThrow({ where: { id }, include: { type: true } });
      if (st.kind === "VERIFY") return `Check and verify will no longer be the last stage of new ${st.type.name} jobs: the processor could forward without ticking every paper as received back and complete. Jobs already started keep it. Make inactive?`;
      return `New ${st.type.name} jobs will skip ${st.name}. Jobs already started keep their stages. Make inactive?`;
    }
    case "caRule":
      return "It will no longer be suggested for new cash advances. Past cash advances are not changed. Make inactive?";
    case "holiday":
      return "It will no longer be skipped when counting turnaround times (deadlines may move). Make inactive?";
    case "user":
      return "They can no longer sign in or be picked for new work. Their past work stays as it is. Make inactive?";
  }
}

/** Make a row inactive or active again. Hard limits on the server; one audit row each time. */
export async function setRowActive(user: CurrentUser, kind: StatusKind, id: string, active: boolean) {
  if (!KIND_PERMISSION[kind] || !can(user, KIND_PERMISSION[kind])) throw new UserError("Your role does not allow this.");
  if (!STATUS_KINDS.includes(kind)) throw new UserError("This list cannot be made inactive.");
  const row = await loadRow(kind, id);
  if (!row) throw new UserError("Not found. It may have been changed by someone else.");
  if (row.active === active) return;
  if (!active) {
    const refusal = await inactiveRefusal(kind, row, user);
    if (refusal) throw new UserError(refusal, "active");
  }
  const data = active ? { active: true, deactivatedAt: null, deactivatedById: null } : { active: false, deactivatedAt: new Date(), deactivatedById: user.id };
  await prisma.$transaction(async (tx) => {
    switch (kind) {
      case "branch": await tx.branch.update({ where: { id }, data }); break;
      case "transactionType": await tx.transactionType.update({ where: { id }, data }); break;
      case "documentType": await tx.documentType.update({ where: { id }, data }); break;
      case "checklistRule": await tx.checklistRule.update({ where: { id }, data }); break;
      case "loanType": await tx.loanType.update({ where: { id }, data }); break;
      case "ltoOffice": await tx.ltoOffice.update({ where: { id }, data }); break;
      case "caRule": await tx.cashAdvanceRule.update({ where: { id }, data }); break;
      case "approvalBand": await tx.approvalBand.update({ where: { id }, data }); break;
      case "problemReason": await tx.problemReason.update({ where: { id }, data }); break;
      case "holdReason": await tx.holdReason.update({ where: { id }, data }); break;
      case "returnReason": await tx.returnReason.update({ where: { id }, data }); break;
      case "fundsType": await tx.fundsType.update({ where: { id }, data }); break;
      case "processingStage": await tx.processingStage.update({ where: { id }, data }); break;
      case "holiday": await tx.holidayCalendar.update({ where: { id }, data }); break;
      case "user": await tx.user.update({ where: { id }, data }); break;
    }
    await writeAudit(tx, {
      actor: { id: user.id, label: user.name }, mode: "MANUAL",
      action: active ? "made_active" : "made_inactive", entityType: kind, entityId: id,
      summary: `${NOUN[kind]} ${row.label} made ${active ? "active" : "inactive"}`,
      before: { active: row.active }, after: { active },
    });
  });
}

/**
 * Active people (active user, active role) who can manage roles and access, leaving out one user.
 * The app always keeps at least one.
 */
export async function countActiveManagers(excludeUserId?: string): Promise<number> {
  const users = await prisma.user.findMany({ where: { active: true, id: excludeUserId ? { not: excludeUserId } : undefined, role: { active: true } }, include: { role: true } });
  return users.filter((u) => effectivePermissions(u.role).has(PERMISSIONS.ROLES_MANAGE)).length;
}

/** "4 branches" counts active rows only; "+1 inactive" when any. */
export function countLine(active: number, inactive: number, one: string, many: string) {
  return { main: `${active} ${active === 1 ? one : many}`, extra: inactive > 0 ? `+${inactive} inactive` : "" };
}
