import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
import { ToneChip } from "@/components/ui/basics";
import { RefreshIconButton } from "@/components/loan/forms";
import type { Tone } from "@/lib/ui/plain";

/**
 * D-062: the loan summary header, the same at the top of every loan file tab (To do, Check documents,
 * Documents, Journey). Replaces the big "Loan File" title, the grey subtitle line and the separate
 * "MyLoans · Last checked" strip with its Refresh button. The user's review (26 November 2026), so the details
 * are easy to find:
 *   The borrower's name (the page's h1) on the left; on the same line at the right the due badge · the branch badge
 *           (its tooltip says where the loan file was opened) · Refresh from myloans (icon; the last check in its
 *           tooltip). Then the PN (monospace, Copy) under the name.
 *   Then only Product · Loan type (New or Renewal) · Amount (when the person may see it) · (on Check
 *           documents these sit at the top of the transactions card instead: LoanFacts) ·
 *           Released on, each a small grey label above its value.
 *   Then the current step as a small heading ("Check documents"), directly above the tabs.
 */
export interface LoanSummary {
  pn: string;
  borrower: string;
  branch: string;
  product: string;
  /** "New" or "Renewal" (myloans' loan type); empty when unknown. */
  loanType: string;
  /** "Financing" or "Refinancing". */
  classification: string;
  /** "₱450,000", or null when the person may not see amounts. */
  amount: string | null;
  releasedOn: string;
  /** "Opened at Antipolo" (and ", now at Angono" when the branch changed): the branch badge's tooltip; said on
   *  the page only when it differs. */
  opened?: { text: string; differs: boolean } | null;
  replacesPn?: string | null;
  replacedByPn?: string | null;
  /** Who has it now ("Assigned to"; lib/services/loan-holder.ts). */
  holder?: string;
  /** The status in myloans by its name ("Loan Released"), and whether it is the released status (12). */
  status?: { text: string; released: boolean } | null;
}

type Source = { loanId: string; lastChecked: string; current: boolean; view: boolean; refresh: boolean; paused: boolean };

export function LoanSummaryHeader({ crumbs, back, s, due, step, source, identity = true }: {
  crumbs: { label: string; href?: string }[];
  back: { label: string; href: string };
  s: LoanSummary;
  due?: { text: string; tone: Tone } | null;
  /** The current step: "Check documents". */
  step: string;
  /** myloans: the last check, whether the person sees it and may refresh, and whether calls are paused or failed. */
  source: Source;
  /**
   * The name, PN, badges and details here (To do, Documents, Journey). false on Check documents: the name, PN and
   * badges are at the top of the transactions card instead (LoanIdentity), and the step is the page's heading.
   */
  identity?: boolean;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-1" data-loan-header>
      <nav aria-label="Breadcrumb" className="hidden text-xs text-ink-2 sm:block">
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

      {identity ? (
        // To do, Documents and Journey (the user's review): the same card as on Check documents, a little wider: the
        // name (the page's heading) with the due badge and Refresh, the PN, then the six details. No step heading
        // here: the stepper under it says the step.
        <div className="card mt-1 px-3 py-2.5 sm:px-4" data-card-identity>
          <LoanIdentity id="loan-id-top" s={s} due={due} source={source} as="h1" wide />
        </div>
      ) : (
        <h1 className="mt-1 text-lg font-bold leading-tight text-navy sm:text-xl" data-step-title>{step}</h1>
      )}
    </header>
  );
}

/**
 * Check documents (the user's review, 26 November 2026): at the top of the transactions card (the side panel from
 * 1280 px, above the strip below that): the borrower's name with the due badge and Refresh from myloans at the right of
 * its line, the PN with Copy under it, then the details two by two: Product · Loan type · Amount · Released on ·
 * Branch · Assigned to. No heading, no divider, no branch badge; compact.
 */
export function LoanIdentity({ s, due, source, id, as: Heading = "h2", wide = false }: {
  s: LoanSummary; due?: { text: string; tone: Tone } | null; source: Source; /** Unique per copy (side panel, strip, top). */ id: string;
  /** The name's heading level: h1 when it is the page's heading (To do, Documents, Journey). */
  as?: "h1" | "h2";
  /** The full-width card at the top of the page: the details in up to six columns. */
  wide?: boolean;
}) {
  return (
    <section aria-labelledby={`${id}-name`} className="flex min-w-0 flex-col gap-1 [&_.chip]:h-5 [&_.chip]:px-1.5 [&_.chip]:text-[11px]" data-loan-identity>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Heading id={`${id}-name`} className={`min-w-0 font-bold leading-snug text-navy [overflow-wrap:anywhere] ${wide ? "text-base" : "text-sm"}`} data-borrower>{s.borrower}</Heading>
        {/* D-062 review: the status in myloans, the due badge and Refresh, in that order. */}
        <span className="flex shrink-0 items-center gap-1.5">
          {s.status && <span className={`chip ${s.status.released ? "c-ok" : "c-act"}`} title="Status in myloans" data-myloans-status><span className="sr-only">Status in myloans: </span>{s.status.text}</span>}
          {due && <span data-due-chip><ToneChip tone={due.tone}>{due.text}</ToneChip></span>}
          {source.refresh && <span data-source-strip><RefreshIconButton loanId={source.loanId} lastChecked={source.lastChecked} /></span>}
        </span>
      </div>
      <PnLine s={s} />
      <SourceBits source={{ ...source, refresh: false }} keepRefreshNote={!source.refresh} />
      <LoanFacts s={s} layout={wide ? "wide" : "card"} />
    </section>
  );
}

