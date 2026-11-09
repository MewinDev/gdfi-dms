"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { editAdvisory, fileAdvisory, resolveAdvisory } from "@/lib/services/lto-advisories";
import { saveDefaultCapacity, saveDpCapacity } from "@/lib/services/dp-capacity";
import { ADVISORY_LABEL, type AdvisoryType } from "@/lib/monitoring/advisories";

/** Pages that show advisories or availability. */
function refresh(jobId?: string) {
  revalidatePath("/monitoring");
  revalidatePath("/loans", "layout");
  revalidatePath("/jobs", "layout");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/** File an LTO advisory: from a DP job at an LTO stage (assignmentId), or from Monitoring (ltoOfficeId, ltoreports:manage). */
export async function fileAdvisoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission([PERMISSIONS.LTO_REPORTS_CREATE, PERMISSIONS.LTO_REPORTS_MANAGE]);
    const assignmentId = str(fd, "assignmentId") || null;
    const a = await fileAdvisory(u, { type: str(fd, "type"), remarks: str(fd, "remarks"), startedAt: str(fd, "startedAt"), assignmentId, ltoOfficeId: str(fd, "ltoOfficeId") || null });
    refresh(assignmentId ?? undefined);
    return `Reported: ${ADVISORY_LABEL[a.type as AdvisoryType]}. Operations is told.`;
  });
}

export async function resolveAdvisoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission([PERMISSIONS.LTO_REPORTS_CREATE, PERMISSIONS.LTO_REPORTS_MANAGE]);
    await resolveAdvisory(u, str(fd, "id"), { remarks: str(fd, "remarks") });
    refresh();
    return "Resolved.";
  });
}

export async function editAdvisoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission([PERMISSIONS.LTO_REPORTS_CREATE, PERMISSIONS.LTO_REPORTS_MANAGE]);
    await editAdvisory(u, str(fd, "id"), { type: str(fd, "type"), remarks: str(fd, "remarks") });
    refresh();
    return "Saved.";
  });
}

export async function saveDefaultCapacityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.DP_CAPACITY_MANAGE);
    const msg = await saveDefaultCapacity(u, str(fd, "defaultCapacity"));
    refresh();
    revalidatePath("/admin/settings");
    return msg;
  });
}

export async function saveDpCapacityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.DP_CAPACITY_MANAGE);
    const msg = await saveDpCapacity(u, str(fd, "userId"), { capacity: str(fd, "capacity"), onLeave: fd.get("onLeave") === "on", leaveUntil: str(fd, "leaveUntil") });
    refresh();
    revalidatePath("/admin/settings");
    return msg;
  });
}
