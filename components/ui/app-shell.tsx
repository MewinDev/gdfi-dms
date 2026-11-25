"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signOut } from "@/app/login/actions";
import { Avatar } from "./basics";
import {
  BellIcon, ChartIcon, ChecklistIcon, CoinsIcon, FolderIcon, HomeIcon, InboxIcon, ListIcon, LogOutIcon, MenuIcon, PanelCloseIcon, PanelOpenIcon,
  RefreshIcon, SettingsIcon, UsersIcon,
} from "./icons";
import { isActive, SYSTEM_NAME } from "@/lib/ui/nav";

export { SYSTEM_NAME };

export type NavIcon = "home" | "loans" | "updates" | "users" | "settings" | "audit" | "jobs" | "funds" | "monitor" | "inbox" | "openitems";
export interface ShellNavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
}

const ICONS: Record<NavIcon, (p: { size?: number }) => React.ReactNode> = {
  home: HomeIcon, loans: FolderIcon, updates: BellIcon, users: UsersIcon, settings: SettingsIcon, audit: ListIcon, jobs: ChecklistIcon, funds: CoinsIcon, monitor: ChartIcon, inbox: InboxIcon, openitems: RefreshIcon,
};

/** Pages with their own search box: the header has no Find loan button there (one Find loan per page). */
const hasSearchBox = (pathname: string) => pathname === "/loans" || pathname === "/search";

/* ---------------------------------------------------------------------------------------------------------------
 * D-058: one sidebar, three behaviours (no bottom bar).
 *   Phone (< 768px): hidden; the menu button in the header opens it as a drawer over a dark overlay.
 *   Tablet (768 to 1279px): a 72px icon rail with tooltips; a button widens it to the full sidebar.
 *   Desktop (1280px and up): the full 264px sidebar; the same button narrows it to the rail.
 * The tablet and desktop choices are remembered per person in this browser (localStorage, best effort).
 * Layout, top to bottom: the logo and the collapse button; the menu (scrolls when long); the TEST MODE line
 * (never in production); the person (avatar, name, role, branches, Sign out), pinned to the bottom.
 * ------------------------------------------------------------------------------------------------------------- */

type View = "phone" | "tablet" | "desktop";
const MQ_TABLET = "(min-width: 768px)";
const MQ_DESKTOP = "(min-width: 1280px)";

function subscribeView(cb: () => void) {
  const a = window.matchMedia(MQ_TABLET);
  const b = window.matchMedia(MQ_DESKTOP);
  a.addEventListener("change", cb);
  b.addEventListener("change", cb);
  return () => { a.removeEventListener("change", cb); b.removeEventListener("change", cb); };
}
const viewNow = (): View => (window.matchMedia(MQ_DESKTOP).matches ? "desktop" : window.matchMedia(MQ_TABLET).matches ? "tablet" : "phone");

type NavPref = { tablet?: "rail" | "full"; desktop?: "rail" | "full" };
const PREF_EVENT = "gdfi-dms:nav-pref";
export const navPrefKey = (userId: string) => `gdfi-dms:nav:${userId}`;

function readPrefRaw(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function parsePref(raw: string | null): NavPref {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as NavPref;
    return { tablet: v.tablet === "full" ? "full" : v.tablet === "rail" ? "rail" : undefined, desktop: v.desktop === "rail" ? "rail" : v.desktop === "full" ? "full" : undefined };
  } catch { return {}; }
}
function writePref(key: string, pref: NavPref) {
  try { window.localStorage.setItem(key, JSON.stringify(pref)); } catch { /* private window or blocked storage: the choice lasts until reload */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}
function subscribePref(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PREF_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(PREF_EVENT, cb); };
}

/** "auto" before the browser has said its width (server render): CSS decides, rail at tablet, full at desktop. */
type Mode = "auto" | "full" | "rail";

function LogoTile({ size }: { size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-white" style={{ width: size, height: size }}>
      <Image src="/logo.jpg" alt="" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} />
    </span>
  );
}

