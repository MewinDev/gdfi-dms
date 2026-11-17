import { requireUser, can, hasAllBranches } from "@/lib/auth/current-user";
import { canFundsAny } from "@/lib/funds/access";
import { PERMISSIONS, SETTINGS_PERMISSIONS } from "@/lib/auth/permissions";
import { unreadNotificationCount } from "@/lib/services/queries";
import { inboxCount } from "@/lib/services/work-items";
import { AppShell, type ShellNavItem } from "@/components/ui/app-shell";
import { isTestMode } from "@/lib/test-mode";
import { appEnv } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, inbox] = await Promise.all([unreadNotificationCount(user), inboxCount(user)]);
  // Every item follows the person's permissions (no role names).
  const worksLoans = can(user, PERMISSIONS.CHECKLIST_TICK); // Loan Associate workspace: "My loans", Find loan
  const settings = SETTINGS_PERMISSIONS.some((p) => can(user, p));
  const monitoring = can(user, PERMISSIONS.MONITOR_DP) || can(user, PERMISSIONS.MONITOR_LTO);
  // Audit: the audit log, or only the file access log for someone with just that tick (D-039).
  const auditHref = can(user, PERMISSIONS.AUDIT_VIEW) ? "/admin/audit" : can(user, PERMISSIONS.FILES_LOG_VIEW) ? "/admin/audit/files" : null;
  const admin = [can(user, PERMISSIONS.USERS_VIEW), settings, !!auditHref];
  const items: ShellNavItem[] = [
    ...(([PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK].some((p) => can(user, p)) || canFundsAny(user)) ? [{ href: "/dashboard", label: "Home", icon: "home" as const }] : []),
    // The processor works from Jobs (and sees each loan file from there), so Loans is not in their nav.
    // D-046: the inbox (my items and the branch pools) for whoever takes work: LA, DP, Finance, or moves it.
    ...([PERMISSIONS.CHECKLIST_TICK, PERMISSIONS.JOBS_WORK, PERMISSIONS.WORKITEMS_MOVE].some((p) => can(user, p)) || canFundsAny(user) ? [{ href: "/inbox", label: "Inbox", icon: "inbox" as const, badge: inbox }] : []),
    ...(can(user, PERMISSIONS.JOBS_WORK) ? [{ href: "/jobs", label: "Jobs", icon: "jobs" as const }] : []),
    ...(can(user, PERMISSIONS.FUNDS_REQUEST) ? [{ href: "/my-funds", label: "My funds", short: "Funds", icon: "funds" as const }] : []),
    ...(canFundsAny(user) ? [{ href: "/funds", label: "Funds", icon: "funds" as const }] : []),
    ...(can(user, PERMISSIONS.LOANS_VIEW) && !(can(user, PERMISSIONS.JOBS_WORK) && !worksLoans) ? [worksLoans ? { href: "/loans", label: "My loans", short: "Loans", icon: "loans" as const } : { href: "/loans", label: "Loans", icon: "loans" as const }] : []),
    ...(monitoring ? [{ href: "/monitoring", label: "Monitoring", short: "Monitor", icon: "monitor" as const }] : []),
    // Updates sits in the nav when there are no admin items (otherwise the bell in the top bar is enough).
    ...(admin.some(Boolean) ? [] : [{ href: "/notifications", label: "Updates", icon: "updates" as const, badge: unread }]),
    ...(admin[0] ? [{ href: "/admin/users", label: "Users", icon: "users" as const }] : []),
    ...(settings ? [{ href: "/admin/settings", label: "Settings", icon: "settings" as const }] : []),
    ...(auditHref ? [{ href: auditHref, label: "Audit Log", short: "Audit", icon: "audit" as const }] : []),
  ];
  const subtitle = hasAllBranches(user) ? `${user.roleName} · All branches` : user.branchNames.length > 3 ? `${user.roleName} · ${user.branchNames.length} branches` : user.branchNames.join(" · ");

  return (
    <>
      <AppShell items={items} user={{ name: user.name, subtitle }} unread={unread} testMode={isTestMode()} staging={appEnv() === "staging"} findLoan={worksLoans && can(user, PERMISSIONS.LOANS_SEARCH)}>
        {children}
      </AppShell>
    </>
  );
}
