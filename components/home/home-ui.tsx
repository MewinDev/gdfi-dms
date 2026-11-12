import Link from "next/link";
import { APP_TIMEZONE } from "@/lib/time";
import { greeting } from "@/lib/ui/plain";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

/**
 * The Home page building blocks, the same for every role (docs/workflow, Home):
 * header, summary strip, "Do these next", alert cards shown only when non-zero, the "All clear" line.
 * One card style: white, 1px hairline, 8px radius, no shadow; 16px padding (12px on a phone).
 */
export const HOME_CARD = "rounded-lg border border-line bg-white";

/** "Home", and one muted line: the date and a greeting with the first name (never a count). */
export function HomeHeader({ name, now = new Date(), children }: { name: string; now?: Date; children?: React.ReactNode }) {
  const date = new Intl.DateTimeFormat("en-PH", { timeZone: APP_TIMEZONE, weekday: "long", month: "long", day: "numeric" }).format(now);
  const first = name.trim().split(/\s+/)[0] ?? "";
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2" data-home-header>
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold leading-tight text-navy">Home</h1>
        <p className="text-sm text-ink-2" data-home-greeting>{date} · {greeting(now)}{first ? `, ${first}` : ""}</p>
      </div>
      {children}
    </header>
  );
}

export interface Segment {
  /** Stable key (tests, React). */
  key: string;
  n: number;
  label: string;
  /** Where the old count card linked; none: the number is shown without a link. */
  href?: string;
  /** Amber (needs you) or red (problems), only when above zero. */
  dot?: "act" | "bad";
  /** A small icon in a tile; the tile is amber or red when the count needs attention, grey otherwise. */
  icon?: React.ReactNode;
}

