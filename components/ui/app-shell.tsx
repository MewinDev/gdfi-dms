"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "@/app/login/actions";
import { Avatar } from "./basics";
import { BellIcon, ChartIcon, ChecklistIcon, CoinsIcon, FolderIcon, HomeIcon, ListIcon, LogOutIcon, SettingsIcon, UsersIcon } from "./icons";

export type NavIcon = "home" | "loans" | "updates" | "users" | "settings" | "audit" | "jobs" | "funds" | "monitor";
export interface ShellNavItem {
  href: string;
  label: string;
  short?: string; // rail and bottom-nav label
  icon: NavIcon;
  badge?: number;
}

const ICONS: Record<NavIcon, (p: { size?: number }) => React.ReactNode> = {
  home: HomeIcon, loans: FolderIcon, updates: BellIcon, users: UsersIcon, settings: SettingsIcon, audit: ListIcon, jobs: ChecklistIcon, funds: CoinsIcon, monitor: ChartIcon,
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/loans") return pathname === "/loans" || pathname.startsWith("/loans/") || pathname === "/search";
  return pathname === href || pathname.startsWith(href + "/");
}

/** The system name, the same on every page (the page name is the heading in the content). */
export const SYSTEM_NAME = "Loan Documents Management System";

function LogoTile({ size }: { size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-white" style={{ width: size, height: size }}>
      <Image src="/logo.jpg" alt="" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} />
    </span>
  );
}

