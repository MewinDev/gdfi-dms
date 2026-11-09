import Link from "next/link";

/**
 * Loan File / Check documents header: a thin breadcrumb row above the title (phone: one small
 * "‹ My loans" link), then the title with an optional chip or button at the far right, and one
 * subtitle line directly under the title. Nothing sits to the left of the title.
 */
export function PageTop({
  crumbs, back, title, subtitle, right, note,
}: {
  crumbs: { label: string; href?: string }[];
  back: { label: string; href: string };
  title: string;
  subtitle: React.ReactNode;
  right?: React.ReactNode;
  /** A small line under the subtitle (the Loan File: "Opened at Antipolo (101)"). */
  note?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      <nav aria-label="Breadcrumb" className="hidden text-[13px] text-ink-2 sm:block">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">›</span>}
              {c.href && i < crumbs.length - 1
                ? <Link href={c.href} className="text-ink-2 underline-offset-2 hover:text-navy hover:underline">{c.label}</Link>
                : <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className="text-ink">{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <Link href={back.href} className="-ml-1 inline-flex min-h-8 items-center gap-1 self-start text-[13px] font-semibold text-navy sm:hidden">
        <span aria-hidden="true">‹</span> {back.label}
      </Link>
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-2xl font-bold leading-tight tracking-[-0.01em] text-navy sm:text-[28px]">{title}</h1>
        {right && <span className="-my-2 flex shrink-0 items-center self-center">{right}</span>}
      </div>
      <p className="text-[15px] text-ink-2">{subtitle}</p>
      {note && <p className="text-[13px] text-ink-2" data-opened-at>{note}</p>}
    </header>
  );
}
