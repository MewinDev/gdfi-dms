"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission, AuthzError } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { UserError } from "@/lib/services/errors";
import { getSetting, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  acceptReview, confirmBranchFile, ignoreReview, linkSameBranch, previewBranchFile, reviewImpact, runBranchSync, setBranchHidden,
  type ApplyResult, type ImportPreview,
} from "@/lib/services/branches";

/**
 * Settings, Branches: Import from MyLoans (preview, confirm), Branches from MyLoans (the API), the daily
 * schedule (branches:import), the Branch review (accept, ignore, same branch: branches:review) and Hide from DMS
 * (branches:manage or branches:review).
 */

const BASE = "/admin/settings";

async function fileBytes(fd: FormData): Promise<{ bytes: Uint8Array; name: string }> {
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0) throw new UserError("Choose the MyLoans branch file first.");
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name };
}

export type BranchImportState =
  | { ok: true; step: "preview"; preview: ImportPreview }
  | { ok: true; step: "done"; result: ApplyResult }
  | { ok: false; error: string }
  | null;

export async function branchImportAction(_prev: BranchImportState, fd: FormData): Promise<BranchImportState> {
  try {
    const user = await requirePermission(PERMISSIONS.BRANCHES_IMPORT);
    const { bytes, name } = await fileBytes(fd);
    if (str(fd, "step") !== "confirm") return { ok: true, step: "preview", preview: await previewBranchFile(user, bytes, name) };
    const list = (k: string) => fd.getAll(k).map(String).filter(Boolean);
    const result = await confirmBranchFile(user, bytes, name, str(fd, "fingerprint") || null, { leave: list("leave"), activate: list("activate"), hide: list("hide") });
    revalidatePath(BASE);
    return { ok: true, step: "done", result };
  } catch (e) {
    if (e instanceof UserError || e instanceof AuthzError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "The import stopped. Nothing was changed. Try again, or contact IT if it keeps happening." };
  }
}

export async function branchSyncAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.BRANCHES_IMPORT);
    const r = await runBranchSync({ trigger: "api", user, mode: "full" });
    revalidatePath(BASE);
    if (!r) return "Another branch run is going. Try again in a minute.";
    if (!r.ok) throw new UserError(r.message);
    return `Branches from MyLoans: ${r.message}`;
  });
}

export async function branchScheduleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.BRANCHES_IMPORT);
    const time = str(fd, "time");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new UserError("Type the time as HH:MM, for example 02:00.", "time");
    const paused = fd.get("paused") === "on";
    await prisma.$transaction(async (tx) => {
      const cur = await getSetting("branches.sync", tx);
      await setSetting("branches.sync", { ...cur, time, paused }, tx);
      await writeAudit(tx, { actor: { id: user.id, label: user.name }, mode: "MANUAL", action: "setting_updated", entityType: "Setting", entityId: "branches.sync", summary: `Branches from MyLoans: daily at ${time} PHT${paused ? ", paused" : ""}`, before: { time: cur.time, paused: cur.paused }, after: { time, paused } });
    });
    revalidatePath(BASE);
    return "Saved.";
  });
}

export async function reviewImpactAction(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    await requirePermission(PERMISSIONS.BRANCHES_REVIEW);
    return { ok: true, text: (await reviewImpact(id)).text };
  } catch (e) {
    if (e instanceof UserError || e instanceof AuthzError) return { ok: false, error: e.message };
    return { ok: false, error: "The impact could not be worked out. Try again." };
  }
}

export async function reviewDecisionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.BRANCHES_REVIEW);
    const id = str(fd, "id");
    const cmd = str(fd, "cmd");
    let msg: string;
    if (cmd === "accept") { await acceptReview(user, id, { hide: fd.get("hide") === "on", activate: fd.get("activate") === "on" }); msg = "Accepted: the change is applied."; }
    else if (cmd === "ignore") { await ignoreReview(user, id, str(fd, "note")); msg = "Ignored: nothing was changed."; }
    else if (cmd === "link") { await linkSameBranch(user, id, str(fd, "branchId")); msg = "Linked: the old branch now has the new code and keeps its history."; }
    else throw new UserError("Unknown command.");
    revalidatePath(BASE);
    return msg;
  });
}

export async function branchHiddenAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireAnyPermission([PERMISSIONS.BRANCHES_MANAGE, PERMISSIONS.BRANCHES_REVIEW]);
    const hidden = str(fd, "hidden") === "true";
    await setBranchHidden(user, str(fd, "id"), hidden);
    revalidatePath(BASE);
    return hidden ? "Hidden from the DMS." : "Shown in the DMS again.";
  });
}
