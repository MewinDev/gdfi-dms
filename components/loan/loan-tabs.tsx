import Link from "next/link";
import { ScrollFade } from "@/components/ui/scroll-fade";

/**
 * My loans tabs: underline tabs (not pills), each with its count as a small grey number. The selected tab has
 * a 2px navy underline and a semi-bold label. 44px touch targets, one hairline under the whole row. On a
 * narrow screen the row scrolls sideways on its own (no scrollbar; the page never does), with a fade at the
 * edge that has more (D-058), and keeps the selected tab in view. `aside`: something on the right end of the
 * row ("Showing 3 of 12").
 */
export function LoanTabs({ tabs, aside }: { tabs: { key: string; label: string; href: string; count: number; current: boolean }[]; aside?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-x-3 border-b border-line sm:flex-nowrap" data-loan-tabs>
      <ScrollFade className="-mb-px w-full sm:w-auto sm:flex-1">
        <nav aria-label="Loan lists" className="flex min-w-0 gap-5 overflow-x-auto pr-4" data-scroll-row>
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} aria-current={t.current ? "page" : undefined} data-tab={t.key}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] text-[15px] no-underline ${t.current ? "border-navy font-semibold text-navy" : "border-transparent text-ink-2 hover:border-line-strong hover:text-navy"}`}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[13px] tabular-nums ${t.current ? "bg-navy text-white" : "bg-fill text-ink-2"}`} data-tab-count>{t.count}</span>
            </Link>
          ))}
        </nav>
      </ScrollFade>
      {aside && <span className="shrink-0 pb-2 pt-1 text-[13px] text-ink-2 sm:pb-3 sm:pt-0" role="status" data-showing>{aside}</span>}
    </div>
  );
}
