import type { Tx } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { queueEmails, type EmailSpec } from "@/lib/email/outbox";

/**
 * In-app notifications, and their email channel: with `email` set, the same call queues an email
 * for the same people (or `email.to`) in the same transaction. Settings > Email notifications decides
 * whether it is sent; the outbox records every email that would go out.
 */
export interface NotifyInput {
  userIds: string[];
  loanId?: string | null;
  title: string;
  body: string;
  link?: string | null;
  email?: EmailSpec;
}

export async function notify(tx: Tx, n: NotifyInput) {
  const ids = Array.from(new Set(n.userIds));
  for (const userId of ids) {
    await tx.notification.create({
      data: { userId, loanId: n.loanId ?? null, title: n.title, body: n.body, link: n.link ?? null },
    });
  }
  if (n.email) await queueEmails(tx, n.email, { userIds: ids, loanId: n.loanId, link: n.link });
}

/** People of a branch who get branch-level updates: active, with "Accept returned papers" (the Loan Associates). */
export async function branchLaUserIds(tx: Tx, branchId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.RETURNS_ACCEPT } }, branches: { some: { branchId } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Supervisors (users who may override automatic results). */
export async function supervisorUserIds(tx: Tx): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.RULES_OVERRIDE } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
