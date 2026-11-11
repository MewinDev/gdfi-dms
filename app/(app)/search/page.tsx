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
import { Avatar, PageHeader, ToneChip } from "@/components/ui/basics";
import { AlertIcon } from "@/components/ui/icons";
import { OpenLoanForm } from "@/components/loan/open-loan-form";
import { DocumentCard } from "@/components/loan/document-card";
import { SampleLoans } from "@/components/loan/sample-loans";
import { loadSampleCards } from "@/lib/ui/samples";

export const metadata: Metadata = { title: "Find a loan" };

export default async function FindLoanPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const q = ((await searchParams).q ?? "").trim();
  // The search box lives on the Loans page; this page shows the results.
  if (!q) redirect("/loans?find=1");
  const samplesPromise = loadSampleCards();

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
  const showSide = result?.kind === "preview";
  return (
    <div className="flex w-full flex-col gap-4 sm:gap-6">
      <PageHeader title="Find a loan" help="We look it up in MyLoans for you. Nothing is saved until you open the loan file." />
      <FindLoan defaultValue={q} strong suggest={can(user, PERMISSIONS.LOANS_SEARCH) ? { exactOnly: !getMyLoansAdapter().capabilities.search } : undefined} />

      {samples.samples.length > 0 && (
        <SampleLoans id="find-samples" title="Sample loans" intro="Pick one to put its PN in the box above, then press Find loan. Nothing is saved until Open loan file." samples={samples.samples} />
      )}
      {samples.dataCheck.length > 0 && (
        <SampleLoans id="find-datacheck" title="Data-check samples" intro="These test the checks that refuse a loan, and the rule edge cases." samples={samples.dataCheck} />
      )}

    <div className={`grid w-full gap-6 ${showSide ? "xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start" : ""}`}>
      <div className="flex min-w-0 flex-col gap-6">
      {badPn && (
        <div role="alert" className="card border-l-4 border-l-[var(--bad-fg)] p-5 text-[15px]" data-pn-error>
          <p className="font-semibold text-navy">{pnHeadline(fmt)}</p>
          <p className="mt-1 text-ink-2" data-pn-part>{badPn}</p>
        </div>
      )}
      {result?.kind === "preview" ? (
        <Preview r={result} />
      ) : result && result.kind !== "invalid" ? (
        <Problem r={result} q={q} />
      ) : null}

      {doc && (
        <section aria-label="Document" className="flex flex-col gap-3">
          <h2 className="text-xl font-bold text-navy">Paper {doc.documentId}</h2>
          <DocumentCard d={{ ...doc, pn: doc.loan.pn, borrowerName: doc.loan.borrowerName }} />
        </section>
      )}

      {q && !doc && !badPn && !result && matches.length === 0 && (
        <div role="status" className="card p-5 text-[15px]">
          <p className="font-semibold text-navy">We could not find &ldquo;{q}&rdquo;.</p>
          <p className="mt-1 text-ink-2">Type the full PN number, for example {examplePn(fmt)}. You can also use a CIN, CIF or the code printed on a label.</p>
        </div>
      )}

      {matches.map((m) => (
        <section key={m.id} className="flex flex-col gap-3" aria-label={`Loan file ${m.pn}`}>
          <Link href={`/loans/${m.pn}`} className="card flex items-center gap-4 p-4 no-underline hover:bg-hover">
            <Avatar name={m.borrowerName} />
            <span className="min-w-0 flex-1 leading-snug">
              <span className="block text-base font-bold">{m.borrowerName}</span>
              <span className="block text-sm text-ink-2"><span className="font-mono">{m.pn}</span> · {m.branch.name} · CIN {m.cin}</span>
            </span>
            <span className="hidden text-sm font-semibold sm:block">{stageWords(m.stage)}</span>
            <span className="btn-ghost">Open</span>
          </Link>
          {m.documents.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {m.documents.map((d) => <DocumentCard key={d.id} d={{ ...d, pn: m.pn }} />)}
            </div>
          )}
        </section>
      ))}
      </div>

      {showSide && (
        <div className="flex min-w-0 flex-col gap-6">
          <WhatHappensNext />
        </div>
      )}
    </div>
    </div>
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
  return (
    <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-bad-fg/30 bg-bad-bg p-5 sm:flex-row sm:items-start sm:p-6">
      <span className="text-bad-fg"><AlertIcon size={26} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold text-bad-fg">{title}</p>
        <p className="mt-1 text-[15px] text-ink">{r.message}</p>
        <p className="mt-1 text-[15px] text-ink">{next}</p>
        <p className="mt-2 text-sm text-ink-2">{r.pn} · Nothing was saved.</p>
      </div>
      <Link href={`/search?q=${encodeURIComponent(q)}`} className="btn-ghost w-full sm:w-auto">Try again</Link>
    </section>
  );
}

