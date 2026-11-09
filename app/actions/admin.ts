"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { KIND_PERMISSION, LIST_PERMISSION, PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, strOrNull, type ActionState } from "@/lib/action";
import { saveSettingsRow, saveUser, setMockOverride, setToggle, type SettingsKind, saveFundsSettings } from "@/lib/services/admin";
import { UserError } from "@/lib/services/errors";
import { AuthzError } from "@/lib/auth/current-user";
import { checkRoleChange, duplicateRole, resetRoleToDefault, saveRole, setRoleActive } from "@/lib/services/roles";
import { STATUS_KINDS, setRowActive, type StatusKind } from "@/lib/services/settings-status";
import { IMPORT_LISTS, type ImportListKey } from "@/lib/import/columns";
import { checkImport, runImport, type ImportPlan } from "@/lib/import/importer";

const RESERVED = new Set(["kind", "id"]);

function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || RESERVED.has(k)) continue;
    o[k] = typeof v === "string" ? v : "";
  }
  return o;
}

export async function saveUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.USERS_EDIT);
    await saveUser(user, strOrNull(fd, "id"), {
      name: str(fd, "name"),
      email: str(fd, "email"),
      roleId: str(fd, "roleId"),
      active: fd.get("active") === "on",
      // Branch access from the tree (JSON); older forms send branch ids.
      // Nothing is sent without "Change branch access" (the form shows the access read only).
      ...(fd.has("access") ? { access: str(fd, "access") } : fd.has("branchIds") ? { branchIds: fd.getAll("branchIds").map(String) } : {}),
    });
    revalidatePath("/admin/users");
    return "User saved.";
  });
}

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const kind = str(fd, "kind") as SettingsKind;
    if (!KIND_PERMISSION[kind]) throw new UserError("Unknown setting.");
    const user = await requirePermission(KIND_PERMISSION[kind]);
    const obj = formObject(fd);
    // Unchecked checkboxes are absent from FormData.
    for (const k of ["active", "requiresDp", "required"]) if (fd.has(`$has_${k}`)) obj[k] = fd.get(k) === "on";
    // The form already uses "kind" for the list; the cash-advance rule's expense kind comes as expenseKind.
    if (kind === "caRule") obj.kind = str(fd, "expenseKind");
    await saveSettingsRow(user, kind, strOrNull(fd, "id"), obj);
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

/** Cash-advance switches: carry-over limit, liquidation due, block At the LTO until funded. */
export async function saveFundsSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_CASH_ADVANCE);
    await saveFundsSettings(user, { carryOverLimitDays: str(fd, "carryOverLimitDays"), liquidationDueDays: str(fd, "liquidationDueDays"), blockLtoUntilFunded: fd.get("blockLtoUntilFunded") === "on" });
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

export async function toggleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const key = str(fd, "key");
    if (key !== "myloans.simulateUnavailable" && key !== "simulator.enabled" && key !== "samples.showDataCheck") throw new UserError("Unknown setting.");
    const user = await requirePermission(key === "samples.showDataCheck" ? PERMISSIONS.TESTDATA_RESET : PERMISSIONS.SETTINGS_SYSTEM);
    await setToggle(user, key, str(fd, "value") === "on");
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

export async function mockOverrideAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_SYSTEM);
    const clear = fd.get("$clear") === "1";
    const amt = str(fd, "amount").replace(/,/g, "");
    await setMockOverride(user, str(fd, "pn"), clear ? null : amt === "" ? Number.NaN : Number(amt));
    revalidatePath("/admin/settings");
    return clear ? "Mock source change cleared." : "Mock MyLoans record changed. Refresh the Loan File to see the source-change flag.";
  });
}

// Reset test data: replaced by Settings > Test kit (app/actions/kit.ts), which resets to the kit's
// starting state with a typed RESET and an automatic backup first.

// ---------------------------------------------------------------------------
// Inactive instead of delete
// ---------------------------------------------------------------------------

