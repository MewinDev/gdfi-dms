import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { writeAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { holdsWhere } from "@/lib/auth/holders";

/**
 * API 1 sent several records for one PN (409, D-036 item 4): the people who manage the myloans link are told, at most
 * once an hour per PN, and it is audited. The PN only; no borrower details in the message.
 */
export async function alertMultiple(pn: string, rows: number): Promise<void> {
  const title = `myloans has ${rows} records for PN ${pn}`;
  const since = new Date(Date.now() - 3_600_000);
  if (await prisma.notification.count({ where: { title, createdAt: { gte: since } } })) return;
  const ids = (await prisma.user.findMany({ where: { ...holdsWhere(PERMISSIONS.SOURCE_MANAGE), active: true }, select: { id: true } })).map((u) => u.id);
  await prisma.$transaction(async (tx) => {
    await notify(tx, { userIds: ids, title, body: "Find loan used the one released record, or stopped when there was none. Ask the myloans team to check this PN.", link: "/admin/settings?open=myloans-sync" });
    await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "myloans_multiple_records", entityType: "Loan", entityId: pn, pn, summary: `${title} (API 1 answered 409)` });
  });
}
