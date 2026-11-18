"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { reclassifyLoan, saveClassificationRules } from "@/lib/services/classification";
import { classificationWord } from "@/lib/rules/classify";
import { refreshProducts, setProductClassification } from "@/lib/services/products";

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

/** Settings, Product classification (D-049): set one product to Financing or Refinancing, or back to the keywords. */
export async function setProductClassificationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_CLASSIFICATION);
    const raw = str(fd, "value");
    const value = raw === "FINANCING" || raw === "REFINANCING" ? raw : null;
    const r = await setProductClassification(user, str(fd, "productId"), value, str(fd, "reason"));
    revalidatePath("/admin/settings");
    revalidatePath("/loans");
    return `${value ? `Set to ${classificationWord(value)}` : "Back to the keywords"}.${r.flagged ? ` ${r.flagged} open loan file${r.flagged === 1 ? " is" : "s are"} flagged "Classification changed since accepted".` : ""}`;
  });
}

/** Settings, Product classification (D-049): read the product list from myloans (API 5) now. */
export async function refreshProductsAction(): Promise<ActionState> {
  return runAction(async () => {
    await requirePermission(PERMISSIONS.SETTINGS_CLASSIFICATION);
    const r = await refreshProducts();
    revalidatePath("/admin/settings");
    return `Product list from myloans: ${r.total} products (${r.added} new, ${r.renamed} renamed, ${r.inactive} no longer sent).`;
  });
}
