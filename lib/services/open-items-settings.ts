import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { MONITORABLE_FIELDS, OI_FIELDS } from "@/lib/open-items/fields";
import { UserError } from "./errors";

/**
 * Settings, Open Items (D-012): which loan and borrower fields raise Open Items. The status always does (it blocks
 * Forward, D-053). A field switched off is still compared, but a change to it raises nothing. myloans:manage; audited.
 */
export async function saveMonitoredFields(u: CurrentUser, raw: string[]) {
  if (!can(u, PERMISSIONS.SOURCE_MANAGE)) throw new UserError("Ask a Superadmin to turn on \"Change MyLoans sync settings\" for your role.");
  const fields = MONITORABLE_FIELDS.filter((f) => raw.includes(f));
  await prisma.$transaction(async (tx) => {
    const before = await getSetting("openItems.monitoredFields", tx);
    await setSetting("openItems.monitoredFields", fields, tx);
    const label = (xs: string[]) => xs.map((f) => OI_FIELDS[f as keyof typeof OI_FIELDS]?.label ?? f).join(", ") || "none";
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "open_items_fields_saved", entityType: "Setting", entityId: "openItems.monitoredFields", summary: `${u.name} set the fields that raise Open Items: ${label(fields)}`, before: { fields: before }, after: { fields } });
  });
}