function Preview({ r }: { r: Extract<PnLookupResult, { kind: "preview" }> }) {
  const rec = r.record;
  const financing = r.classification === "FINANCING";
  const facts: [string, string][] = [
    ["Amount released", peso(r.amount)],
    ["Branch", rec.branchName ?? "-"],
    ["Released on", dayText(rec.releaseDate)],
    ["Loan type", rec.loanType ?? "-"],
  ];
  return (
    <section aria-labelledby="found-title" className="card min-w-0 p-5 sm:p-7">
      {(r.otherLoans.length > 0 || r.otherHidden > 0 || r.replacesPn) && (
        <div className="mb-4 flex flex-col gap-2" data-preview-warnings>
          {r.replacesPn && <p className="rounded-xl bg-fill px-3 py-2 text-[14px] font-semibold text-navy">MyLoans says this PN replaces {r.replacesPn}. Opening it links both files; Admin then reviews the old one.</p>}
          {(r.otherLoans.length > 0 || r.otherHidden > 0) && (
            <p className="rounded-xl bg-wait-bg px-3 py-2 text-[14px] font-semibold text-wait-fg" data-other-loans>
              {r.otherLoans.length > 0 ? `This borrower has another loan: ${r.otherLoans.join(", ")}` : "This borrower has another loan"}
              {r.otherHidden > 0 ? `${r.otherLoans.length ? "," : ":"} ${r.otherHidden} more in another branch` : ""}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={rec.borrowerName} size={56} />
        <div className="min-w-0 flex-1">
          <h2 id="found-title" className="text-[22px] font-bold text-navy sm:text-2xl">{rec.borrowerName}</h2>
          <p className="text-base text-ink-2">{rec.pn} · {rec.productName?.trim() || "No product name"}</p>
        </div>
        <ToneChip tone="ok" check>Loan found</ToneChip>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-5 md:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-ink-2">{k}</dt>
            <dd className="text-[17px] font-bold text-navy">{v}</dd>
          </div>
        ))}
      </dl>
      <ul aria-label="Checks passed" className="mt-5 flex flex-wrap gap-2.5">
        {["Released", "Your branch", "Details complete"].map((c) => (
          <li key={c}><ToneChip tone="ok" check>{c}</ToneChip></li>
        ))}
      </ul>
      {!financing && r.outcome && (
        <div className="mt-6 rounded-xl bg-cream p-4 text-[15px]">
          <p className="font-semibold text-navy">This is a Refinancing loan. Nothing to answer.</p>
          <p className="mt-1 text-ink-2">
            We will set up: {r.outcome.transactions.map((t) => txnName(t, TRANSACTION_LABEL[t])).join(", ")}.
            {r.outcome.mortgage === "MORTGAGE" ? " A mortgage is needed." : " No mortgage needed."}
          </p>
        </div>
      )}
      <div className="mt-6">
        <OpenLoanForm pn={r.pn} financing={financing} canOpen={r.canOpen} />
      </div>
    </section>
  );
}

function WhatHappensNext() {
  const steps = [
    "We set up the loan file and decide which documents are needed.",
    "You check the papers in your hands against the list.",
    "You send the package to a processor.",
  ];
  return (
    <aside aria-labelledby="whn" className="card bg-fill p-6">
      <h2 id="whn" className="text-lg font-bold text-navy">What happens next</h2>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3.5 text-base leading-snug">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-line pt-4 text-sm text-ink-2">Nothing to type for documents. We choose them from the loan details.</p>
    </aside>
  );
}
