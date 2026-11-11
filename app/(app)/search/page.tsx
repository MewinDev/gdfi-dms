import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, loanScope, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getMyLoansAdapter } from "@/lib/myloans";
import { examplePn, getPnFormat, isPnAttempt, parsePn, pnHeadline } from "@/lib/pn";
import { lookupPn, type PnLookupResult } from "@/lib/services/loan-file";
import { TRANSACTION_LABEL } from "@/lib/rules";
import { dayText, peso, stageWords, txnName } from "@/lib/ui/plain";
import { FindLoan } from "@/components/ui/find-loan";
import { Avatar, ToneChip } from "@/components/ui/basics";
import { AlertIcon } from "@/components/ui/icons";
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
  const pn = parsed.ok && (parsed.parts || isPnAttempt(q, { ...fmt, enabled: true })) ? parsed.pn : null;
  const badPn = !doc && !parsed.ok && isPnAttempt(q, fmt) ? parsed.message : null;
  let result: PnLookupResult | null = null;
  // PN: open the existing loan file (refreshed), or look it up in MyLoans
  if (!doc && pn) {
    const existing = await prisma.loan.findFirst({ where: { pn, ...loanScope(user) }, select: { pn: true } });
    if (can(user, PERMISSIONS.LOANS_SEARCH)) {
      result = await lookupPn(user, pn);
      if (result.kind === "existing") redirect(`/loans/${result.pn}${result.refreshed ? "?notice=refreshed" : "?notice=refresh-failed"}`);
    } else if (existing) {
      redirect(`/loans/${existing.pn}`);
    }
  }

  // CIN / CIF / part of a PN, among loan files
  // Loan files here: prefix first (the PN index), then part of a PN or the borrower's name (trigram indexes); at most 20.
  const include = { branch: true, documents: { where: { documentId: { not: null } }, orderBy: { documentId: "asc" as const } } };
  const searchLocal = q && !doc && !badPn && (!result || result.kind === "invalid");
  const prefix = searchLocal
    ? await prisma.loan.findMany({
        where: { ...loanScope(user), OR: [{ pn: { startsWith: q, mode: "insensitive" } }, { cin: { equals: q, mode: "insensitive" } }, { cif: { equals: q, mode: "insensitive" } }, { borrowerName: { startsWith: q, mode: "insensitive" } }] },
        include, take: 20, orderBy: { pn: "asc" },
      })
    : [];
  const matches = searchLocal && prefix.length < 20 && q.length >= 3
    ? [...prefix, ...(await prisma.loan.findMany({
        where: { ...loanScope(user), id: { notIn: prefix.map((l) => l.id) }, OR: [{ pn: { contains: q, mode: "insensitive" } }, { borrowerName: { contains: q, mode: "insensitive" } }] },
        include, take: 20 - prefix.length, orderBy: { pn: "asc" },
      }))]
    : prefix;

  const samples = await samplesPromise;
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 sm:gap-6" data-find-page>
      {/* The same container as My loans and Monitoring: the main area's width and padding. */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-navy sm:text-2xl">Find a loan</h1>
        <p className="text-sm text-ink-2">Looked up in MyLoans. Nothing is saved until you open the loan file.</p>
      </header>
      <FindLoan defaultValue={q} autoFocus={!q} suggest={can(user, PERMISSIONS.LOANS_SEARCH) ? { exactOnly: !getMyLoansAdapter().capabilities.search } : undefined} />

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
          ) : result && result.kind !== "invalid" ? (
            <Problem r={result} q={q} />
          ) : null}

          {doc && (
            <section aria-label="Document" className="flex flex-col gap-2">
              <h2 className="text-base font-bold text-navy">Paper {doc.documentId}</h2>
              <DocumentCard d={{ ...doc, pn: doc.loan.pn, borrowerName: doc.loan.borrowerName }} />
            </section>
          )}

          {!doc && !badPn && !result && matches.length === 0 && (
            <Notice tone="mute" role="status" pn={q} title={<>We could not find &ldquo;{q}&rdquo;.</>} q={q}>
              Type the full PN number, for example {examplePn(fmt)}. You can also use a CIN, CIF or the code printed on a label.
            </Notice>
          )}

          {matches.map((m) => (
            <section key={m.id} className="flex flex-col gap-2" aria-label={`Loan file ${m.pn}`}>
              <Link href={`/loans/${m.pn}`} className="card flex items-center gap-3 px-4 py-3 no-underline hover:bg-hover">
                <Avatar name={m.borrowerName} size={40} />
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-[15px] font-bold">{m.borrowerName}</span>
                  <span className="block text-sm text-ink-2"><span className="font-mono">{m.pn}</span> · {m.branch.name} · CIN {m.cin}</span>
                </span>
                <span className="hidden text-sm font-semibold sm:block">{stageWords(m.stage)}</span>
                <span className="btn-ghost min-h-10">Open</span>
              </Link>
              {m.documents.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {m.documents.map((d) => <DocumentCard key={d.id} d={{ ...d, pn: m.pn }} />)}
                </div>
              )}
            </section>
          ))}
        </FindResult>
      )}
    </div>
  );
}

