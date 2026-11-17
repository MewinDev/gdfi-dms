"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { reclassifyLoan, saveClassificationRules } from "@/lib/services/classification";
import { classificationWord } from "@/lib/rules/classify";

/** Settings, Product classification: Save (D-031). Re-checks open loan files and says how many were flagged. */
export async function saveClassificationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_CLASSIFICATION);
    const r = await saveClassificationRules(user, { refinancing: str(fd, "refinancing"), financing: str(fd, "financing"), fallback: str(fd, "fallback") });
    revalidatePath("/admin/settings");
    revalidatePath("/loans");
    return r.flagged
      ? `Saved. ${r.flagged} open loan file${r.flagged === 1 ? " is" : "s are"} now flagged "Classification changed since accepted"; someone with "Reclassify a loan" decides each one.`
      : "Saved. No open loan file changes classification.";
  });
}

/** Loan File: Reclassify (D-031), remarks required. */
export async function reclassifyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.LOANS_RECLASSIFY);
    const p = await reclassifyLoan(user, str(fd, "loanId"), {
      note: str(fd, "note"),
      financingType: str(fd, "financingType") || null,
      orcrStatus: str(fd, "orcrStatus") || null,
    });
    revalidatePath(`/loans/${str(fd, "pn")}`);
    return `Reclassified as ${classificationWord(p.classificationNext!)}. ${p.sentences.join(" ")}`;
  });
}
