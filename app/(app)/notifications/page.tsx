import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { fmtDateTime } from "@/lib/time";
import { plainUpdate, timeAgo } from "@/lib/ui/plain";
import { markNotificationsReadAction } from "@/app/actions/loan";
import { signOut } from "@/app/login/actions";
import { ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/basics";
import { MyEmailPreference } from "@/components/admin/email";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Updates" };

export default async function UpdatesPage() {
  const user = await requireUser();
  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { loan: { select: { borrowerName: true } } },
  });
  const unread = rows.filter((r) => !r.readAt).length;
  // The person's own email choice (there is no profile menu: it lives with the updates it is about).
  const [me, emailsActive] = await Promise.all([prisma.user.findUnique({ where: { id: user.id }, select: { emailNonUrgent: true } }), getSetting("email.active")]);
  const now = new Date();
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Updates" help={unread ? `${unread} new` : "You have read everything."}>
        {unread > 0 && (
          <form action={markNotificationsReadAction}>
            <button type="submit" className="link inline-flex min-h-11 items-center text-[15px]">Mark all as read</button>
          </form>
        )}
      </PageHeader>
      <MyEmailPreference on={me?.emailNonUrgent ?? true} active={emailsActive} />
      {rows.length === 0 ? (
        <p className="card p-6 text-[15px] text-ink-2">No updates yet. We will tell you here when something happens on your loans.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((n) => {
            const body = (
              <>
                <span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.readAt ? "bg-line" : "bg-gold"}`} />
                <span className="min-w-0 flex-1">
                  {!n.readAt && <span className="sr-only">New: </span>}
                  <span className={`block text-[15px] leading-snug ${n.readAt ? "text-ink" : "font-semibold text-ink"}`}>{plainUpdate(n.title, n.loan?.borrowerName)}</span>
                  <time dateTime={n.createdAt.toISOString()} title={fmtDateTime(n.createdAt)} className="mt-0.5 block text-sm text-ink-2">{timeAgo(n.createdAt, now)}</time>
                </span>
                {n.link && <span className="self-center text-ink-2"><ChevronRightIcon size={18} /></span>}
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="flex min-h-[72px] gap-3 px-5 py-4 text-inherit no-underline hover:bg-hover">{body}</Link>
                ) : (
                  <div className="flex min-h-[72px] gap-3 px-5 py-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form action={signOut} className="flex items-center justify-between gap-3 border-t border-line pt-4 sm:hidden">
        <span className="text-sm text-ink-2">Signed in as {user.name}</span>
        <button type="submit" className="btn-ghost btn-sm">Sign out</button>
      </form>
    </div>
  );
}
