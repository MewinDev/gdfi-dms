import Link from "next/link";
import type { PnLookupResult } from "@/lib/services/loan-file";
import { dayText, peso } from "@/lib/ui/plain";
import { Avatar, ToneChip } from "@/components/ui/basics";
import { AlertIcon, CheckIcon, LockIcon } from "@/components/ui/icons";
import { OpenLoanForm } from "@/components/loan/open-loan-form";
import { statusLabel } from "@/lib/myloans/status";
import { SOURCE_NAME } from "@/lib/myloans/types";
import { CopyButton } from "@/components/ui/copy-button";
import { NotInDmsBadge } from "./not-in-dms-badge";
import { RefreshPreviewButton } from "./refresh-preview";

/**
 * D-059: what myloans said about a full PN that is neither a loan file in the DMS nor in a branch pool (source 3 of the
 * Loans page): "Found in myloans" with Open loan file when it is released, or the reason (cancelled, replaced by
 * another PN, not a released loan, not found, outside the person's branches, myloans busy). Moved here from the old
 * Find a loan page, unchanged apart from the links ("Try again" searches the Loans page again).
 */
export function MyLoansResult({ r, q, warnings }: { r: PnLookupResult; q: string; warnings: string[] }) {
  return (
    <section aria-label="Found in myloans" className="flex min-w-0 flex-col gap-2" data-myloans-result={r.kind}>
      <h2 className="text-[15px] font-semibold text-navy" data-myloans-heading>{r.kind === "preview" ? "Found in myloans" : "Not in the DMS: what myloans says"}</h2>
      {r.kind === "preview" ? <Preview r={r} warnings={warnings} />
        : r.kind === "status" ? <StatusCard r={r} q={q} />
        : <Problem r={r} q={q} />}
    </section>
  );
}

