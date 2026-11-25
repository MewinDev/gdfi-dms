import { requireUser, can, hasAllBranches } from "@/lib/auth/current-user";
import { canFundsAny } from "@/lib/funds/access";
import { PERMISSIONS, SETTINGS_PERMISSIONS } from "@/lib/auth/permissions";
import { unreadNotificationCount } from "@/lib/services/queries";
import { inboxCount } from "@/lib/services/work-items";
import { pendingOpenItemCount } from "@/lib/services/open-items";
import { AppShell, type ShellNavItem } from "@/components/ui/app-shell";
import { isTestMode } from "@/lib/test-mode";
import { appEnv } from "@/lib/env";
import { myLoansMode } from "@/lib/myloans";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // D-053: Open Items in the menu, with the pending count, for the approvers (either approver tick).
  const approver = can(user, PERMISSIONS.SOURCE_REVIEW) || can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER);
  const [unread, inbox, openItems] = await Promise.all([
    unreadNotificationCount(user), inboxCount(user), approver ? pendingOpenItemCount(user) : Promise.resolve(0),
  ]);
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
    ...(approver ? [{ href: "/open-items", label: "Open Items", icon: "openitems" as const, badge: openItems }] : []),
    ...(can(user, PERMISSIONS.JOBS_WORK) ? [{ href: "/jobs", label: "Jobs", icon: "jobs" as const }] : []),
    ...(can(user, PERMISSIONS.FUNDS_REQUEST) ? [{ href: "/my-funds", label: "My funds", icon: "funds" as const }] : []),
    ...(canFundsAny(user) ? [{ href: "/funds", label: "Funds", icon: "funds" as const }] : []),
    ...(can(user, PERMISSIONS.LOANS_VIEW) && !(can(user, PERMISSIONS.JOBS_WORK) && !worksLoans) ? [worksLoans ? { href: "/loans", label: "My loans", icon: "loans" as const } : { href: "/loans", label: "Loans", icon: "loans" as const }] : []),
    ...(monitoring ? [{ href: "/monitoring", label: "Monitoring", icon: "monitor" as const }] : []),
    // Updates sits in the nav when there are no admin items (otherwise the bell in the top bar is enough).
    ...(admin.some(Boolean) ? [] : [{ href: "/notifications", label: "Updates", icon: "updates" as const, badge: unread }]),
    ...(admin[0] ? [{ href: "/admin/users", label: "Users", icon: "users" as const }] : []),
    ...(settings ? [{ href: "/admin/settings", label: "Settings", icon: "settings" as const }] : []),
    ...(auditHref ? [{ href: auditHref, label: "Audit Log", icon: "audit" as const }] : []),
  ];
  // D-058: the sidebar's person block: "All branches", the one branch, or "3 branches" (the names in a tooltip).
  const all = hasAllBranches(user);
  const branchList = all ? [] : user.branchNames;
  const branches = all ? "All branches" : branchList.length > 1 ? `${branchList.length} branches` : (branchList[0] ?? "");

  return (
    <>
      <AppShell items={items} user={{ id: user.id, name: user.name, role: user.roleName, branches, branchList: branchList.length > 1 ? branchList : [] }} unread={unread} testMode={isTestMode()} staging={appEnv() === "staging"} mockMyLoans={myLoansMode() === "mock"} findLoan={worksLoans && can(user, PERMISSIONS.LOANS_SEARCH)}>
        {children}
      </AppShell>
    </>
  );
}
