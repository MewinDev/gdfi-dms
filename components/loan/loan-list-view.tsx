import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
import { listUrl, PER_PAGE, type LoanListParams, type SortKey } from "@/lib/ui/loan-list";
import type { LoanListItem, LoanListResult } from "@/lib/services/loan-list";
import { Flags } from "./my-loans-list";
import { ROW_BUTTON } from "./loan-row-actions";
import { NotInDmsBadge } from "./not-in-dms-badge";

/**
 * D-059: the Loans list. From 1024px one table with these columns only: Borrower (name, PN under it with Copy) ·
 * Branch · Loan (product, New/Renewal and Financing/Refinancing; the release date in its tooltip) · Released amount ·
 * Status / next step (one column) · Assigned to (a person or "Branch pool") · Due (the TAT chip) · Action (View details;
 * D-060: the loan file, or the preview of a loan not yet in the DMS, with the "myloans · Not yet in DMS" badge). Under 1024px (phones and tablets) each row is a compact card (one column, two from 768px). Sorting by
 * Borrower, Branch, Released amount and Due is a link (the server sorts); the page size is 25 or 50.
 */
export function LoanListView({ result, params }: { result: LoanListResult; params: LoanListParams }) {
  const { rows, info, seesAmounts } = result;
  const th = "whitespace-nowrap px-1.5 py-1.5 min-[1440px]:px-2 text-left font-medium first:pl-3.5 last:pr-3.5"; // headings on one line
  return (
    <section aria-label="Loans" className="flex min-w-0 flex-col gap-2" data-loan-list>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-white lg:block" data-loan-table>
        <table className="w-full border-collapse text-[13px] leading-snug" aria-label="Loans" aria-rowcount={info.total + 1}>
          <thead>
            <tr className="border-b border-line bg-fill-soft text-xs text-ink-2">
              <SortTh params={params} k="borrower" label="Borrower" className={th} />
              <SortTh params={params} k="branch" label="Branch" className={th} />
              <th scope="col" className={th}>Loan</th>
              {/* Released on: its own column from 1440px; below that (office laptops, 1280 to 1366px) the date is the Loan cell's second line, so the table fits without scrolling. */}
              <SortTh params={params} k="released" label="Released on" className={`${th} hidden min-[1440px]:table-cell`} />
              {seesAmounts && <SortTh params={params} k="amount" label="Released amount" className={`${th} text-right`} />}
              <th scope="col" className={th}>Status / next step</th>
              <th scope="col" className={th}>Assigned to</th>
              <SortTh params={params} k="due" label="Due" className={th} />
              <th scope="col" className={th}>Action</th>
            </tr>
          </thead>
          <tbody>{rows.map((r) => <Row key={r.key} r={r} seesAmounts={seesAmounts} />)}</tbody>
        </table>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:hidden" aria-label="Loans">
        {rows.map((r) => <Card key={r.key} r={r} />)}
      </ul>
      <ListFooter params={params} info={info} />
    </section>
  );
}

/** Page numbers to show: the first, the last, the current one and its neighbours; gaps as "…". */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push("gap");
    out.push(n);
    last = n;
  }
  return out;
}

/**
 * Under the list (the user's review, 25 November 2026): on the left how many rows are shown of the total
 * ("Showing 1–25 of 37 loans"); on the right Previous, the page numbers, Next, and at the end the page size (25 or 50).
 * Every step is a link (the page is in the address); each is 44px on a phone, 36px from 640px.
 */