/** A compact one- or two-line message: an icon, what happened and the PN, the next step, and Try again. */
export function Notice({ tone, role = "alert", pn, title, q, children, data }: { tone: "bad" | "act" | "mute"; role?: "alert" | "status"; pn: string; title: React.ReactNode; q: string; children?: React.ReactNode; data?: Record<string, string> }) {
  const cls = tone === "bad" ? "border-bad-line bg-bad-bg" : tone === "act" ? "border-act-line bg-act-bg" : "border-line bg-white";
  const icon = tone === "bad" ? "text-bad-fg" : tone === "act" ? "text-act-fg" : "text-ink-2";
  return (
    <section role={role} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-[14px] leading-snug sm:gap-x-4 sm:px-4 sm:text-[15px] ${cls}`} data-find-notice={tone} {...data}>
      <span className={`flex ${icon}`} data-notice-icon><AlertIcon size={18} /></span>
      {/* One text block on tablet and desktop; on a phone the explanation runs under Try again (full width). */}
      <div className="min-w-0 max-sm:contents" data-notice-text>
        <p className="col-start-2 row-start-1"><span className={`font-bold ${tone === "bad" ? "text-bad-fg" : "text-navy"}`}>{title}</span> <span className="font-mono text-sm text-ink-2" data-notice-pn>{pn}</span></p>
        {children && <p className="col-span-2 col-start-2 row-start-2 text-sm text-ink sm:mt-0.5">{children}</p>}
      </div>
      <Link href={`/loans?q=${encodeURIComponent(q)}`} className="btn-ghost col-start-3 row-start-1 h-10 min-h-10 px-3 text-sm">Try again</Link>
    </section>
  );
}

const NEXT_STEP: Record<string, string> = {
  pn: "Check the number and try again.",
  status: "Wait until the loan is released in MyLoans, then try again.",
  borrowerName: "",
  releaseDate: "Ask the MyLoans data owner to add the release date, then try again.",
  loanType: "Ask the MyLoans data owner to correct the loan type, then try again.",
  totalReleasedAmount: "Ask the MyLoans data owner to correct the amount, then try again.",
};

function Problem({ r, q }: { r: PnLookupResult; q: string }) {
  if (r.kind === "preview" || r.kind === "existing" || r.kind === "invalid" || r.kind === "status") return null;
  // No row: one sentence, shown once.
  if (r.kind === "not_found") return <Notice tone="bad" pn={r.pn} title={r.message} q={q} data={{ "data-find-problem": "not_found" }} />;
  // D-050: in myloans but not a released loan; after a redo, the PN that replaced it.
  if (r.kind === "not_selectable") return <NotSelectable r={r} q={q} />;
  // D-050: several records for one PN and none released: Admin was told.
  if (r.kind === "multiple") return <Notice tone="bad" pn={r.pn} title={r.message} q={q} data={{ "data-find-problem": "multiple" }}>Admin was told. Nothing was saved.</Notice>;
  const title =
    r.kind === "unavailable" ? (r.busy ? "MyLoans is busy, please try again in a few minutes." : "MyLoans is not answering right now.")
    : r.fieldLabel.startsWith("Inactive") ? `This ${r.field === "branch" ? "branch" : "loan type"} is inactive in Settings.`
    : r.field === "branch" ? "This loan is outside your branches."
    : r.field === "status" ? "This loan is not released yet."
    : "Some loan details in MyLoans need fixing first.";
  const next =
    r.kind === "unavailable" ? "Try again in a few minutes. If it keeps happening, contact IT."
    : r.fieldLabel.startsWith("Inactive") ? "Ask an Admin to make it active in Settings, then try again."
    : NEXT_STEP[r.field] ?? "Try again later.";
  const kind = r.kind === "refused" ? r.field : r.kind === "unavailable" && r.busy ? "busy" : r.kind;
  // Outside the person's branches: the PN and branch only, and the way to get access.
  if (r.kind === "refused" && r.field === "branch" && !r.fieldLabel.startsWith("Inactive")) return <OutsideBranches pn={r.pn} branch={r.record.branchName} q={q} />;
  // Busy: the title says it all (never "not found").
  if (r.kind === "unavailable" && r.busy) return <Notice tone="bad" pn={r.pn} title={title} q={q} data={{ "data-find-problem": kind }}>Nothing was saved.</Notice>;
  return (
    <Notice tone="bad" pn={r.pn} title={title} q={q} data={{ "data-find-problem": kind }}>
      {[r.message, next, "Nothing was saved."].filter(Boolean).join(" ")}
    </Notice>
  );
}

/**
 * A loan outside the person's branch access, laid out like the status card: the PN and the branch only
 * (decided 12 November 2026; the branch is already in the PN, the borrower's name is never shown, and the
 * server sends nothing else). The way forward is access to that branch, which Admin gives (Settings, Roles
 * and access); there is no in-app request.
 */
function OutsideBranches({ pn, branch, q }: { pn: string; branch: string | null; q: string }) {
  const where = branch?.trim() || null;
  return (
    <section role="alert" aria-labelledby="outside-title" className="card min-w-0 p-4 sm:px-5 sm:py-4" data-find-notice="branch" data-find-problem="branch">
      {/* Header like the loan cards: a lock in place of the avatar, the PN and the branch; the chips on the right. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4" data-find-head>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill text-navy"><LockIcon size={20} /></span>
          <div className="min-w-0">
            <h2 className="font-mono text-lg font-bold leading-tight text-navy" data-notice-pn>{pn}</h2>
            <p className="text-sm text-ink-2" data-outside-branch>{where ? `Branch: ${where}` : "Branch: -"}</p>
          </div>
        </div>
        <ul aria-label="Loan status" className="flex flex-wrap items-center gap-2" data-find-chips>
          <li><ToneChip tone="act">No access</ToneChip></li>
          <li><span className="chip c-mute" data-find-source>{SOURCE_NAME}</span></li>
        </ul>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-act-bg px-3 py-2">
        <span className="flex shrink-0 text-act-fg" data-notice-icon><AlertIcon size={18} /></span>
        <div className="min-w-0 flex-1" data-notice-text>
          <p id="outside-title" className="text-[15px] font-bold leading-snug text-navy">This loan is outside your branches.</p>
          <p className="text-[13px] text-ink-2">You can open loans of your own branches only. To work on this one, ask your Admin to add this branch to your access. Nothing was saved.</p>
        </div>
        <Link href={`/loans?q=${encodeURIComponent(q)}`} className="btn-ghost h-10 min-h-10 shrink-0 bg-white px-3 text-sm">Try again</Link>
      </div>
    </section>
  );
}

/**
 * A loan in MyLoans and in the person's branches whose status the DMS does not accept (only Loan Released
 * is): what MyLoans says, by name. No Open button; nothing is saved; no further MyLoans call.
 */
function StatusCard({ r, q }: { r: Extract<PnLookupResult, { kind: "status" }>; q: string }) {
  // The status itself is the chip on the right; the sentence says only what it means.
  const text = r.statusKind === "before_release" ? "This loan is not released yet."
    : r.statusKind === "cancelled" ? "This loan was cancelled in MyLoans."
    : "The DMS does not accept this status.";
  const rec = r.record;
  const amount = Number(rec.totalReleasedAmount);
  // Not released yet: never a date (MyLoans may hold a planned one), said in words rather than a bare dash.
  const released = r.statusKind === "before_release" ? "Not released yet" : rec.releaseDate ? dayText(rec.releaseDate) : "-";
  return (
    <section role="status" aria-labelledby="status-title" className="card min-w-0 p-4 sm:px-5 sm:py-4" data-find-status={r.statusKind}>
      <LoanHead name={r.borrowerName} pn={r.pn} titleId="status-name">
        <li data-status-name><ToneChip tone="act">{r.statusName}</ToneChip></li>
        <li><span className="chip c-mute" data-find-source>{SOURCE_NAME}</span></li>
      </LoanHead>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-act-bg px-3 py-2">
        <span className="flex shrink-0 text-act-fg"><AlertIcon size={18} /></span>
        <div className="min-w-0 flex-1">
          <p id="status-title" className="text-[15px] font-bold leading-snug text-navy" data-status-text>{text}</p>
          <p className="text-[13px] text-ink-2">Only released loans can be opened in the DMS. Nothing was saved.</p>
        </div>
        <Link href={`/loans?q=${encodeURIComponent(q)}`} className="btn-ghost h-10 min-h-10 shrink-0 bg-white px-3 text-sm">Try again</Link>
      </div>
      <LoanFacts rec={rec} amount={rec.totalReleasedAmount === null ? null : Number.isFinite(amount) && amount > 0 ? peso(amount) : "-"} released={released} />
    </section>
  );
}

/**
 * D-050: API 1 says the PN is in myloans but not a released loan. Only what API 1 sends: why (myloans' FeedState) and,
 * after a redo, the PN that replaced it, with a link to its loan file when it is already in the DMS, else to Find loan.
 */
function NotSelectable({ r, q }: { r: Extract<PnLookupResult, { kind: "not_selectable" }>; q: string }) {
  // The real status name when myloans gives one ("Check Prepared"); else what FeedState says.
  const chip = r.statusName ?? { Cancelled: "Cancelled", Superseded: "Redone", NotReleased: "Not released", Inactive: "Inactive", Released: "Released" }[r.feedState] ?? r.feedState;
  return (
    <section role="status" aria-labelledby="ns-title" className="card min-w-0 p-4 sm:px-5 sm:py-4" data-find-status="not_selectable" data-feed-state={r.feedState}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm text-ink-2" data-find-pn>{r.pn}</p>
        <ul aria-label="Loan status" className="flex flex-wrap items-center gap-2"><li><ToneChip tone="act">{chip}</ToneChip></li><li><span className="chip c-mute">{SOURCE_NAME}</span></li></ul>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-act-bg px-3 py-2">
        <span className="flex shrink-0 text-act-fg"><AlertIcon size={18} /></span>
        <div className="min-w-0 flex-1">
          <p id="ns-title" className="text-[15px] font-bold leading-snug text-navy" data-status-text>{r.message}</p>
          <p className="text-[13px] text-ink-2">Only released loans can be opened in the DMS. Nothing was saved.</p>
        </div>
        <Link href={`/loans?q=${encodeURIComponent(q)}`} className="btn-ghost h-10 min-h-10 shrink-0 bg-white px-3 text-sm">Try again</Link>
      </div>
      {r.replacedByPn && (
        <p className="mt-3 text-[15px]" data-replaced-by>
          Replaced by <strong className="font-mono">{r.replacedByPn}</strong>.{" "}
          {r.replacedInDms
            ? <Link href={`/loans/${r.replacedByPn}`} className="link">Open its loan file</Link>
            : <Link href={`/loans?q=${encodeURIComponent(r.replacedByPn)}`} className="link">Find it</Link>}
        </p>
      )}
    </section>
  );
}

/** Name and PN on the left; the chips (status, source, any amber chip) on the right, under the name below 1024px. */
function LoanHead({ name, pn, titleId, children, action }: { name: string; pn: string; titleId: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4" data-find-head>
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name.trim() || "?"} size={32} />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold leading-tight text-navy">{name.trim() || "-"}</h2>
          <p className="flex items-center gap-1.5"><span className="font-mono text-sm text-ink-2" data-find-pn>{pn}</span><CopyButton text={pn} label={`Copy PN ${pn}`} /></p>
        </div>
      </div>
      {/* The status chip and the "myloans · Not yet in DMS" badge at the top right; on the preview page Refresh from myloans beside them (D-060). */}
      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
        <ul aria-label="Loan status" className="flex flex-wrap items-center gap-1.5 empty:hidden" data-find-chips>{children}</ul>
        {action}
      </div>
    </div>
  );
}

/**
 * The details by name only (no codes or IDs; those are on the loan file under More loan details). D-060 adds the CIN
 * and the classification (the keyword rule; "Classified by default" when no keyword matched); the status in myloans
 * is not repeated here (the status chip, or on the preview page its subtitle, says it).
 */
function LoanFacts({ rec, amount, released, extra = [] }: { rec: Extract<PnLookupResult, { kind: "preview" }>["record"]; amount: string | null; released: string; extra?: [string, string][] }) {
  const name = (v: string | null | undefined) => v?.trim() || "-";
  const facts: [string, string][] = [
    ...(amount === null ? [] : [["Amount released", amount] as [string, string]]),
    ["Released on", released],
    ["Loan type", name(rec.loanType)],
    ["Product", name(rec.productName)],
    ["Branch", name(rec.branchName)],
    ["Area", name(rec.areaName)],
    ["Division", name(rec.divisionName)],
    ["Company", name(rec.companyName)],
    ...extra,
  ];
  return (
    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4 md:gap-x-5" data-find-facts>
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs leading-tight text-ink-2">{k}</dt>
          <dd className="break-words text-sm font-semibold leading-snug text-navy">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface PreviewExtras {
  /** A branch pool item: how long it has waited since it arrived ("Waiting 2 working days · arrived Nov 24"). */
  waiting?: string | null;
  /**
   * The preview page (D-060, the user's review on 26 November 2026): Refresh from myloans (API 1 again, past the short
   * cache) in the card header, at the top right beside the "Loan Released" chip and the "myloans · Not yet in DMS" badge
   * (the badge is not repeated beside the page subtitle).
   */
  page?: boolean;
}

/**
 * D-060: the preview of a released loan not yet in the DMS (the preview page, and the full-PN "Found in myloans"
 * result): name, PN with Copy and the "myloans · Not yet in DMS" badge; the myloans details; Open loan file (only for
 * people who may open loan files: the branch check already ran) and, on the page, Refresh from myloans.
 */
export function Preview({ r, warnings, waiting = null, page = false }: { r: Extract<PnLookupResult, { kind: "preview" }>; warnings: string[] } & PreviewExtras) {
  const rec = r.record;
  const financing = r.classification === "FINANCING";
  // An amber chip only for what is not fine (no "Your branch" or "Details complete" chips). Another loan of
  // the borrower and a replaced PN already have their own line above the header, so no chip.
  const amber = warnings.length > 0 ? ["Details incomplete"] : [];
  return (
    <section aria-labelledby="found-title" className="card min-w-0 p-3 sm:px-4 sm:py-3" data-find-preview>
      {/* D-051: no "other loans of this borrower" warning now (the renewal link is Phase B); only a redo myloans names. */}
      {r.replacesPn && (
        <div className="mb-3 flex flex-col gap-1.5" data-preview-warnings>
          <p className="rounded-xl bg-fill px-3 py-2 text-sm font-semibold text-navy">MyLoans says this PN replaces {r.replacesPn}. Opening it does not link them: an approver reviews the old one and decides whether to link them.</p>
        </div>
      )}
      {/* As in the old design: name and PN on the left; the status (by name, never the number) and the
          source on the right. The branch and product are in the details, so not repeated. */}
      <LoanHead name={rec.borrowerName} pn={rec.pn} titleId="found-title" action={page ? <RefreshPreviewButton pn={r.pn} /> : undefined}>
        {/* Compact (the user's review, 26 November 2026): 24px chips, 12px text. */}
        <li><span className="chip c-ok h-6 gap-1 px-2 text-xs"><CheckIcon size={12} strokeWidth={2.6} />{statusLabel(rec)}</span></li>
        <li data-find-source><NotInDmsBadge className="h-6 px-2" /></li>
        {amber.map((c) => <li key={c} data-find-amber><ToneChip tone="act">{c}</ToneChip></li>)}
      </LoanHead>
      {waiting && <p className="mt-1.5 text-[13px] text-ink-2" data-preview-waiting>{waiting}</p>}
      <LoanFacts rec={rec} amount={r.amount === null ? null : peso(r.amount)} released={dayText(rec.releaseDate)} extra={[
        ["CIN", rec.cin?.trim() || "-"],
        ["Classification", `${r.classification === "FINANCING" ? "Financing" : "Refinancing"}${r.classifiedByDefault ? " (classified by default)" : ""}`],
      ]} />
      {warnings.length > 0 && (
        // Admin's data check: MyLoans left these empty. A warning only; the loan file can still be opened.
        <p className="mt-3 rounded-xl bg-wait-bg px-3 py-2 text-[13px] text-wait-fg" data-account-warnings>
          <span className="font-semibold">Data check (Admin):</span> {warnings.join(" ")} Opening is not blocked.
        </p>
      )}
      <div className="mt-3 border-t border-line-soft pt-3">
        <OpenLoanForm pn={r.pn} financing={financing} canOpen={r.canOpen} facts={{ productName: r.productName, loanType: r.loanType, mortgageMet: r.mortgageMet }} />
      </div>
    </section>
  );
}
