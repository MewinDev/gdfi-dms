import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, loanScope, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { examplePn, getPnFormat, isPnAttempt, parsePn, pnHeadline } from "@/lib/pn";
import { lookupPn, type PnLookupResult } from "@/lib/services/loan-file";
import { completePn, LIST_LIMIT, savedLoanCard, searchSaved } from "@/lib/services/find-local";
import { SavedLoanCard, type SavedLoanCardData } from "@/components/loan/saved-loan-card";
import { dayText, peso } from "@/lib/ui/plain";
import { stageLabel } from "@/lib/workflow/stage-map";
import { FindLoan } from "@/components/ui/find-loan";
import { Avatar, ToneChip } from "@/components/ui/basics";
import { AlertIcon, LockIcon } from "@/components/ui/icons";
import { OpenLoanForm } from "@/components/loan/open-loan-form";
import { DocumentCard } from "@/components/loan/document-card";
import { SampleLoans } from "@/components/loan/sample-loans";
import { FindResult } from "@/components/loan/find-result";
import { loadSampleCards } from "@/lib/ui/samples";
import { statusLabel } from "@/lib/myloans/status";
import { accountWarnings } from "@/lib/myloans/account";
import { SOURCE_NAME } from "@/lib/myloans/types";

export const metadata: Metadata = { title: "Find a loan" };