/** myloans paused / did not answer / last checked (no refresh tick) chips, and the Refresh icon. */
function SourceBits({ source, keepRefreshNote = true }: { source: Source; keepRefreshNote?: boolean }) {
  const any = (source.view && (source.paused || !source.current || (!source.refresh && keepRefreshNote))) || source.refresh;
  if (!any) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2" data-source-strip>
      {source.view && source.paused && <span className="chip c-wait h-auto min-h-6 whitespace-normal py-0.5 text-xs" data-myloans-paused>myloans calls are paused by Admin</span>}
      {source.view && !source.current && <span className="chip c-act h-auto min-h-6 whitespace-normal py-0.5 text-xs" data-last-checked>Last checked {source.lastChecked}. myloans did not answer.</span>}
      {source.view && !source.refresh && source.current && keepRefreshNote && <span className="text-xs text-ink-2" data-last-checked>myloans checked {source.lastChecked}</span>}
      {source.refresh && <RefreshIconButton loanId={source.loanId} lastChecked={source.lastChecked} />}
    </span>
  );
}

function PnLine({ s }: { s: LoanSummary }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1" data-summary-line="1">
      <span className="inline-flex items-center gap-1">
        <span className="sr-only">PN </span>
        <span className="mono text-sm text-ink-2 sm:text-[13px]" data-pn>{s.pn}</span>
        <CopyButton text={s.pn} label="Copy PN" />
      </span>
      {s.opened?.differs && <span className="text-xs font-semibold text-navy" data-opened-at>{s.opened.text}</span>}
      {s.replacesPn && <Link href={`/loans/${s.replacesPn}`} className="text-xs font-semibold text-navy underline underline-offset-2" data-replaces>Replaces <span className="mono">{s.replacesPn}</span></Link>}
      {s.replacedByPn && <Link href={`/loans/${s.replacedByPn}`} className="text-xs font-semibold text-navy underline underline-offset-2" data-replaced-by>Replaced by <span className="mono">{s.replacedByPn}</span></Link>}
    </div>
  );
}

/**
 * Product · Loan type (myloans' New or Renewal, plain words) · Amount · Released on, each a small grey label above its
 * value. "row" (the header): two columns on a phone, one row from 640 px. "card" (Check documents' transactions card):
 * two by two, with Branch and Assigned to as well.
 */
function LoanFacts({ s, layout = "row" }: { s: Pick<LoanSummary, "product" | "loanType" | "amount" | "releasedOn" | "branch" | "holder" | "opened">; layout?: "row" | "card" | "wide" }) {
  // The card's pairs are smaller (11 px labels, 13 px values, tight rows: the user's review "compact and small").
  // 14 px values on a phone (the readability rule, D-058), 13 px from 640 px.
  const small = "[&_dt]:text-[11px] [&_dt]:leading-[14px] [&_dd]:text-sm [&_dd]:leading-5 sm:[&_dd]:text-[13px] sm:[&_dd]:leading-[18px]";
  const cls = layout === "row" ? "mt-1 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-8"
    : layout === "wide" ? `mt-1 grid min-w-0 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-6 ${small}`
    : `mt-1 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 ${small}`;
  return (
    <dl className={cls} data-loan-facts={layout} data-summary-line={layout === "row" ? "2" : undefined}>
      <Fact k="Product" data="product">{s.product || "(blank)"}</Fact>
      {/* myloans' loan type only: New or Renewal, in plain words. Financing / Refinancing is the DMS's classification
          from the product name (in Loan at a glance), not a loan type (the user's review). */}
      {s.loanType && <Fact k="Loan type" data="loan-type">{s.loanType}</Fact>}
      {s.amount && <Fact k="Amount" data="amount">{s.amount}</Fact>}
      <Fact k="Released on" data="released">{s.releasedOn}</Fact>
      {/* The card only (Check documents): the branch (its tooltip: where it was opened) and who has it. */}
      {layout !== "row" && <Fact k="Branch" data="branch" title={s.opened?.text}>{s.branch}</Fact>}
      {layout !== "row" && s.holder && <Fact k="Assigned to" data="assigned">{s.holder}</Fact>}
    </dl>
  );
}

function Fact({ k, data, title, children }: { k: string; data: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col" data-fact={data} title={title}>
      <dt className="text-xs leading-4 text-ink-2">{k}</dt>
      <dd className="min-w-0 text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
