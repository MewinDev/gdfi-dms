"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { UserError } from "@/lib/services/errors";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { assertKitAction } from "@/lib/kit/access";
import { backupNameRefusal, confirmRefusal } from "@/lib/kit/guard";

/**
 * Settings > Test kit. Every action checks, on the server and on every call, that the kit is available
 * here (assertKitAction: APP_ENV=local, TEST_MODE, gdfi_dms) and that the person may reset test data
 * (Admin). Reset and Restore need the typed word RESET and take an automatic backup first.
 */

async function kitUser() {
  assertKitAction();
  return requirePermission(PERMISSIONS.TESTDATA_RESET);
}

/** After a restore the old connections are gone: start a fresh pool, so the next page loads at once. */
async function reconnect() {
  await prisma.$disconnect().catch(() => {});
}

export async function kitResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await kitUser();
    const why = confirmRefusal(str(fd, "confirm"));
    if (why) throw new UserError(why, "confirm");
    const { restoreSave, BASELINE_NAME } = await import("@/lib/kit/core");
    const lines: string[] = [];
    restoreSave(BASELINE_NAME, (l) => lines.push(l));
    await reconnect();
    revalidatePath("/", "layout");
    return `Back to the starting state. ${lines.at(-1) ?? ""}`.trim();
  });
}

export async function kitRestoreAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await kitUser();
    const why = confirmRefusal(str(fd, "confirm"));
    if (why) throw new UserError(why, "confirm");
    const name = str(fd, "name");
    if (!name || name === "baseline") throw new UserError("Pick a backup.");
    const { restoreSave } = await import("@/lib/kit/core");
    restoreSave(name, () => {});
    await reconnect();
    revalidatePath("/", "layout");
    return `Restored the backup "${name}".`;
  });
}

export async function kitBackupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await kitUser();
    const name = str(fd, "name");
    const why = backupNameRefusal(name);
    if (why) throw new UserError(why, "name");
    const { readManifest, saveDump } = await import("@/lib/kit/core");
    if (readManifest(name)) throw new UserError(`A backup called "${name}" already exists. Pick another name.`, "name");
    await prisma.$transaction((tx) => writeAudit(tx, { actor: { id: user.id, label: user.name }, mode: "MANUAL", action: "kit_backup", entityType: "TestKit", summary: `Test kit: saved the backup ${name}` }));
    saveDump(name, "backup", () => {});
    revalidatePath("/admin/settings");
    return `Saved the backup "${name}".`;
  });
}
