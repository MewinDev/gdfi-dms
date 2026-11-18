"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { addMockFailure, addScenario, clearMockFailures, resetMock } from "@/lib/services/myloans-mock";

/** Settings, System, "myloans mock" (piece 6, D-048). Refused in production (and the panel is not shown there). */
export async function myLoansMockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_SYSTEM);
    const intent = str(fd, "intent");
    const msg = intent === "fail" ? await addMockFailure(user, { endpoint: str(fd, "endpoint"), kind: str(fd, "kind"), once: fd.get("once") === "on", page: str(fd, "page") })
      : intent === "clear" ? await clearMockFailures(user)
      : intent === "scenario" ? await addScenario(user, str(fd, "scenario"))
      : intent === "reset" ? await resetMock(user)
      : "Nothing to do.";
    revalidatePath("/admin/settings");
    return msg;
  });
}
