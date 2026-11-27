/**
 * The list pages' filter pills (D-059 Loans, D-064 Jobs): one look for both. Compact: 30 px pills; on a phone an
 * invisible margin keeps the tap area 44 px tall.
 */
export const PILL = "relative inline-flex h-[30px] items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium before:absolute before:-inset-y-[7px] before:inset-x-0 before:content-[''] sm:before:hidden";
export const PILL_ON = "border-navy bg-navy text-white";
export const PILL_OFF = "border-line-input bg-white text-ink hover:bg-fill";

/** A choice's count inside its pill or row. */
export function FilterCount({ n, on }: { n: number; on: boolean }) {
  return <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${on ? "bg-white/20 text-white" : "bg-fill text-ink-2"}`} data-filter-n>{n}</span>;
}

/** A row in a Filters panel (44 px to tap on a phone, 36 px from 640 px). */
export const CHOICE_ROW = "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm hover:bg-fill sm:min-h-9";
