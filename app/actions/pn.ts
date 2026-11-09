"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { savePnFormat } from "@/lib/services/pn-settings";

/** Settings, System, PN format. */
export async function savePnFormatAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_PN_FORMAT);
    await savePnFormat(user, {
      enabled: fd.get("enabled") === "on",
      prefix: str(fd, "prefix"), branchDigits: str(fd, "branchDigits"), yearDigits: str(fd, "yearDigits"), system: str(fd, "system"), runningDigits: str(fd, "runningDigits"),
    });
    revalidatePath("/admin/settings");
    return "PN format saved.";
  });
}