export default async function FindLoanPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const q = ((await searchParams).q ?? "").trim();
  const samplesPromise = loadSampleCards(user);

  // Document ID
  const doc = q
    ? await prisma.documentItem.findFirst({
        where: { documentId: { equals: q, mode: "insensitive" }, loan: loanScope(user) },
        include: { loan: { select: { pn: true, borrowerName: true } } },
      })
    : null;

  // PN: the shared check first (Settings, System, PN format). A wrong PN never reaches MyLoans.
  const fmt = await getPnFormat();
  const parsed = parsePn(q, fmt);
  const pn = doc ? null : await completePn(q);
  const pnAttempt = !doc && !pn && !parsed.ok && isPnAttempt(q, fmt) ? parsed.message : null;
  let result: PnLookupResult | null = null;
  let saved: SavedLoanCardData | null = null;
  // A complete PN: the DMS first, by exact PN. Saved here: "Already in the DMS" (no MyLoans call; a stale
  // copy is refreshed in the background by the card). Outside the person's branches: said so, no call.
  // Not saved: exactly one MyLoans lookup, then the preview.
  if (pn) {
    if (can(user, PERMISSIONS.LOANS_SEARCH)) result = await lookupPn(user, pn);
    if (!result || result.kind === "existing") {
      saved = await savedLoanCard(user, pn);
      result = null;
    }
  }

  // Part of a PN, a CIN or CIF, or a name: the DMS only (never MyLoans), at most 20 loan files. Text that
  // looks like a PN but is not a valid one: the loan files it matches; when none, the PN message as before.
  const searchLocal = q && !doc && !saved && (!result || result.kind === "invalid");
  const matches = searchLocal ? await searchSaved(user, q, LIST_LIMIT) : [];
  const badPn = pnAttempt && matches.length === 0 ? pnAttempt : null;

  const samples = await samplesPromise;
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 sm:gap-6" data-find-page>
      {/* The same container as My loans and Monitoring: the main area's width and padding. */}
      {/* scroll-mt: when the page is scrolled to the title, it stops below the sticky top bar. */}
      <header className="flex scroll-mt-24 flex-wrap items-baseline gap-x-3 gap-y-1" data-find-title>
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-navy sm:text-2xl">Find a loan</h1>
        <p className="text-sm text-ink-2">Loan files in the DMS first; a full PN not opened here yet is looked up in MyLoans.</p>
      </header>
      <FindLoan defaultValue={q} autoFocus={!q} suggest={can(user, PERMISSIONS.LOANS_SEARCH)} />

      {samples.samples.length > 0 && (
        <SampleLoans id="find-samples" title="Sample loans" intro="Pick one to put its PN in the box, then press Find loan." samples={samples.samples} />
      )}
      {samples.dataCheck.length > 0 && (
        <SampleLoans id="find-datacheck" title="Data-check samples" intro="These test the checks that refuse a loan." samples={samples.dataCheck} />
      )}

      {q && (
        <FindResult key={q} q={q}>
          {badPn && (
            <Notice tone="act" pn={q} title={pnHeadline(fmt)} q={q} data={{ "data-pn-error": "" }}>
              <span data-pn-part>{badPn}</span>
            </Notice>
          )}
          {result?.kind === "preview" ? (
            <Preview r={result} warnings={can(user, PERMISSIONS.SOURCE_MANAGE) ? accountWarnings(result.record) : []} />
          ) : result?.kind === "status" ? (
            <StatusCard r={result} q={q} />
          ) : result && result.kind !== "invalid" ? (
            <Problem r={result} q={q} />
          ) : null}

          {doc && (
            <section aria-label="Document" className="flex flex-col gap-2">
              <h2 className="text-base font-bold text-navy">Paper {doc.documentId}</h2>
              <DocumentCard d={{ ...doc, pn: doc.loan.pn, borrowerName: doc.loan.borrowerName }} />
            </section>
          )}

          {saved && <SavedLoanCard d={saved} />}

          {!doc && !badPn && !result && !saved && matches.length === 0 && (
            <Notice tone="mute" role="status" pn={q} title="Not found in the DMS." q={q} data={{ "data-find-not-saved": "" }}>
              {can(user, PERMISSIONS.LOANS_SEARCH) ? <>To look it up in MyLoans, type the full PN, for example {examplePn(fmt)}.</> : "Only the loan files of your branches are searched."}
            </Notice>
          )}

          {matches.length > 0 && (
            <section aria-label="Loan files in the DMS" className="card min-w-0 overflow-hidden" data-find-list>
              <p className="border-b border-line-soft px-4 py-2 text-[13px] text-ink-2">
                {matches.length >= LIST_LIMIT ? `The first ${LIST_LIMIT} loan files in the DMS` : `${matches.length} loan file${matches.length === 1 ? "" : "s"} in the DMS`}
              </p>
              <ul>
                {matches.map((m) => (
                  <li key={m.id} className="border-b border-line-soft last:border-0">
                    <Link href={`/loans/${m.pn}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 no-underline hover:bg-hover" data-find-list-row={m.pn}>
                      <span className="mono text-[14px] font-bold text-navy">{m.pn}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{m.borrowerName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="chip c-navy h-6 text-xs">{stageLabel(m.stage)}</span>
                        <span className="hidden text-[12px] text-ink-2 sm:inline">{m.branch.name}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </FindResult>
      )}
    </div>
  );
}

/** A compact one- or two-line message: an icon, what happened and the PN, the next step, and Try again. */
function Notice({ tone, role = "alert", pn, title, q, children, data }: { tone: "bad" | "act" | "mute"; role?: "alert" | "status"; pn: string; title: React.ReactNode; q: string; children?: React.ReactNode; data?: Record<string, string> }) {
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
      <Link href={`/search?q=${encodeURIComponent(q)}`} className="btn-ghost col-start-3 row-start-1 h-10 min-h-10 px-3 text-sm">Try again</Link>
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
        <Link href={`/search?q=${encodeURIComponent(q)}`} className="btn-ghost h-10 min-h-10 shrink-0 bg-white px-3 text-sm">Try again</Link>
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
        <Link href={`/search?q=${encodeURIComponent(q)}`} className="btn-ghost h-10 min-h-10 shrink-0 bg-white px-3 text-sm">Try again</Link>
      </div>
      <LoanFacts rec={rec} amount={Number.isFinite(amount) && amount > 0 ? peso(amount) : "-"} released={released} />
    </section>
  );
}

/** Name and PN on the left; the chips (status, source, any amber chip) on the right, under the name below 1024px. */
function LoanHead({ name, pn, titleId, children }: { name: string; pn: string; titleId: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4" data-find-head>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name.trim() || "?"} size={40} />
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold leading-tight text-navy">{name.trim() || "-"}</h2>
          <p className="font-mono text-sm text-ink-2" data-find-pn>{pn}</p>
        </div>
      </div>
      <ul aria-label="Loan status" className="flex flex-wrap items-center gap-2" data-find-chips>{children}</ul>
    </div>
  );
}

/** The eight details by name only (no codes or IDs; those are on the loan file under More loan details). */
function LoanFacts({ rec, amount, released }: { rec: Extract<PnLookupResult, { kind: "preview" }>["record"]; amount: string; released: string }) {
  const name = (v: string | null | undefined) => v?.trim() || "-";
  const facts: [string, string][] = [
    ["Amount released", amount],
    ["Released on", released],
    ["Loan type", name(rec.loanType)],
    ["Product", name(rec.productName)],
    ["Branch", name(rec.branchName)],
    ["Area", name(rec.areaName)],
    ["Division", name(rec.divisionName)],
    ["Company", name(rec.companyName)],
  ];
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-4 md:gap-x-6" data-find-facts>
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-2">{k}</dt>
          <dd className="break-words text-[15px] font-semibold leading-snug text-navy md:truncate" title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Preview({ r, warnings }: { r: Extract<PnLookupResult, { kind: "preview" }>; warnings: string[] }) {
  const rec = r.record;
  const financing = r.classification === "FINANCING";
  // An amber chip only for what is not fine (no "Your branch" or "Details complete" chips). Another loan of
  // the borrower and a replaced PN already have their own line above the header, so no chip.
  const amber = warnings.length > 0 ? ["Details incomplete"] : [];
  return (
    <section aria-labelledby="found-title" className="card min-w-0 p-4 sm:px-5 sm:py-4" data-find-preview>
      {(r.otherLoans.length > 0 || r.otherHidden > 0 || r.replacesPn) && (
        <div className="mb-3 flex flex-col gap-1.5" data-preview-warnings>
          {r.replacesPn && <p className="rounded-xl bg-fill px-3 py-2 text-sm font-semibold text-navy">MyLoans says this PN replaces {r.replacesPn}. Opening it does not link them: Admin reviews the old one and decides whether to link them.</p>}
          {(r.otherLoans.length > 0 || r.otherHidden > 0) && (
            <p className="rounded-xl bg-wait-bg px-3 py-2 text-sm font-semibold text-wait-fg" data-other-loans>
              {r.otherLoans.length > 0 ? `This borrower has another loan: ${r.otherLoans.join(", ")}` : "This borrower has another loan"}
              {r.otherHidden > 0 ? `${r.otherLoans.length ? "," : ":"} ${r.otherHidden} more in another branch` : ""}
            </p>
          )}
        </div>
      )}
      {/* As in the old design: name and PN on the left; the status (by name, never the number) and the
          source on the right. The branch and product are in the details, so not repeated. */}
      <LoanHead name={rec.borrowerName} pn={rec.pn} titleId="found-title">
        <li><ToneChip tone="ok" check>{statusLabel(rec)}</ToneChip></li>
        <li><span className="chip c-mute" data-find-source>{SOURCE_NAME}</span></li>
        {amber.map((c) => <li key={c} data-find-amber><ToneChip tone="act">{c}</ToneChip></li>)}
      </LoanHead>
      <LoanFacts rec={rec} amount={peso(r.amount)} released={dayText(rec.releaseDate)} />
      {warnings.length > 0 && (
        // Admin's data check: MyLoans left these empty. A warning only; the loan file can still be opened.
        <p className="mt-3 rounded-xl bg-wait-bg px-3 py-2 text-[13px] text-wait-fg" data-account-warnings>
          <span className="font-semibold">Data check (Admin):</span> {warnings.join(" ")} Opening is not blocked.
        </p>
      )}
      <div className="mt-4 border-t border-line-soft pt-3.5">
        <OpenLoanForm pn={r.pn} financing={financing} canOpen={r.canOpen} facts={{ productName: r.productName, loanType: r.loanType, amount: r.amount }} />
      </div>
    </section>
  );
}