/** A compact one- or two-line message: an icon, what happened and the PN, the next step, and Try again. */
function Notice({ tone, role = "alert", pn, title, q, children, data }: { tone: "bad" | "act" | "mute"; role?: "alert" | "status"; pn: string; title: React.ReactNode; q: string; children: React.ReactNode; data?: Record<string, string> }) {
  const cls = tone === "bad" ? "border-bad-line bg-bad-bg" : tone === "act" ? "border-act-line bg-act-bg" : "border-line bg-white";
  const icon = tone === "bad" ? "text-bad-fg" : tone === "act" ? "text-act-fg" : "text-ink-2";
  return (
    <section role={role} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-[14px] leading-snug sm:gap-x-4 sm:px-4 sm:text-[15px] ${cls}`} data-find-notice={tone} {...data}>
      <span className={`flex ${icon}`} data-notice-icon><AlertIcon size={18} /></span>
      {/* One text block on tablet and desktop; on a phone the explanation runs under Try again (full width). */}
      <div className="min-w-0 max-sm:contents" data-notice-text>
        <p className="col-start-2 row-start-1"><span className={`font-bold ${tone === "bad" ? "text-bad-fg" : "text-navy"}`}>{title}</span> <span className="font-mono text-sm text-ink-2" data-notice-pn>{pn}</span></p>
        <p className="col-span-2 col-start-2 row-start-2 text-sm text-ink sm:mt-0.5">{children}</p>
      </div>
      <Link href={`/search?q=${encodeURIComponent(q)}`} className="btn-ghost col-start-3 row-start-1 h-10 min-h-10 px-3 text-sm">Try again</Link>
    </section>
  );
}

const NEXT_STEP: Record<string, string> = {
  pn: "Check the number and try again.",
  branch: "This loan belongs to another branch. Ask that branch to open it.",
  status: "Wait until the loan is released in MyLoans, then try again.",
  releaseDate: "Ask the MyLoans data owner to add the release date, then try again.",
  loanType: "Ask the MyLoans data owner to correct the loan type, then try again.",
  totalReleasedAmount: "Ask the MyLoans data owner to correct the amount, then try again.",
};

function Problem({ r, q }: { r: PnLookupResult; q: string }) {
  if (r.kind === "preview" || r.kind === "existing" || r.kind === "invalid") return null;
  const title =
    r.kind === "not_found" ? "We could not find this loan in MyLoans."
    : r.kind === "unavailable" ? "MyLoans is not answering right now."
    : r.fieldLabel.startsWith("Inactive") ? `This ${r.field === "branch" ? "branch" : "loan type"} is inactive in Settings.`
    : r.field === "branch" ? "This loan is outside your branches."
    : r.field === "status" ? "This loan is not released yet."
    : "Some loan details in MyLoans need fixing first.";
  const next =
    r.kind === "not_found" ? NEXT_STEP.pn
    : r.kind === "unavailable" ? "Try again in a few minutes. If it keeps happening, contact IT."
    : r.fieldLabel.startsWith("Inactive") ? "Ask an Admin to make it active in Settings, then try again."
    : NEXT_STEP[r.field] ?? "Try again later.";
  const kind = r.kind === "refused" ? r.field : r.kind;
  return (
    <Notice tone="bad" pn={r.pn} title={title} q={q} data={{ "data-find-problem": kind }}>
      {r.message} {next} Nothing was saved.
    </Notice>
  );
}

function Preview({ r, warnings }: { r: Extract<PnLookupResult, { kind: "preview" }>; warnings: string[] }) {
  const rec = r.record;
  const financing = r.classification === "FINANCING";
  // The short list, names only (no codes or IDs; those are on the loan file under More loan details).
  const name = (v: string | null | undefined) => v?.trim() || "-";
  const facts: [string, string][] = [
    ["Amount released", peso(r.amount)],
    ["Released on", dayText(rec.releaseDate)],
    ["Loan type", name(rec.loanType)],
    ["Product", name(rec.productName)],
    ["Branch", name(rec.branchName)],
    ["Area", name(rec.areaName)],
    ["Division", name(rec.divisionName)],
    ["Company", name(rec.companyName)],
  ];
  return (
    <section aria-labelledby="found-title" className="card min-w-0 p-4 sm:p-6" data-find-preview>
      {(r.otherLoans.length > 0 || r.otherHidden > 0 || r.replacesPn) && (
        <div className="mb-4 flex flex-col gap-2" data-preview-warnings>
          {r.replacesPn && <p className="rounded-xl bg-fill px-3 py-2 text-sm font-semibold text-navy">MyLoans says this PN replaces {r.replacesPn}. Opening it links both files; Admin then reviews the old one.</p>}
          {(r.otherLoans.length > 0 || r.otherHidden > 0) && (
            <p className="rounded-xl bg-wait-bg px-3 py-2 text-sm font-semibold text-wait-fg" data-other-loans>
              {r.otherLoans.length > 0 ? `This borrower has another loan: ${r.otherLoans.join(", ")}` : "This borrower has another loan"}
              {r.otherHidden > 0 ? `${r.otherLoans.length ? "," : ":"} ${r.otherHidden} more in another branch` : ""}
            </p>
          )}
        </div>
      )}
      {/* Avatar and name on the left; the status chips on the right (under the name below 1024px). */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4" data-find-head>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={rec.borrowerName} size={40} />
          <div className="min-w-0">
            <h2 id="found-title" className="text-lg font-bold leading-tight text-navy">{rec.borrowerName}</h2>
            <p className="text-sm text-ink-2"><span className="font-mono">{rec.pn}</span> · {rec.productName?.trim() || "No product name"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label="Checks passed" className="flex flex-wrap gap-2">
            {/* The MyLoans status by its name (never the number). */}
            {[statusLabel(rec), "Your branch", "Details complete"].map((c) => (
              <li key={c}><ToneChip tone="ok" check>{c}</ToneChip></li>
            ))}
          </ul>
          <span className="chip c-mute" data-find-source>Source: {SOURCE_NAME}</span>
        </div>
      </div>
      {/* One 12-column grid: each fact takes 3 columns, each question 6 (OpenLoanForm uses the same grid and gap). */}
      <dl className="mt-4 grid grid-cols-12 gap-x-6 gap-y-4">
        {facts.map(([k, v]) => (
          <div key={k} className="col-span-6 min-w-0 md:col-span-3">
            <dt className="text-xs text-ink-2">{k}</dt>
            <dd className="mt-0.5 break-words text-base font-semibold text-navy md:truncate" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        // Admin's data check: MyLoans left these empty. A warning only; the loan file can still be opened.
        <p className="mt-4 rounded-xl bg-wait-bg px-3 py-2 text-[13px] text-wait-fg" data-account-warnings>
          <span className="font-semibold">Data check (Admin):</span> {warnings.join(" ")} Opening is not blocked.
        </p>
      )}
      {!financing && r.outcome && (
        <div className="mt-5 rounded-xl bg-cream px-4 py-3 text-sm">
          <p className="font-semibold text-navy">This is a Refinancing loan. Nothing to answer.</p>
          <p className="mt-0.5 text-ink-2">
            We will set up: {r.outcome.transactions.map((t) => txnName(t, TRANSACTION_LABEL[t])).join(", ")}.
            {r.outcome.mortgage === "MORTGAGE" ? " A mortgage is needed." : " No mortgage needed."}
          </p>
        </div>
      )}
      <div className="mt-5">
        <OpenLoanForm pn={r.pn} financing={financing} canOpen={r.canOpen} />
      </div>
      <p className="mt-4 border-t border-line pt-4 text-[13px] text-ink-2" data-find-next>Next: we set up the loan file, you check the papers, then send them to a processor.</p>
    </section>
  );
}