export async function setActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const kind = str(fd, "kind") as StatusKind;
    if (!STATUS_KINDS.includes(kind)) throw new UserError("This list cannot be made inactive.");
    const user = await requirePermission(KIND_PERMISSION[kind]);
    const active = str(fd, "active") === "true";
    await setRowActive(user, kind, str(fd, "id"), active);
    revalidatePath(kind === "user" ? "/admin/users" : "/admin/settings");
    return active ? "Made active." : "Made inactive.";
  });
}

// ---------------------------------------------------------------------------
// Import (Check file, then Import). The file text is sent again on Import and checked again.
// ---------------------------------------------------------------------------

export type ImportState = { ok: true; plan: Extract<ImportPlan, { ok: true }>; imported: boolean } | { ok: false; error: string } | null;

export async function importAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const list = str(fd, "list") as ImportListKey;
  if (!IMPORT_LISTS[list]) return { ok: false, error: "This list cannot be imported." };
  try {
    const user = await requirePermission(LIST_PERMISSION[list]);
    const text = str(fd, "text");
    const fileName = str(fd, "fileName");
    if (!text) return { ok: false, error: "Choose a file first." };
    const doImport = str(fd, "step") === "import";
    const plan = doImport ? await runImport(user, list, fileName, text) : await checkImport(user, list, fileName, text);
    if (!plan.ok) return plan;
    if (doImport) revalidatePath(list === "users" ? "/admin/users" : "/admin/settings");
    return { ok: true, plan, imported: doImport };
  } catch (e) {
    if (e instanceof UserError || e instanceof AuthzError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Roles and access
// ---------------------------------------------------------------------------

export type RoleState = (ActionState & { roleId?: string }) | null;

export async function saveRoleAction(_prev: RoleState, fd: FormData): Promise<RoleState> {
  let roleId: string | undefined;
  const state = await runAction(async () => {
    const user = await requirePermission(PERMISSIONS.ROLES_MANAGE);
    roleId = await saveRole(user, strOrNull(fd, "id"), {
      name: str(fd, "name"),
      description: str(fd, "description"),
      branchAccess: str(fd, "branchAccess"),
      permissions: fd.getAll("permissions").map(String),
      copiedFromId: strOrNull(fd, "copiedFromId") ?? undefined,
    });
    revalidatePath("/admin/settings");
    revalidatePath("/admin/users");
    return "Saved.";
  });
  return state ? { ...state, roleId } : state;
}

/**
 * The role editor's check before Save or Make inactive (roles:manage): the impact on the role's people
 * ("3 users gain: ...") and the lock-out reason, if any. Changes nothing.
 */
export async function roleCheckAction(input: { id: string | null; permissions: string[]; active?: boolean }): Promise<
  { ok: true; text: string; added: string[]; removed: string[]; users: number; lockout: string | null } | { ok: false; error: string }
> {
  try {
    const user = await requirePermission(PERMISSIONS.ROLES_MANAGE);
    const r = await checkRoleChange(user, input.id, Array.isArray(input.permissions) ? input.permissions.map(String) : [], input.active);
    return { ok: true, ...r.impact, lockout: r.lockout };
  } catch (e) {
    if (e instanceof UserError || e instanceof AuthzError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function roleCommandAction(_prev: RoleState, fd: FormData): Promise<RoleState> {
  let roleId: string | undefined;
  const state = await runAction(async () => {
    const user = await requirePermission(PERMISSIONS.ROLES_MANAGE);
    const id = str(fd, "id");
    const cmd = str(fd, "cmd");
    let msg = "Saved.";
    if (cmd === "duplicate") { roleId = await duplicateRole(user, id); msg = "Copy made. Change it, then Save."; }
    else if (cmd === "reset") { await resetRoleToDefault(user, id); msg = "Reset to default."; }
    else if (cmd === "inactive") { await setRoleActive(user, id, false); msg = "Made inactive."; }
    else if (cmd === "active") { await setRoleActive(user, id, true); msg = "Made active."; }
    else throw new UserError("Unknown command.");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/users");
    return msg;
  });
  return state ? { ...state, roleId } : state;
}