function ListFooter({ params, info }: { params: LoanListParams; info: LoanListResult["info"] }) {
  // Compact (the user's review): 28px; on a phone an invisible margin keeps 44px to tap.
  const step = "relative before:absolute before:-inset-2 before:content-[''] md:before:hidden inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs";
  const href = (n: number) => listUrl(params, { page: n });
  const fmt = (n: number) => n.toLocaleString("en-PH");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1" data-list-footer>
      <p role="status" className="text-xs tabular-nums text-ink-2" data-pager-range>Showing {fmt(info.from)}–{fmt(info.to)} of {fmt(info.total)} loan{info.total === 1 ? "" : "s"}</p>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        {info.pages > 1 && (
          <nav aria-label="Pages of loans" className="flex items-center gap-0.5" data-pager data-page={info.page} data-pages={info.pages}>
            {info.page > 1
              ? <Link href={href(info.page - 1)} rel="prev" className={`${step} font-semibold text-navy hover:bg-fill`} data-pager-prev>Previous</Link>
              : <span aria-disabled="true" className={`${step} text-ink-2 opacity-60`} data-pager-prev>Previous</span>}
            {pageNumbers(info.page, info.pages).map((n, i) => n === "gap"
              ? <span key={`g${i}`} aria-hidden="true" className="px-1 text-ink-2">…</span>
              : n === info.page
                ? <span key={n} aria-current="page" className={`${step} bg-navy font-bold text-white`} data-page-number={n}>{n}</span>
                : <Link key={n} href={href(n)} aria-label={`Page ${n}`} className={`${step} font-semibold text-navy hover:bg-fill`} data-page-number={n}>{n}</Link>)}
            {info.page < info.pages
              ? <Link href={href(info.page + 1)} rel="next" className={`${step} font-semibold text-navy hover:bg-fill`} data-pager-next>Next</Link>
              : <span aria-disabled="true" className={`${step} text-ink-2 opacity-60`} data-pager-next>Next</span>}
          </nav>
        )}
        <div className="flex items-center gap-1.5 text-xs text-ink-2" data-per-page>
          <div role="group" aria-label="Loans a page" className="flex rounded-md border border-line-input">
            {PER_PAGE.map((n) => (
              n === params.per
                ? <span key={n} aria-current="true" className="relative before:absolute before:-inset-2 before:content-[''] md:before:hidden inline-flex h-7 min-w-8 items-center justify-center bg-navy px-1.5 text-xs font-bold text-white first:rounded-l-[5px] last:rounded-r-[5px]">{n}</span>
                : <Link key={n} href={listUrl(params, { per: n })} aria-label={`${n} a page`} className="relative before:absolute before:-inset-2 before:content-[''] md:before:hidden inline-flex h-7 min-w-8 items-center justify-center bg-white px-1.5 text-xs font-semibold text-navy no-underline first:rounded-l-[5px] last:rounded-r-[5px] hover:bg-fill">{n}</Link>
            ))}
          </div>
          <span>a page</span>
        </div>
      </div>
    </div>
  );
}

function SortTh({ params, k, label, className }: { params: LoanListParams; k: SortKey; label: string; className: string }) {
  const cur = params.sort === k;
  const href = listUrl(params, cur ? { dir: params.dir === "asc" ? "desc" : "asc" } : { sort: k, dir: k === "amount" || k === "released" ? "desc" : "asc" });
  return (
    <th scope="col" className={className} aria-sort={cur ? (params.dir === "asc" ? "ascending" : "descending") : "none"} data-sort={k}>
      <Link href={href} className={`group inline-flex min-h-7 items-center gap-0.5 no-underline ${cur ? "font-semibold text-navy" : "text-ink-2 hover:text-navy"}`}>
        {label}
        {/* A thin arrow only on the sorted column; elsewhere a faint one on hover or keyboard focus (the user's review). */}
        <span aria-hidden="true" className={`w-2.5 text-[11px] leading-none ${cur ? "text-navy" : "text-ink-2 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60"}`} data-sort-arrow>{cur && params.dir === "desc" ? "↓" : "↑"}</span>
        <span className="sr-only">{cur ? `, sorted ${params.dir === "asc" ? "ascending" : "descending"}. Sort ${params.dir === "asc" ? "descending" : "ascending"}` : ", sort"}</span>
      </Link>
    </th>
  );
}

function Due({ due }: { due: LoanListItem["due"] }) {
  if (!due) return <span className="text-[13px] text-ink-2">-</span>;
  // Compact: a small chip only when due today or late; otherwise grey text.
  return due.hot
    ? <span className={`chip ${due.tone === "bad" ? "c-bad" : "c-act"} h-5 whitespace-nowrap px-1.5 text-xs font-semibold`} data-due-chip>{due.text}</span>
    : <span className="whitespace-nowrap text-[13px] text-ink-2">{due.text}</span>;
}

function StatusChip({ c }: { c: LoanListItem["statusChip"] }) {
  if (!c) return null;
  const cls = c.tone === "hold" ? "c-hold" : c.tone === "act" ? "c-act" : c.tone === "bad" ? "c-bad" : c.tone === "wait" ? "c-wait" : "c-mute";
  return <span className={`chip ${cls} mr-1.5 h-5 px-1.5 align-[1px] text-xs font-semibold`} data-status-chip>{c.text}</span>;
}

/** The two loan badges side by side on one line (never split between lines; the user's review). */
function Badges({ r }: { r: LoanListItem }) {
  if (!r.loanType && !r.classification) return null;
  return (
    <span className="inline-flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap" data-badges-pair>
      {r.loanType && <span className="chip c-mute h-5 px-1.5 text-xs font-semibold" data-badge="loan-type">{r.loanType}</span>}
      {r.classification && <span className="chip c-wait h-5 px-1.5 text-xs font-semibold" data-badge="classification">{r.classification}</span>}
    </span>
  );
}

/** D-060: every row has one action, View details (the loan file, or the preview of a loan not yet in the DMS). */
function Action({ r }: { r: LoanListItem }) {
  return (
    <Link href={r.viewHref} className={ROW_BUTTON} aria-label={`View details of ${r.borrowerName}, ${r.pn}`} data-open>
      View details
    </Link>
  );
}

/** The borrower's name: plain text. Rows and cards are not links (the user's review, D-060): View details is the one way in. */
function Name({ r, className }: { r: LoanListItem; className: string }) {
  return <span className={className} data-loan-name>{r.borrowerName}</span>;
}

