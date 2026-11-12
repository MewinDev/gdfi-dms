"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * My loans tabs: underline tabs (not pills), each with its count as a small grey number. The selected tab has
 * a 2px navy underline and a semi-bold label. 44px touch targets, one hairline under the whole row. On a
 * phone the row scrolls sideways on its own (no scrollbar; the page never does) and keeps the selected
 * tab in view. `aside`: something on the right end of the row ("Showing 3 of 12").
 */
export function LoanTabs({ tabs, aside }: { tabs: { key: string; label: string; href: string; count: number; current: boolean }[]; aside?: React.ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const row = nav.current;
    if (el && row && row.scrollWidth > row.clientWidth) row.scrollLeft = el.offsetLeft - 16;
  }, []);
  return (
    <div className="flex min-w-0 items-end gap-3 border-b border-line" data-loan-tabs>
      <nav ref={nav} aria-label="Loan lists" className="-mb-px flex min-w-0 flex-1 gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.current ? "page" : undefined} data-tab={t.key}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm no-underline ${t.current ? "border-navy font-semibold text-navy" : "border-transparent text-ink-2 hover:border-line-strong hover:text-navy"}`}>
            {t.label}
            <span className={`text-[12px] tabular-nums ${t.current ? "text-navy" : "text-ink-2"}`} data-tab-count>{t.count}</span>
          </Link>
        ))}
      </nav>
      {aside && <span className="shrink-0 pb-3 text-[13px] text-ink-2" role="status" data-showing>{aside}</span>}
    </div>
  );
}
