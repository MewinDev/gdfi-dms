"use server";

import { anyStepKeys } from "@/lib/funds/access";
import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { toCents } from "@/lib/funds/rules";
import { addSuggestionAsKind, kindOption, moveExpenseKind, quickAddKind } from "@/lib/services/expense-kinds";
import { saveAdvanceLine } from "@/lib/services/funds";
import { UserError } from "@/lib/services/errors";
import type { KindOption } from "@/lib/funds/kind-option";

function refresh() {
  revalidatePath("/admin/settings");
  revalidatePath("/funds");
  revalidatePath("/my-funds");
}

export type QuickAddState = (ActionState & { kind?: KindOption }) | null;

/** "+ Add new kind" (Finance, approver, and processors with the tick): saved Active, returned to select it. */
export async function quickAddKindAction(_p: QuickAddState, fd: FormData): Promise<QuickAddState> {
  let kind: KindOption | undefined;
  const state = await runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_KINDS_MANAGE);
    const k = await quickAddKind(u, { name: str(fd, "name"), amountMode: str(fd, "amountMode"), amount: str(fd, "amount") }, str(fd, "where") || "a funds screen");
    kind = kindOption(k);
    refresh();
    return `${k.name} added.`;
  });
  return state ? { ...state, kind } : state;
}

/** Settings, Expense kinds: Up / Down. */
export async function moveKindAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_KINDS_MANAGE);
    await moveExpenseKind(u, str(fd, "id"), str(fd, "dir") === "up" ? -1 : 1);
    refresh();
    return "Moved.";
  });
}

/** "Often typed as Other": Add as a kind (amount mode asked in the same modal; relabel only when ticked). */
export async function addSuggestionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_KINDS_MANAGE);
    const r = await addSuggestionAsKind(u, { name: str(fd, "name"), amountMode: str(fd, "amountMode"), amount: str(fd, "amount"), relabel: fd.get("relabel") === "on" });
    refresh();
    return r.relabelled ? `${r.kind.name} added. ${r.relabelled} old line(s) relabelled.` : `${r.kind.name} added.`;
  });
}

/** Finance or an approver: change a line, or add one, on a request that is not yet decided. */
export async function saveAdvanceLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("editLines"));
    const c = toCents(str(fd, "amount"));
    if (c === null) throw new UserError("Enter the amount in pesos, for example 500 or 1,250.50.", "cents");
    const lineId = str(fd, "lineId");
    await saveAdvanceLine(u, lineId ? { lineId } : { advanceId: str(fd, "advanceId") }, {
      kind: str(fd, "kind"), otherDescription: str(fd, "otherDescription"), cents: c, overMaxReason: str(fd, "overMaxReason"), note: str(fd, "note"),
    });
    refresh();
    return lineId ? "Line saved." : "Line added.";
  });
}