function Badge({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-navy ${className}`} data-nav-badge>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export interface ShellUser {
  id: string;
  name: string;
  /** "Loan Associate". */
  role: string;
  /** "All branches", the one branch's name, or "3 branches". */
  branches: string;
  /** With two or more branches: their names, for the tooltip. Empty otherwise. */
  branchList: string[];
}

/** Classes that differ between the full sidebar and the rail. Literal strings, so Tailwind sees them. */
const M = {
  width: { auto: "w-[72px] xl:w-[264px]", full: "w-[264px]", rail: "w-[72px]" },
  showFull: { auto: "hidden xl:flex", full: "flex", rail: "hidden" },
  showRail: { auto: "flex xl:hidden", full: "hidden", rail: "flex" },
  label: { auto: "sr-only xl:not-sr-only", full: "", rail: "sr-only" },
  link: { auto: "justify-center px-0 xl:justify-start xl:px-3.5", full: "justify-start px-3.5", rail: "justify-center px-0" },
  pad: { auto: "px-2 xl:px-3.5", full: "px-3.5", rail: "px-2" },
  badge: { auto: "absolute right-1 top-1 xl:static xl:ml-auto", full: "ml-auto", rail: "absolute right-1 top-1" },
  /** Top row: logo then the collapse button on one line; in the rail the button sits above the logo. */
  head: { auto: "flex-col-reverse items-center gap-3 xl:flex-row xl:gap-2", full: "flex-row items-center gap-2", rail: "flex-col-reverse items-center gap-3" },
  /** The person: one row (avatar, text, Sign out); in the rail the avatar above the Sign out icon. */
  user: { auto: "flex-col gap-1 xl:flex-row xl:gap-2.5", full: "flex-row gap-2.5", rail: "flex-col gap-1" },
} as const;

type TipPlace = "right" | "above-start" | "above-end";
type Tip = { show: (el: HTMLElement, text: string, place?: TipPlace) => void; hide: () => void };

function SidebarBody({
  items, user, mode, testMode, pathname, onNavigate, collapse, tip,
}: {
  items: ShellNavItem[];
  user: ShellUser;
  mode: Mode;
  testMode: boolean;
  pathname: string;
  /** The drawer closes after a page is chosen. */
  onNavigate?: () => void;
  /** Tablet and desktop: the collapse / expand button (absent in the phone drawer). */
  collapse?: { expanded: boolean; toggle: () => void };
  tip: Tip;
}) {
  const on = (text: string, place: TipPlace = "right") => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => tip.show(e.currentTarget, text, place),
    onMouseLeave: tip.hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => tip.show(e.currentTarget, text, place),
    onBlur: tip.hide,
  });
  /** Tooltips that only the rail needs (the labels are hidden there). */
  const railTip = (text: string) => (mode !== "full" ? on(text) : {});
  /** In the rail tooltips go to the right; in the full sidebar the bottom block's go above. */
  const footPlace = (end: boolean): TipPlace => (mode === "full" ? (end ? "above-end" : "above-start") : "right");
  const many = user.branchList.length > 1;
  const who = `${user.name} · ${user.role} · ${many ? user.branchList.join(", ") : user.branches}`;
  const collapseLabel = collapse ? (collapse.expanded ? "Collapse menu" : "Expand menu") : "";
  return (
    <div className="flex h-full min-h-0 flex-col text-white">
      {/* Top: the logo (Home) and the icon-only collapse button. */}
      <div className={`flex shrink-0 pb-3 pt-4 ${M.pad[mode]} ${collapse ? M.head[mode] : "flex-row items-center"}`}>
        <Link href="/dashboard" onClick={onNavigate} className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 self-stretch rounded-xl no-underline ${M.link[mode]}`} {...railTip("Home")}>
          <LogoTile size={40} />
          <span className={`min-w-0 leading-tight ${M.label[mode]}`}>
            <span className="block text-[17px] font-bold text-white">GDFI DMS</span>
            <span className="block text-[13px] text-white/75">Loan documents</span>
          </span>
        </Link>
        {collapse && (
          <button type="button" onClick={collapse.toggle} aria-expanded={collapse.expanded} aria-controls="main-sidebar" aria-label={collapseLabel} data-nav-collapse
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-white/80 hover:bg-white/10 hover:text-white" {...on(collapseLabel)}>
            {collapse.expanded ? <PanelCloseIcon size={20} /> : <PanelOpenIcon size={20} />}
          </button>
        )}
      </div>

      {/* The menu: scrolls on its own when the list is long; the person's block below never scrolls away. */}
      <nav aria-label="Main" className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden overscroll-contain py-1 ${M.pad[mode]}`} data-main-nav
        onScroll={tip.hide}>
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          const active = isActive(pathname, it.href);
          const tipText = it.badge ? `${it.label} (${it.badge})` : it.label;
          return (
            <Link key={it.href} href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined} data-nav-item={it.href}
              aria-label={it.badge ? `${it.label}, ${it.badge}` : undefined}
              className={`relative flex min-h-12 shrink-0 items-center gap-3 rounded-[10px] text-[15px] no-underline ${M.link[mode]} ${active ? "bg-white/14 font-semibold text-white" : "font-medium text-white/90 hover:bg-white/8 hover:text-white"}`}
              {...railTip(tipText)}>
              {active && <span aria-hidden="true" className="absolute -left-2 bottom-[10px] top-[10px] w-1 rounded-r bg-gold" />}
              <span className={active ? "text-gold" : ""}><Icon size={22} /></span>
              <span className={M.label[mode]}>{it.label}</span>
              {it.badge ? <Badge n={it.badge} className={M.badge[mode]} /> : null}
            </Link>
          );
        })}
      </nav>

      <div className={`shrink-0 pb-3 pt-2 ${M.pad[mode]}`}>
        {/* TEST_MODE only, which is always off in production (lib/test-mode.ts). */}
        {testMode && (
          <p className="mb-2 rounded-lg border border-dashed border-gold/70 px-2 py-1 text-center text-xs leading-snug text-white/85" data-test-mode>
            <span className="font-bold tracking-[0.06em] text-gold">TEST</span>
            <span className={M.label[mode]}><span className="font-bold tracking-[0.06em] text-gold"> MODE</span> · sample loans only</span>
          </p>
        )}
        {/* The person, pinned to the bottom. */}
        <div className={`flex items-center border-t border-white/14 pt-3 ${M.user[mode]}`} data-nav-user>
          <span className={`items-center justify-center rounded-full ${M.showRail[mode]}`} tabIndex={0} role="img" aria-label={who} {...on(who)} data-nav-avatar>
            <Avatar name={user.name} size={40} tone="gold" />
          </span>
          <span className={`min-w-0 flex-1 items-center gap-2.5 ${M.showFull[mode]}`}>
            <Avatar name={user.name} size={40} tone="gold" />
            <span className="min-w-0 flex-1 leading-[1.35]">
              <span className="block break-words text-sm font-semibold text-white" data-nav-name>{user.name}</span>
              <span className="block break-words text-[13px] text-white/75" data-nav-role>{user.role}</span>
              {user.branches && (many ? (
                <span tabIndex={0} className="block w-fit rounded text-xs text-white/75 underline decoration-dotted underline-offset-2" data-nav-branches {...on(user.branchList.join(" · "), footPlace(false))}>
                  {user.branches}<span className="sr-only">: {user.branchList.join(", ")}</span>
                </span>
              ) : (
                <span className="block break-words text-xs text-white/75" data-nav-branches>{user.branches}</span>
              ))}
            </span>
          </span>
          <form action={signOut} className="shrink-0">
            <button type="submit" aria-label="Sign out" data-nav-signout {...on("Sign out", footPlace(true))}
              className="flex h-11 w-11 items-center justify-center rounded-[10px] text-white/85 hover:bg-white/10 hover:text-white">
              <LogOutIcon size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  items, user, unread, testMode, staging = false, mockMyLoans = false, findLoan, children,
}: {
  items: ShellNavItem[];
  user: ShellUser;
  unread: number;
  testMode: boolean;
  /** APP_ENV=staging: a banner on every page so nobody mistakes it for the live system. */
  staging?: boolean;
  /** MYLOANS_MODE=mock (D-048): a banner on every page, so nobody mistakes sample myloans data for the real thing. */
  mockMyLoans?: boolean;
  /** Loan Associate: the gold "Find loan" button in the header (opens My loans with the search box focused). */
  findLoan: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const onLoanFile = /^\/loans\/[^/]+$/.test(pathname);
  const focusMode = onLoanFile && !!search.get("work"); // checklist task: the pinned Send bar on a phone

  const view = useSyncExternalStore(subscribeView, viewNow, () => null);
  const key = navPrefKey(user.id);
  const prefRaw = useSyncExternalStore(subscribePref, () => readPrefRaw(key), () => null);
  const pref = parsePref(prefRaw);
  const expanded = view === "desktop" ? pref.desktop !== "rail" : view === "tablet" ? pref.tablet === "full" : null;
  const mode: Mode = expanded === null ? "auto" : expanded ? "full" : "rail";
  const toggle = useCallback(() => {
    if (view !== "tablet" && view !== "desktop") return;
    const cur = parsePref(readPrefRaw(key));
    const now = view === "desktop" ? cur.desktop !== "rail" : cur.tablet === "full";
    writePref(key, { ...cur, [view]: now ? "rail" : "full" });
  }, [view, key]);

  // Tooltips: one fixed bubble beside or above the hovered or focused control (not clipped by the scrolling menu).
  const [tipRaw, setTipState] = useState<{ text: string; top: number; left: number; place: TipPlace; at: string } | null>(null);
  // A tooltip belongs to one layout: it goes when the sidebar changes width, the page changes or the drawer closes.
  const tipAt = `${mode}|${pathname}`;
  const tip: Tip = {
    show: (el, text, place = "right") => {
      const r = el.getBoundingClientRect();
      setTipState(place === "right" ? { text, place, at: tipAt, top: r.top + r.height / 2, left: r.right + 8 } : { text, place, at: tipAt, top: r.top - 6, left: place === "above-end" ? r.right : r.left });
    },
    hide: () => setTipState(null),
  };

  // Phone drawer.
  const [open, setOpen] = useState(false);
  const tipState = tipRaw && tipRaw.at === tipAt && (open || view !== "phone") ? tipRaw : null;
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // Focus moves into the drawer: the current page's link (or the first link).
      const d = drawer.current;
      (d?.querySelector<HTMLElement>('[aria-current="page"]') ?? d?.querySelector<HTMLElement>("a[href]"))?.focus({ preventScroll: true });
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
        if (e.key !== "Tab" || !drawer.current) return;
        // Focus stays inside the drawer.
        const f = [...drawer.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!drawer.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener("keydown", onKey);
      return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }
    // Closed again: focus goes back to the menu button.
    if (wasOpen.current) { wasOpen.current = false; menuBtn.current?.focus(); }
  }, [open]);

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
    <div className="min-h-[100dvh] bg-white md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Tablet and desktop: the rail or the full sidebar (navy). */}
      <div id="main-sidebar" className={`no-print hidden shrink-0 bg-navy transition-[width] duration-150 md:block ${M.width[mode]}`} data-sidebar={mode}>
        <aside aria-label="Menu" className="sticky top-0 h-[100dvh] overflow-hidden">
          <SidebarBody items={items} user={user} mode={mode} testMode={testMode} pathname={pathname} collapse={{ expanded: mode === "full", toggle }} tip={tip} />
        </aside>
      </div>
      {tipState && (
        <span role="tooltip"
          className={`pointer-events-none fixed z-[60] max-w-[18rem] rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/20 ${tipState.place === "right" ? "-translate-y-1/2 whitespace-nowrap" : tipState.place === "above-end" ? "-translate-x-full -translate-y-full" : "-translate-y-full"}`}
          style={{ top: tipState.top, left: tipState.left }} data-nav-tooltip>
          {tipState.text}
        </span>
      )}

      {/* Phone: the same sidebar as a drawer that slides in over a dark overlay. No close button on show: a tap
          outside, a swipe to the left, Esc or choosing a page closes it. Keyboard users get a "Close menu" button
          that appears only when it has focus (the last stop in the drawer). */}
      <div className={`no-print fixed inset-0 z-50 md:hidden ${open ? "visible" : "invisible pointer-events-none delay-200"} transition-[visibility] duration-0`} data-nav-drawer={open ? "open" : "closed"}>
        <div className={`absolute inset-0 bg-navy/60 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} onClick={close} aria-hidden="true" data-drawer-overlay />
        <div ref={drawer} id="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu" aria-hidden={!open} inert={!open}
          onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            const s0 = swipe.current;
            swipe.current = null;
            if (!s0) return;
            const dx = e.changedTouches[0].clientX - s0.x;
            const dy = e.changedTouches[0].clientY - s0.y;
            if (dx < -60 && Math.abs(dx) > Math.abs(dy)) close();
          }}
          className={`absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col bg-navy pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="min-h-0 flex-1">
            <SidebarBody items={items} user={user} mode="full" testMode={testMode} pathname={pathname} onNavigate={close} tip={tip} />
          </div>
          <button type="button" onClick={close} data-drawer-close
            className="sr-only focus:not-sr-only focus:mx-3.5 focus:mb-3 focus:flex focus:min-h-11 focus:items-center focus:justify-center focus:rounded-[10px] focus:border focus:border-white/30 focus:text-sm focus:font-semibold focus:text-white">
            Close menu
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {staging && (
          <p role="note" className="no-print truncate bg-gold px-4 py-1 text-center text-[13px] font-bold tracking-wide text-navy" data-staging-banner>
            Staging <span className="font-semibold">· not the live system</span>
          </p>
        )}
        {mockMyLoans && (
          <p role="note" className="no-print overflow-hidden whitespace-nowrap border-b border-act-line bg-act-bg px-4 py-1 text-center text-[13px] font-bold tracking-wide text-act-fg" data-mock-banner>
            MOCK myloans<span className="font-semibold"><span className="md:hidden"> · sample data</span><span className="hidden md:inline"> data · loans come from the sample myloans, not the real one</span></span>
          </p>
        )}
        {/* Tablet and desktop: white, 72px. The system name left; Find loan (LA, pages without a search box) and the bell right. */}
        <header className="no-print sticky top-0 z-30 hidden h-[72px] items-center gap-4 border-b border-line bg-white px-6 md:flex xl:px-8">
          <p className="min-w-0 flex-1 truncate text-[18px] font-bold leading-tight text-navy xl:text-xl" data-system-name>{SYSTEM_NAME}</p>
          {findLoan && !hasSearchBox(pathname) && <Link href="/loans?find=1" className="btn-gold shrink-0" data-header-find>Find loan</Link>}
          <BellLink unread={unread} className="h-[46px] w-[46px] border border-line-input bg-white text-navy hover:bg-fill" />
        </header>

        {/* Phone: navy, 56px, one line. Menu, logo, "GDFI DMS", the bell. */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 bg-navy pl-1.5 pr-2 text-white md:hidden">
          <button ref={menuBtn} type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="nav-drawer" data-menu-button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white hover:bg-white/10">
            <MenuIcon size={24} />
          </button>
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl text-white no-underline">
            <LogoTile size={32} />
            <span className="truncate text-[17px] font-bold"><span aria-hidden="true">GDFI DMS</span><span className="sr-only">{SYSTEM_NAME}</span></span>
          </Link>
          {testMode && <span className="shrink-0 rounded-md border border-white/30 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-gold">TEST</span>}
          <BellLink unread={unread} className="h-11 w-11 text-white hover:bg-white/10" />
        </header>

        <main id="main" className={`min-w-0 flex-1 px-4 pt-4 sm:p-6 xl:p-8 ${focusMode ? "pb-72 sm:pb-8" : "pb-24 sm:pb-8"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

function BellLink({ unread, className }: { unread: number; className: string }) {
  return (
    <Link href="/notifications" aria-label={unread ? `Updates, ${unread} unread` : "Updates"} className={`relative flex shrink-0 items-center justify-center rounded-xl ${className}`}>
      <BellIcon size={22} />
      {unread > 0 && <Badge n={unread} className="absolute -right-1 -top-1" />}
    </Link>
  );
}