/** The icon tile used by every Home card: neutral by default, amber for attention, red for problems. */
export function IconTile({ children, tone = "mute", size = "md", data }: { children: React.ReactNode; tone?: "mute" | "act" | "bad" | "wait" | "hold" | "navy"; size?: "sm" | "md"; data?: Record<string, string> }) {
  const t = tone === "act" ? "bg-act-bg text-act-fg" : tone === "bad" ? "bg-bad-bg text-bad-fg" : tone === "wait" ? "bg-wait-bg text-wait-fg" : tone === "hold" ? "bg-hold-bg text-hold-fg" : tone === "navy" ? "bg-fill text-navy" : "bg-fill text-ink-2";
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-md ${size === "sm" ? "h-7 w-7" : "h-7 w-7 sm:h-9 sm:w-9"} ${t}`} {...data}>{children}</span>;
}

/** Columns: all in one row up to four (three on a phone when there are three); otherwise three per row. */
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

/**
 * The counts as small, separate cards (about 60px tall), one per count; each opens where the old count card
 * did. An icon tile, then the number and the label under it; a zero is grey; the tile is amber when something
 * needs the person and red for problems (grey otherwise). Never more than two rows from 640px (three per row when there are five or six).
 */
export function SummaryStrip({ items }: { items: Segment[] }) {
  const cols = COLS[items.length] ?? "grid-cols-2 sm:grid-cols-3";
  return (
    <section aria-label="Counts" data-home-strip>
      <ul className={`grid gap-2 sm:gap-3 ${cols}`}>
        {items.map((s) => {
          const on = s.n > 0;
          const tone = s.dot && on ? s.dot : "mute";
          const body = (
            <>
              {/* Phone: the number with the icon on its right, the label under both. From 640px: the icon on the left. */}
              {s.icon && <span className="col-start-2 row-start-1 sm:col-start-1 sm:row-span-2"><IconTile tone={tone} data={s.dot && on ? { "data-dot": s.dot } : undefined}>{s.icon}</IconTile></span>}
              <span className={`col-start-1 row-start-1 text-[20px] font-semibold leading-none sm:col-start-2 sm:text-[22px] ${on ? "text-navy" : "text-ink-2"}`}>{s.n}</span>
              <span className="col-span-2 row-start-2 mt-1 text-[12px] leading-tight text-ink-2 sm:col-span-1 sm:col-start-2 sm:text-[13px]">{s.label}</span>
            </>
          );
          const cls = `${HOME_CARD} grid h-full min-h-[60px] grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-2 px-2.5 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3 sm:px-4`;
          return (
            <li key={s.key} className="min-w-0" data-segment={s.key} data-count={s.n}>
              {s.href ? (
                <Link href={s.href} aria-label={`${s.n} ${s.label}, open`} className={`${cls} text-inherit no-underline hover:border-line-strong hover:bg-fill`}>{body}</Link>
              ) : (
                <span className={cls} aria-label={`${s.n} ${s.label}`}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The main list block ("Do these next"): a title, the rows, and "See all (N)" when there are more. */
export function ListBlock({ id, title, icon, children, more, data }: { id: string; title: string; icon?: React.ReactNode; children: React.ReactNode; more?: { href: string; total: number; shown: number }; data?: Record<string, string> }) {
  return (
    <section aria-labelledby={id} className={`${HOME_CARD} overflow-hidden`} {...data}>
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-2.5 sm:px-4">
        {icon && <IconTile tone="navy" size="sm">{icon}</IconTile>}
        <h2 id={id} className="text-[15px] font-semibold text-navy">{title}</h2>
      </div>
      <div className="border-t border-line">{children}</div>
      {more && more.total > more.shown && (
        <Link href={more.href} className="flex min-h-11 items-center border-t border-line px-3 text-sm font-semibold text-navy no-underline hover:bg-fill sm:px-4" data-see-all>
          See all ({more.total})
        </Link>
      )}
    </section>
  );
}

/** Nothing to do: one calm line with a small check (no empty card frame). */
export function CaughtUp({ children = "You're all caught up." }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 px-1 text-sm text-ink-2" data-caught-up>
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-bg text-ok-fg"><CheckIcon size={13} strokeWidth={2.6} /></span>
      {children}
    </p>
  );
}

/** Every alert block is empty: one muted line in place of all of them. */
export function AllClear() {
  return <p className="px-1 text-sm text-ink-2" data-all-clear>Nothing to review and no problems.</p>;
}

/**
 * An attention block, rendered only when its count is above zero: a title, the count, a one-line reason,
 * its link, then the rows (compact: 14px text, 12px muted labels, hairline dividers).
 */
export function AlertCard({
  id, title, count, tone = "act", icon, reason, link, children, data, countData,
}: {
  id: string; title: string; count: number; tone?: "act" | "bad" | "wait" | "hold"; icon?: React.ReactNode; reason?: React.ReactNode;
  link?: { href: string; label: string }; children?: React.ReactNode; data?: Record<string, string>; countData?: Record<string, string>;
}) {
  const num = tone === "bad" ? "text-bad-fg" : tone === "wait" ? "text-wait-fg" : "text-act-fg";
  return (
    <section aria-labelledby={id} className={`${HOME_CARD} overflow-hidden`} {...data}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 pt-2.5 sm:px-4">
        <IconTile tone={tone} size="sm">{icon ?? <AlertIcon size={15} />}</IconTile>
        <h2 id={id} className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{title}</h2>
        <span className={`text-[15px] font-semibold ${num}`} {...countData}>{count}</span>
        {link && <Link href={link.href} className="ml-2 text-[13px] font-semibold text-navy underline underline-offset-2">{link.label}</Link>}
      </div>
      {reason && <p className="px-3 pt-0.5 text-[13px] text-ink-2 sm:px-4">{reason}</p>}
      {children ? <div className="mt-2 border-t border-line">{children}</div> : <div className="pb-3" />}
    </section>
  );
}

/** One compact row inside an alert card (a link): main text, a chip, a muted line. */
export function AlertRow({ href, children, data }: { href: string; children: React.ReactNode; data?: Record<string, string> }) {
  return (
    <li className="border-b border-line-soft last:border-0">
      <Link href={href} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[14px] text-inherit no-underline hover:bg-fill sm:px-4" {...data}>
        {children}
      </Link>
    </li>
  );
}
