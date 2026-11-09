import { requireUser, can } from "@/lib/auth/current-user";
import { PERMISSIONS, SETTINGS_PERMISSIONS } from "@/lib/auth/permissions";
import { unreadNotificationCount } from "@/lib/services/queries";
import { AppShell, type ShellNavItem } from "@/components/ui/app-shell";
import { isTestMode } from "@/lib/test-mode";
import { appEnv } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await unreadNotificationCount(user.id);
  // Every item follows the person's permissions (no role names).
  const worksLoans = can(user, PERMISSIONS.CHECKLIST_TICK); // Loan Associate workspace: "My loans", Find loan
  const settings = SETTINGS_PERMISSIONS.some((p) => can(user, p)) || can(user, PERMISSIONS.ROLES_MANAGE) || can(user, PERMISSIONS.TESTDATA_RESET) || can(user, PERMISSIONS.DP_CAPACITY_MANAGE);
  const monitoring = can(user, PERMISSIONS.MONITOR_DP) || can(user, PERMISSIONS.MONITOR_LTO);
  const admin = [can(user, PERMISSIONS.USERS_VIEW), settings, can(user, PERMISSIONS.AUDIT_VIEW)];
  const items: ShellNavItem[] = [
    ...([PERMISSIONS.LOANS_VIEW, PERMISSIONS.JOBS_WORK, PERMISSIONS.FUNDS_VIEW_ALL].some((p) => can(user, p)) ? [{ href: "/dashboard", label: "Home", icon: "home" as const }] : []),
    // The processor works from Jobs (and sees each loan file from there), so Loans is not in their nav.
    ...(can(user, PERMISSIONS.JOBS_WORK) ? [{ href: "/jobs", label: "Jobs", icon: "jobs" as const }] : []),
    ...(can(user, PERMISSIONS.FUNDS_REQUEST) ? [{ href: "/my-funds", label: "My funds", short: "Funds", icon: "funds" as const }] : []),
    ...(can(user, PERMISSIONS.FUNDS_VIEW_ALL) ? [{ href: "/funds", label: "Funds", icon: "funds" as const }] : []),
    ...(can(user, PERMISSIONS.LOANS_VIEW) && !(can(user, PERMISSIONS.JOBS_WORK) && !worksLoans) ? [worksLoans ? { href: "/loans", label: "My loans", short: "Loans", icon: "loans" as const } : { href: "/loans", label: "Loans", icon: "loans" as const }] : []),
    ...(monitoring ? [{ href: "/monitoring", label: "Monitoring", short: "Monitor", icon: "monitor" as const }] : []),
    // Updates sits in the nav when there are no admin items (otherwise the bell in the top bar is enough).
    ...(admin.some(Boolean) ? [] : [{ href: "/notifications", label: "Updates", icon: "updates" as const, badge: unread }]),
    ...(admin[0] ? [{ href: "/admin/users", label: "Users", icon: "users" as const }] : []),
    ...(settings ? [{ href: "/admin/settings", label: "Settings", icon: "settings" as const }] : []),
    ...(admin[2] ? [{ href: "/admin/audit", label: "Audit Log", short: "Audit", icon: "audit" as const }] : []),
  ];
  const subtitle = user.scopeBranchIds === null ? `${user.roleName} · All branches` : user.branchNames.length > 3 ? `${user.roleName} · ${user.branchNames.length} branches` : user.branchNames.join(" · ");

  return (
    <>
      <AppShell items={items} user={{ name: user.name, subtitle }} unread={unread} testMode={isTestMode()} staging={appEnv() === "staging"} findLoan={worksLoans && can(user, PERMISSIONS.LOANS_SEARCH)}>
        {children}
      </AppShell>
    </>
  );
}
