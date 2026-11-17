import Link from "next/link";
import { rangeText, withPage, type PageInfo } from "@/lib/ui/paging";

/**
 * One compact line under a long list: "1–50 of 312 · Previous · Next". Shown only when there is more than
 * one page. Previous and Next are links (the page is in the address, so Back and refresh keep it), each at
 * least 44px tall and wide; at an end the word stays, greyed, and is not a link. One line on a phone.
 * `href` is the list's address without `page` (filters and tab included).
 */
export function Pager({ info, href, label }: { info: PageInfo; href: string; label: string }) {
  if (info.pages <= 1) return null;
  const step = "inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px]";
  const prev = info.page > 1 ? withPage(href, info.page - 1) : null;
  const next = info.page < info.pages ? withPage(href, info.page + 1) : null;
  return (
    <nav aria-label={`Pages of ${label}`} className="flex min-w-0 flex-nowrap items-center justify-end gap-1 whitespace-nowrap text-[13px] text-ink-2" data-pager data-page={info.page} data-pages={info.pages}>
      <span role="status" className="tabular-nums" data-pager-range>{rangeText(info)}</span>
      <span aria-hidden="true">·</span>
      {prev
        ? <Link href={prev} rel="prev" className={`${step} font-semibold text-navy underline underline-offset-2`} data-pager-prev>Previous</Link>
        : <span aria-disabled="true" className={`${step} text-ink-2 opacity-60`} data-pager-prev>Previous</span>}
      <span aria-hidden="true">·</span>
      {next
        ? <Link href={next} rel="next" className={`${step} font-semibold text-navy underline underline-offset-2`} data-pager-next>Next</Link>
        : <span aria-disabled="true" className={`${step} text-ink-2 opacity-60`} data-pager-next>Next</span>}
    </nav>
  );
}