function Row({ r, seesAmounts }: { r: LoanListItem; seesAmounts: boolean }) {
  const td = "px-1.5 py-2 align-top min-[1440px]:px-2 first:pl-3.5 last:pr-3.5";
  return (
    <tr className="border-b border-line last:border-0" data-loan-row={r.pn} data-source={r.source}>
      <td className={`${td} min-w-[9rem]`} data-col="borrower">
        <Name r={r} className="block break-words text-sm font-semibold leading-snug text-navy outline-none" />
        {/* The PN and Copy on one line, never wrapped (the user's review, 26 November 2026). */}
        <span className="flex items-center gap-1 whitespace-nowrap" data-pn-line>
          <span className="whitespace-nowrap font-mono text-xs leading-5 text-ink-2" data-pn>{r.pn}</span>
          <CopyButton text={r.pn} label={`Copy PN ${r.pn}`} />
        </span>
        {r.flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1"><Flags flags={r.flags} /></span>}
      </td>
      <td className={td} data-col="branch">{r.branchName}</td>
      <td className={`${td} min-w-[8rem]`} data-col="loan">
        <span className="block break-words">{r.productName || <span className="text-ink-2">No product name</span>}</span>
        <span className="mt-0.5 block whitespace-nowrap text-xs text-ink-2 min-[1440px]:hidden" data-released-inline>Released {r.releasedOn}</span>
        {/* One badge per row (beside the date below 1440px, under the product from 1440px). */}
        {r.notInDms && <span className="mt-1 block"><NotInDmsBadge /></span>}
        <span className="mt-1 flex"><Badges r={r} /></span>
      </td>
      {/* The release date (the user's review, 26 November 2026), from 1440px. */}
      <td className={`${td} hidden whitespace-nowrap tabular-nums min-[1440px]:table-cell`} data-col="released">
        {r.releasedOn}
      </td>
      {seesAmounts && <td className={`${td} whitespace-nowrap text-right tabular-nums`} data-col="amount">{r.amountText ?? "-"}</td>}
      <td className={`${td} min-w-[8rem]`} data-col="status">
        <StatusChip c={r.statusChip} /><span className="leading-snug text-ink" title={r.statusTip} data-next-text>{r.statusText}</span>
      </td>
      <td className={`${td} min-w-[6rem] min-[1440px]:whitespace-nowrap`} data-col="with">{r.withText}</td>
      <td className={`${td} whitespace-nowrap`} data-col="due" data-due>{<Due due={r.due} />}</td>
      <td className={`${td} whitespace-nowrap`} data-col="action"><Action r={r} /></td>
    </tr>
  );
}

/**
 * Phone and tablet (under 1024px): one compact card per row, every line on the same left edge (the user's review,
 * 26 November 2026: no avatar indent). One column on a phone, two from 768px.
 *   1  borrower name (wraps) · the Due chip on the right
 *   2  PN (monospace) with Copy
 *   3  branch · product · released amount
 *   4  the status chip and the Status / next step text
 *   5  the badges (New / Renewal, Financing / Refinancing, flags)
 *   6  Assigned to …, and under it Released … (small) (and the "myloans · Not yet in DMS" badge) · View details on the right, centred on both
 * The card is not a link (D-060): View details is the one way in.
 */
function Card({ r }: { r: LoanListItem }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-white px-3.5 py-3" data-loan-row={r.pn} data-source={r.source}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Name r={r} className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-navy" />
        <span className="shrink-0 pt-px" data-due><Due due={r.due} /></span>
      </div>
      <div className="flex items-center gap-1.5 whitespace-nowrap" data-pn-line>
        <span className="whitespace-nowrap font-mono text-sm leading-5 text-ink" data-pn>{r.pn}</span>
        <CopyButton text={r.pn} label={`Copy PN ${r.pn}`} />
      </div>
      <p className="break-words text-sm text-ink-2" data-branch-amount>
        {[r.branchName, r.productName].filter(Boolean).join(" · ")}
        {r.amountText && <> · <span className="font-semibold tabular-nums text-ink">{r.amountText}</span></>}
      </p>
      <p className="text-sm font-semibold leading-snug text-ink" data-step><StatusChip c={r.statusChip} /><span title={r.statusTip} data-next-text>{r.statusText}</span></p>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5" data-badges>
        <Badges r={r} />
        <Flags flags={r.flags} />
      </div>
      {/* The last row: who has it, then when it was released; View details on the right, centred on both lines. */}
      <div className="mt-1 flex min-w-0 items-center justify-between gap-3 border-t border-line-soft pt-2">
        <div className="min-w-0 text-[13px] leading-snug text-ink-2" data-card-meta>
          <p>Assigned to <span className="font-medium text-ink">{r.withText}</span></p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">{r.releasedText}{r.notInDms && <NotInDmsBadge />}</p>
        </div>
        <span className="shrink-0" data-card-action><Action r={r} /></span>
      </div>
    </li>
  );
}