function Badge({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-navy ${className}`} aria-label={`${n} unread`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function AppShell({
  items, user, unread, testMode, staging = false, findLoan, children,
}: {
  items: ShellNavItem[];
  user: { name: string; subtitle: string };
  unread: number;
  testMode: boolean;
  /** APP_ENV=staging: a banner on every page so nobody mistakes it for the live system. */
  staging?: boolean;
  /** Loan Associate: the gold "Find loan" button (opens Loans with the search box focused). */
  findLoan: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const onLoanFile = /^\/loans\/[^/]+$/.test(pathname);
  const focusMode = onLoanFile && !!search.get("work"); // checklist task: pinned Send instead of bottom nav

  // "/" focuses the search box on the Loans page (the only page that has one).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      const box = document.getElementById("find-loan");
      if (!(box instanceof HTMLInputElement) || box.offsetParent === null) return;
      e.preventDefault();
      box.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-white sm:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar (1024px and up): navy, 264px */}
      <div className="no-print hidden w-[264px] shrink-0 bg-navy lg:block">
        <aside className="sticky top-0 flex h-[100dvh] flex-col gap-1 px-3.5 py-5 text-white">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-2 pb-[18px] pt-1 no-underline">
            <LogoTile size={44} />
            <span className="leading-tight">
              <span className="block text-[17px] font-bold text-white">GDFI DMS</span>
              <span className="block text-xs text-white/70">Loan documents</span>
            </span>
          </Link>
          <p className="px-3.5 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60" aria-hidden="true">Workspace</p>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {items.map((it) => {
              const Icon = ICONS[it.icon];
              const active = isActive(pathname, it.href);
              return (
                <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                  className={`relative flex h-[46px] items-center gap-3 rounded-[10px] px-3.5 text-[15px] no-underline ${active ? "bg-white/10 font-semibold text-white" : "font-medium text-white/88 hover:bg-white/6 hover:text-white"}`}>
                  {active && <span aria-hidden="true" className="absolute -left-3.5 bottom-[9px] top-[9px] w-1 rounded-r bg-gold" />}
                  <span className={active ? "text-gold" : ""}><Icon size={22} /></span>
                  {it.label}
                  {it.badge ? <Badge n={it.badge} className="ml-auto h-6 min-w-6 text-xs" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          {testMode && (
            <div className="mb-3 flex flex-col gap-1 rounded-xl border border-dashed border-gold/70 px-3.5 py-3">
              <p className="text-xs font-bold tracking-[0.08em] text-gold">TEST MODE</p>
              <p className="text-[13px] leading-[1.45] text-white/85">Sample loans only. Nothing here is a real loan.</p>
            </div>
          )}
          <div className="flex items-center gap-3 border-t border-white/14 px-2 pb-1 pt-3.5">
            <Avatar name={user.name} size={40} tone="gold" />
            <span className="min-w-0 flex-1 leading-[1.35]">
              <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
              <span className="block truncate text-xs text-white/70">{user.subtitle}</span>
            </span>
            <form action={signOut}>
              <button type="submit" aria-label="Sign out" title="Sign out" className="flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white">
                <LogOutIcon size={20} />
              </button>
            </form>
          </div>
        </aside>
      </div>

      {/* Tablet icon rail (600 to 1023px): navy, 84px, labels under icons */}
      <div className="no-print hidden w-[84px] shrink-0 bg-navy sm:block lg:hidden">
        <aside className="sticky top-0 flex h-[100dvh] flex-col items-center gap-1.5 py-5 text-white">
          <Link href="/dashboard" aria-label="GDFI DMS home" className="mb-4 rounded-xl"><LogoTile size={44} /></Link>
          <nav aria-label="Main" className="flex w-full flex-col items-center gap-1.5 px-2">
            {items.map((it) => {
              const Icon = ICONS[it.icon];
              const active = isActive(pathname, it.href);
              return (
                <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                  className={`relative flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] no-underline ${active ? "bg-white/10 font-semibold text-white" : "font-medium text-white/88 hover:bg-white/6"}`}>
                  <span className={active ? "text-gold" : ""}><Icon size={24} /></span>
                  {it.short ?? it.label}
                  {it.badge ? <Badge n={it.badge} className="absolute right-1 top-1" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          {testMode && <p className="mb-3 rounded-md border border-dashed border-gold/70 px-1.5 py-1 text-center text-[10px] font-bold leading-tight tracking-wide text-gold">TEST<br />MODE</p>}
          <form action={signOut}>
            <button type="submit" aria-label={`Sign out ${user.name}`} title="Sign out" className="rounded-full">
              <Avatar name={user.name} size={40} tone="gold" />
            </button>
          </form>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {staging && (
          <p role="note" className="no-print bg-gold px-4 py-1 text-center text-[13px] font-bold tracking-wide text-navy" data-staging-banner>
            Staging <span className="font-semibold">· not the live system</span>
          </p>
        )}
        {/* Tablet/desktop top bar: white, 72px. System name left; Find loan (LA), bell and user right. */}
        <header className="no-print sticky top-0 z-30 hidden h-[72px] items-center gap-4 border-b border-line bg-white px-6 sm:flex lg:px-8">
          <p className="min-w-0 flex-1 text-[17px] font-bold leading-tight text-navy lg:text-xl">{SYSTEM_NAME}</p>
          {findLoan && (
            <Link href="/loans?find=1" className="btn-gold shrink-0">Find loan</Link>
          )}
          <Link href="/notifications" aria-label={unread ? `Updates, ${unread} unread` : "Updates"} className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-line-input bg-white text-navy hover:bg-fill">
            <BellIcon size={22} />
            {unread > 0 && <Badge n={unread} className="absolute -right-1.5 -top-1.5" />}
          </Link>
          <span className="flex shrink-0 items-center gap-2.5 pl-1">
            <Avatar name={user.name} size={40} />
            <span className="max-w-36 leading-[1.3] lg:max-w-44">
              <span className="block truncate text-sm font-semibold text-navy">{user.name}</span>
              <span className="block truncate text-xs text-ink-2">{user.subtitle}</span>
            </span>
          </span>
        </header>

        {/* Phone top bar: navy with logo, the system name in two lines, and the bell */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 bg-navy px-4 text-white sm:hidden">
          <Link href="/dashboard" aria-label="Home" className="rounded-xl"><LogoTile size={36} /></Link>
          <p className="min-w-0 flex-1 text-[15px] font-bold leading-[1.2]">Loan Documents<br />Management System</p>
          {testMode && <span className="rounded-md border border-white/30 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-gold">TEST</span>}
          <Link href="/notifications" aria-label={unread ? `Updates, ${unread} unread` : "Updates"} className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white">
            <BellIcon size={24} />
            {unread > 0 && <Badge n={unread} className="absolute right-0 top-0.5" />}
          </Link>
        </header>

        <main id="main" className={`min-w-0 flex-1 px-4 pt-4 sm:p-6 lg:p-8 ${focusMode ? "pb-72 sm:pb-8" : "pb-28 sm:pb-8"}`}>
          {children}
        </main>
      </div>

      {/* Phone bottom navigation: 68px, active item marked by a gold bar */}
      {!focusMode && (
        <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
          {items.map((it) => {
            const Icon = ICONS[it.icon];
            const active = isActive(pathname, it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`relative flex h-[68px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs no-underline ${active ? "font-bold text-navy" : "font-medium text-ink-2"}`}>
                {active && <span aria-hidden="true" className="absolute left-1/2 top-0 h-1 w-12 -translate-x-1/2 rounded-b bg-gold" />}
                <span className="relative">
                  <Icon size={24} />
                  {it.badge ? <Badge n={it.badge} className="absolute -right-3 -top-1.5" /> : null}
                </span>
                <span className="max-w-full truncate px-1">{it.short ?? it.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
