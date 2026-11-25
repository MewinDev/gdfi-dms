/** D-058: the menu's current item (shared by the app shell and its tests). */

/** The menu item a page belongs to (a loan file and Find a loan sit under Loans). */
export function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/loans") return pathname === "/loans" || pathname.startsWith("/loans/") || pathname === "/search";
  return pathname === href || pathname.startsWith(href + "/");
}

/** The system name, the same on every page in the tablet and desktop header (the page name is the heading in the content). */
export const SYSTEM_NAME = "Loan Documents Management System";
