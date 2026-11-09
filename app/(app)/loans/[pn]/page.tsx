import type { Metadata } from "next";
import { txnFundsType } from "@/lib/jobs/view";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, inScope, requirePagePermission, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getLoanContext, getLoanForUser, type LoanDetail } from "@/lib/services/queries";
import { PAPERS_BACK_FIRST, checklistStatusOf, recommendDp } from "@/lib/services/workflow";
import { businessDate, fmtDate, fmtDateTime, fmtShort } from "@/lib/time";
import { openJobCounts, processors } from "@/lib/services/monitoring";
import { advisoryWarnings } from "@/lib/services/lto-advisories";
import { availability, leaveText } from "@/lib/monitoring/rules";
import { JOURNEY_STEP_COUNT, dayText, deadlineChip, liveAssignment, peso, plainMessage, progressStep, stageWords, timeAgo, txnName } from "@/lib/ui/plain";
import { Banner, ToneChip } from "@/components/ui/basics";
import { AlertIcon, ChevronRightIcon, PauseIcon, PrinterIcon } from "@/components/ui/icons";
import { PageTop } from "@/components/loan/page-top";
import { Stepper } from "@/components/ui/stepper";
import { FixProblem, ReportProblem, WorkCard, type Line, type SendOptions } from "@/components/loan/work";
import { OverrideForm, RefreshButton } from "@/components/loan/forms";
import { JourneyTab } from "@/components/loan/journey/journey-tab";
import { AddTransaction, MarkDone } from "@/components/loan/add-transaction";
import { DOC_STAGE_LABEL } from "@/components/loan/document-card";
import { TxnJobPanel } from "@/components/jobs/txn-job-panel";
import { SelectionFocus, StoredToast, TxnSideList, TxnStrip, type TxnItem } from "@/components/loan/txn-switcher";
import { openHold, openProblem, txnTat } from "@/lib/jobs/view";
import { FocusFromUrl, OpenItemsCard, type OpenRow } from "@/components/loan/open-items-client";
import { LiveAnnouncer, LiveToast } from "@/components/ui/live-toast";
import { focusTargetOf, openItemsOf, titleChipOf, type OpenItem } from "@/lib/ui/open-items";
import { txnStatus, type TxnStatus } from "@/lib/ui/txn-status";
import { TxnStatusChips } from "@/components/loan/txn-status-chips";
import { requestedCheckIds, ASKED_FROM, type AskedFrom } from "@/lib/services/workflow";
import { PutOnHoldForm, type HoldBrief } from "@/components/jobs/forms";
import { HoldSummary } from "@/components/jobs/hold-summary";
import { mayTransferHold, transferCandidates } from "@/lib/services/holds";
import { LockedArea } from "@/components/ui/locked-area";
import { SentBackCard } from "@/components/loan/sent-back-card";
import { PapersBackCard } from "@/components/loan/papers-back";
import { inactiveSenderNote, roundChip, sentBack, sentBackIsFor } from "@/lib/ui/rounds";
import { CLOCK_NOTE, firstLine, lockedMessage, mayAddDetails, mayResumeHold, holdReasonName } from "@/lib/ui/holds";
import { holdDays, problemDays } from "@/lib/workflow/tat";
import { sendBlockReason } from "@/lib/services/source-blocks";
import { refreshOnOpen } from "@/lib/services/source-sync";
import { relatedPanel, reviewFor, reusableFor, type ReviewData } from "@/lib/services/source-review";
import { RelatedLoansCard } from "@/components/loan/related-loans";
import { CopyReusablePapers, SourceReviewEntry } from "@/components/loan/source-review";

type Ctx = Awaited<ReturnType<typeof getLoanContext>>;
type Txn = LoanDetail["transactions"][number];

export async function generateMetadata({ params }: { params: Promise<{ pn: string }> }): Promise<Metadata> {
  return { title: (await params).pn.toUpperCase() };
}

const NOTICES: Record<string, { tone: "ok" | "wait" | "bad"; text: string }> = {
  opened: { tone: "ok", text: "Loan file opened. We set up the work and the list of papers. Start by checking the papers." },
  "already-open": { tone: "wait", text: "This loan already has a loan file, so we opened it as it is." },
  "refresh-failed": { tone: "bad", text: "MyLoans is not answering right now, so you are seeing the saved copy." },
};

const TAB_ALIASES: Record<string, string> = { overview: "todo", transactions: "todo", exceptions: "todo" };
/** Old addresses of the History tab: they open the Journey tab. */
const OLD_HISTORY = ["history", "activity"];

export default async function LoanFilePage({ params, searchParams }: { params: Promise<{ pn: string }>; searchParams: Promise<{ tab?: string; notice?: string; work?: string; tx?: string; scope?: string; filter?: string; view?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const { pn } = await params;
  const sp = await searchParams;
  let loan = await getLoanForUser(user, decodeURIComponent(pn));
  if (!loan) notFound(); // includes loan files outside the LA's branches
  // Refreshed from MyLoans when the copy is older than the setting; an outage never blocks the page.
  if (await refreshOnOpen(loan)) loan = (await getLoanForUser(user, loan.pn)) ?? loan;
  const [review, reusable, related] = await Promise.all([reviewFor(user, loan.id), reusableFor(user, loan.id), relatedPanel(user, loan)]);
  const copySources = [...new Set(reusable.map((o) => o.fromPn))].map((pn) => ({ pn, options: reusable.filter((o) => o.fromPn === pn) }));
  if (OLD_HISTORY.includes(sp.tab ?? "")) redirect(`/loans/${loan.pn}?tab=journey`);
  const ctx = await getLoanContext(loan);
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  const raw = TAB_ALIASES[sp.tab ?? ""] ?? sp.tab ?? "todo";
  const tab = ["todo", "documents", "journey"].includes(raw) ? raw : "todo";
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  // Check documents: ?tx=NOTARY (old links: ?work=<id>). An unknown or empty tx opens the first one that needs action.
  const checkMode = tab === "todo" && (sp.tx !== undefined || !!sp.work);
  const workTxn = checkMode
    ? live.find((t) => !!sp.tx && t.type.code.toLowerCase() === sp.tx.toLowerCase()) ?? live.find((t) => t.id === sp.work) ?? live.find(needsAction) ?? live[0] ?? null
    : null;
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;

  const dl = deadlineChip(ctx.tat, ctx.holidays);
  const labelsPending = loan.documents.filter((d) => d.documentId && d.stage === "AT_BRANCH" && !d.labelPrintedAt);
  const step = progressStep(loan.stage);
  const tabs = [
    { key: "todo", label: "To do" },
    { key: "documents", label: "Documents" },
    { key: "journey", label: "Journey" },
  ];
  const base = `/loans/${loan.pn}`;
  // An open problem on any live transaction turns the current step red (the clock keeps counting).
  const withProblem = live.map((t) => ({ t, p: openProblem(t.problems) })).find((x) => x.p);
  const loanProblem = withProblem?.p ? { reason: withProblem.p.reason.name, days: Math.max(1, problemDays([withProblem.p], ctx.holidays)) } : null;
  // An open hold turns it navy with a pause icon (the problem wins when both are open).
  const withHold = live.map((t) => openHold(t.holds)).find((h) => !!h);
  const loanHold = withHold ? { reason: holdReasonName(withHold), days: Math.max(1, holdDays([withHold], ctx.holidays)) } : null;

  return (
    <div className="dense flex w-full flex-col gap-4 lg:-mx-2 lg:-mt-2">
      <PageTop
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: la ? "My loans" : "Loans", href: "/loans" },
          { label: loan.pn, href: workTxn ? `${base}?tab=todo` : undefined },
          ...(workTxn ? [{ label: "Check documents" }] : []),
        ]}
        back={workTxn ? { label: "Loan File", href: `${base}?tab=todo` } : { label: la ? "My loans" : "Loans", href: "/loans" }}
        title={workTxn ? "Check documents" : "Loan File"}
        subtitle={workTxn
          ? `${txnName(workTxn.type.code, workTxn.type.name)} · ${loan.borrowerName} · ${loan.pn}`
          : `${loan.borrowerName} · ${loan.pn} · ${loan.branch.name} · ${peso(Number(loan.totalReleasedAmount))} · ${loan.loanType}`}
        right={workTxn
          ? (can(user, PERMISSIONS.LABELS_PRINT) && loan.documents.some((d) => d.documentId)
              ? <Link href={`${base}/labels`} className="btn-ghost btn-sm hidden sm:inline-flex">Print all labels</Link>
              : null)
          : dl && <ToneChip tone={dl.tone}>{dl.text}</ToneChip>}
      />

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {loan.cancelledAt && <Banner tone="bad">Closed: {loan.cancelReason ?? "Cancelled in MyLoans"} ({fmtDateTime(loan.cancelledAt)}). Nothing was deleted.</Banner>}
      <SourceStrip loan={loan} />
      {!la && <Banner tone="wait">You are viewing this loan file. Your role does not include the steps on it.</Banner>}

      {!workTxn && <Stepper current={step} problem={loanProblem} hold={loanHold} />}

      <nav aria-label="Loan file sections" className={`border-b border-line ${workTxn ? "hidden sm:flex" : "flex"}`}>
        {tabs.map((t) => (
          <Link key={t.key} href={`${base}?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className="tab flex-1 justify-center sm:flex-none">
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "todo" && workTxn && <WorkView loan={loan} ctx={ctx} user={user} selected={workTxn} review={review} />}
      {tab === "todo" && !workTxn && (
        <>
          {review && <SourceReviewEntry review={review} />}
          {copySources.map((c) => <CopyReusablePapers key={c.pn} loanId={loan.id} oldPn={c.pn} mode={c.options[0].mode} options={c.options} />)}
          <TodoTab loan={loan} ctx={ctx} user={user} labelsPending={labelsPending.length} step={step} related={<RelatedLoansCard loanId={loan.id} rows={related.rows} hidden={related.hidden} />} />
        </>
      )}
      {tab === "documents" && <DocumentsTab loan={loan} la={can(user, PERMISSIONS.LABELS_PRINT)} />}
      {tab === "journey" && <JourneyTab loan={loan} user={user} params={{ scope: sp.scope, filter: sp.filter, view: sp.view }} />}
    </div>
  );
}

// ===========================================================================
// To do
// ===========================================================================

interface NextStep {
  title: string;
  help: string;
  primary?: { label: string; href: string; print?: boolean };
  secondary?: { label: string; href: string };
  /** Every open transaction is on hold: the usual step button is shown as a secondary (outline) button. */
  waiting?: boolean;
  txnId?: string;
}

/** Open = not finished and not cancelled. */
const isOpenTxn = (t: { status: string }) => !["COMPLETED", "CANCELLED"].includes(t.status);

/**
 * The one next step. Held transactions are skipped (they wait for a Resume). When every open
 * transaction is on hold, the card says "Waiting for a resume" and keeps the usual step as a
 * secondary button.
 */
function nextStep(loan: LoanDetail, labelsPending: number): NextStep {
  const held = new Set(loan.transactions.filter((t) => openHold(t.holds)).map((t) => t.id));
  const open = loan.transactions.filter(isOpenTxn);
  if (open.length > 0 && open.every((t) => held.has(t.id))) {
    const usual = stepFor(loan, labelsPending, new Set());
    const btn = usual.primary ?? usual.secondary;
    return {
      title: "Waiting for a resume",
      help: open.length === 1 ? "The work is on hold. Press Resume above when what it waits on has arrived." : "Every open transaction is on hold. Press Resume above when what one waits on has arrived.",
      secondary: btn ? { label: btn.label, href: btn.href } : undefined,
      waiting: true,
    };
  }
  return stepFor(loan, labelsPending, held);
}

function stepFor(loan: LoanDetail, labelsPending: number, held: ReadonlySet<string>): NextStep {
  const base = `/loans/${loan.pn}`;
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED" && !held.has(t.id));
  const name = (t: Txn) => txnName(t.type.code, t.type.name);
  const forChecklist = live.find((t) => t.status === "FOR_CHECKLIST");
  if (forChecklist) {
    const ticked = forChecklist.checks.filter((c) => c.checked).length;
    return {
      title: `Check the papers for ${name(forChecklist)}`,
      help: ticked ? "Keep going. Tick each paper you are holding; we save as you tick." : "Tick each paper you are holding. We save as you tick.",
      primary: { label: ticked ? "Continue checking" : "Start checking", href: `${base}?tab=todo&tx=${forChecklist.type.code}` },
      txnId: forChecklist.id,
    };
  }
  if (labelsPending > 0 && ["For checklist", "No DP assignment required", "Opened"].includes(loan.stage)) {
    return {
      title: `Print and attach the ${labelsPending} label${labelsPending === 1 ? "" : "s"}`,
      help: "Every paper in the package gets its own label. Stick each label on its paper so it can be scanned wherever it goes.",
      primary: { label: `Print ${labelsPending} label${labelsPending === 1 ? "" : "s"}`, href: `${base}/labels?ids=${loan.documents.filter((d) => d.documentId && d.stage === "AT_BRANCH" && !d.labelPrintedAt).map((d) => d.id).join(",")}`, print: true },
      secondary: { label: "Review documents first", href: `${base}?tab=documents` },
    };
  }
  const returned = live.find((t) => t.status === "RETURNED");
  if (returned) {
    return { title: `Fix and resend the ${name(returned)}`, help: "The processor sent it back. Check what they asked for, then send it again.", primary: { label: "Open it", href: `${base}?tab=todo&tx=${returned.type.code}` }, txnId: returned.id };
  }
  const edst = live.find((t) => t.type.code === "EDST" && t.status === "READY");
  const send = live.find((t) => t.type.requiresDp && t.status === "READY");
  if (send) {
    return { title: `Send ${name(send)} to a Document Processor`, help: "Pick who should do it. They are told right away by notification and email.", primary: { label: "Choose a processor", href: `${base}?tab=todo&tx=${send.type.code}` }, txnId: send.id };
  }
  if (edst) {
    return { title: "Enter it in EDST and record the reference", help: "You do this one. No processor needed.", primary: { label: "Record EDST", href: `${base}?tab=todo&tx=${edst.type.code}` }, txnId: edst.id };
  }
  const forwarded = live.find((t) => t.status === "FORWARDED");
  if (forwarded) {
    const a = forwarded.dpAssignments[0];
    return { title: "Check the returned package", help: `${a?.dpUser.name ?? "The processor"} sent the ${name(forwarded)} package back to ${a?.receivingLa?.name ?? "the branch"}. When it arrives, check each paper. (The receiving screen comes in a later release.)` };
  }
  if (loan.stage === "For Vault Transmittal") return { title: "Send the papers to the vault", help: "Everything is done. The papers are ready to go to the vault. (The transmittal screen comes in a later release.)" };
  const waiting = live.find((t) => t.status === "ASSIGNED" || t.status === "IN_PROCESS");
  if (waiting) {
    const a = waiting.dpAssignments[0];
    return { title: `Nothing for you right now`, help: `${a?.dpUser.name ?? "The processor"} has the ${name(waiting)}. We will tell you when it comes back.` };
  }
  return { title: "Nothing for you right now", help: `This loan is ${stageWords(loan.stage).toLowerCase()}.` };
}

async function TodoTab({ loan, ctx, user, labelsPending, step, related }: { loan: LoanDetail; ctx: Ctx; user: CurrentUser; labelsPending: number; step: number; related: React.ReactNode }) {
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  const ns = nextStep(loan, labelsPending);
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const opens = openItemsFor(loan, ctx.holidays);
  const problems = loan.exceptions.filter((e) => e.status === "OPEN");
  const base = `/loans/${loan.pn}`;
  const now = new Date();
  const held = await Promise.all(live.flatMap((t) => {
    const h = openHold(t.holds);
    return h ? [{ t, h }] : [];
  }).map(async (x) => ({ ...x, transfer: await transferFor(user, loan, x.h.id) })));
  const missingTxns = live
    .filter((t) => ["FOR_CHECKLIST", "READY", "RETURNED"].includes(t.status) && t.checks.some((c) => !c.checked))
    .filter((t) => !loan.exceptions.some((e) => e.transactionId === t.id && e.type === "LEGAL_DOCS_COMPLETION" && e.status === "OPEN"))
    .map((t) => ({ id: t.id, name: txnName(t.type.code, t.type.name), href: `${base}?tab=todo&tx=${t.type.code}&ask=missing` }));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_352px] xl:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {problems.length > 0 && (
          <section aria-labelledby="problems" className="rounded-[14px] border border-bad-line bg-bad-bg p-4 sm:p-5">
            <h2 id="problems" className="text-lg font-bold text-bad-fg">{problems.length === 1 ? "There is a problem to fix" : `There are ${problems.length} problems to fix`}</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {problems.map((e) => (
                <li key={e.id} className="rounded-xl bg-white p-4">
                  <p className="text-[15px] font-semibold">{problemTitle(e.type)}{e.transaction ? ` · ${txnName(e.transaction.type.code, e.transaction.type.name)}` : ""}</p>
                  <p className="mt-1 text-[15px] text-ink">{plainMessage(e.reason)}</p>
                  {Array.isArray((e.details as { changes?: unknown[] } | null)?.changes) && (
                    <ul className="mt-1 text-sm text-ink-2">
                      {(e.details as { changes: { field: string; before: unknown; after: unknown }[] }).changes.map((c) => (
                        <li key={c.field}>{c.field}: {String(c.before ?? "blank")} → {String(c.after ?? "blank")}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-sm text-ink-2">Reported by {e.raisedByLabel}, {timeAgo(e.raisedAt).toLowerCase()}</p>
                  {la && e.type !== "LEGAL_DOCS_COMPLETION" && <div className="mt-3"><FixProblem exceptionId={e.id} /></div>}
                  {e.type === "LEGAL_DOCS_COMPLETION" && <p className="mt-2 text-sm text-ink-2">This closes by itself when you tick the missing paper.</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {held.length > 0 && (
          <section aria-labelledby="holds-h" className="flex flex-col gap-2" data-holds-banner>
            <h2 id="holds-h" className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-base font-bold text-ink">
              <span className="inline-flex items-center gap-1.5"><span className="text-hold-fg"><PauseIcon size={16} strokeWidth={2.4} /></span>On hold{held.length > 1 ? ` (${held.length})` : ""}</span>
              <span className="text-[13px] font-normal text-ink-2" data-clock-note>{CLOCK_NOTE}</span>
            </h2>
            {held.map(({ t, h, transfer }) => (
              <HoldSummary key={h.id} id={`open-${h.id}`} hold={holdBrief(h)} now={now.toISOString()} txnName={txnName(t.type.code, t.type.name)}
                canResume={mayResume(user, loan, t)} canAddDetails={mayAddDetails(h, user)} transfer={transfer}
                resumeClass={ns.waiting && held.length === 1 ? "btn-gold btn-sm" : "btn-ghost btn-sm"} />
            ))}
          </section>
        )}

        <section aria-labelledby="next" className={`card flex flex-col gap-3 p-5 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:gap-5 ${ns.waiting ? "" : "border-line-soft"}`} data-next-step={ns.waiting ? "waiting" : "go"}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <p className="chip c-act">Next step</p>
              {step <= JOURNEY_STEP_COUNT && <span className="text-[13px] text-ink-2">Step {step} of {JOURNEY_STEP_COUNT}</span>}
            </div>
            <h2 id="next" className="mt-1.5 text-xl font-bold leading-snug text-navy">{ns.title}</h2>
            <p className="mt-0.5 text-[15px] text-ink-2">{ns.help}</p>
          </div>
          {la && (ns.primary || ns.secondary) && (
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              {ns.primary && (
                <Link href={ns.primary.href} className="btn-gold h-12 w-full sm:h-11 sm:w-auto">
                  {ns.primary.print && <PrinterIcon size={18} />} {ns.primary.label}
                </Link>
              )}
              {ns.secondary && <Link href={ns.secondary.href} className={ns.waiting ? "btn-ghost btn-sm" : "link inline-flex min-h-11 items-center text-sm"}>{ns.secondary.label}</Link>}
            </div>
          )}
        </section>

        {/* Every transaction in its fixed order; the Next step one is tagged (its text is in the card above). */}
        {live.length > 1 && (
          <section aria-labelledby="all-txns-todo" className="card px-4 pb-1 pt-3 sm:px-5" data-all-txns>
            <h2 id="all-txns-todo" className="mb-1 text-base font-bold text-navy">All transactions ({live.length})</h2>
            <ul>
              {live.map((t, i) => {
                const s = statusOf(loan, t, ctx, opens);
                const next = t.id === ns.txnId;
                return (
                  <li key={t.id} className="border-t border-[rgb(12_35_64/0.1)]" data-txn-row={t.type.code} data-next={next ? "true" : undefined}>
                    <Link href={`${base}?tab=todo&tx=${t.type.code}`}
                      className={`-mx-2 flex min-h-14 items-start gap-3 rounded-lg px-2 py-2 text-inherit no-underline ${next ? "bg-gold-soft shadow-[inset_3px_0_0_var(--gold)]" : "hover:bg-fill"}`}>
                      <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.status === "COMPLETED" ? "bg-ok-bg text-ok-fg" : next ? "bg-gold text-navy" : "bg-fill-strong text-navy"}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold">{txnName(t.type.code, t.type.name)}</span>
                          {next && <span className="chip c-act h-5 px-2 text-[11px]" data-next-tag>Next step</span>}
                        </span>
                        <span className="mt-1 block"><TxnStatusChips s={s} /></span>
                        {!next && <span className="mt-0.5 block text-[13px] text-ink-2" data-status-line>{s.line}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <AtAGlance loan={loan} ctx={ctx} user={user} />
        {related}
        {la && (
          <section aria-label="Something wrong?" className="flex min-h-12 items-center gap-2.5 rounded-[14px] border border-line px-4 py-1.5">
            <span className="text-ink-2"><AlertIcon size={18} /></span>
            <span className="flex-1 text-[15px] text-ink">Something wrong?</span>
            <ReportProblem loanId={loan.id} missingTxns={missingTxns} compact />
          </section>
        )}
      </aside>
    </div>
  );
}

function problemTitle(type: string) {
  switch (type) {
    case "SOURCE_CHANGE": return "MyLoans changed the loan details";
    case "LEGAL_DOCS_COMPLETION": return "Missing paper";
    case "MISSING_PAPER": return "Missing paper";
    case "WRONG_DETAILS": return "Wrong details";
    case "NO_FUNDS": return "Finance said no to the money request";
    case "DP_DECLINED": return "The processor sent it back";
    case "INCOMPLETE_PACKAGE": return "The returned package is incomplete";
    default: return "Problem";
  }
}

function AtAGlance({ loan, ctx, user }: { loan: LoanDetail; ctx: Ctx; user: CurrentUser }) {
  const type = loan.classification === "FINANCING" ? `Financing · ${loan.financingType === "UNDERTAKING" ? "Undertaking" : "Non-Undertaking"}` : "Refinancing";
  const orcr = loan.orcrStatus ? (loan.orcrStatus === "TRANSFERRED" ? "Transferred" : "Untransferred") : "Not asked";
  const mortgage = loan.mortgageResult === "MORTGAGE" ? "Yes" : loan.mortgageResult === "NOT_MORTGAGE" ? "No" : "Not checked";
  const today = businessDate(new Date());
  const deadline = ctx.deadline === today ? `Today, ${dayText(ctx.deadline, { year: false })}` : `${dayText(ctx.deadline, { year: false })}${ctx.pastDay2 ? " (passed)" : ""}`;
  const facts: [string, string][] = [["Type", type], ["Mortgage needed", mortgage], ["OR/CR", orcr], ["Send by", deadline]];
  const snap = loan.snapshots[0];
  const more: [string, string][] = [
    ["CIN", loan.cin ?? "-"], ["CIF", loan.cif ?? "-"], ["Source loan ID", loan.sourceLoanId ?? "-"], ["Product name", loan.productName || "(blank)"],
    ["Loan type", loan.loanType], ["Released on", dayText(loan.releasedAt)], ["Source status", loan.sourceStatus],
    ["Retrieved at", fmtDateTime(loan.retrievedAt)], ["Opened at", `${fmtDateTime(loan.openedAt)} by ${loan.openedBy.name}`],
  ];
  return (
    <section aria-labelledby="glance" className="card flex flex-col gap-3 p-4 sm:p-5">
      <h2 id="glance" className="text-[17px] font-bold text-navy">Loan at a glance</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[13px] text-ink-2">{k}</dt>
            <dd className="mt-0.5 text-[15px] font-bold leading-snug text-navy">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="group border-t border-line pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-navy">
          <ChevronRightIcon size={18} className="transition-transform group-open:rotate-90" /> More loan details
        </summary>
        <dl className="mt-2 flex flex-col gap-2 text-sm">
          {more.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line/60 pb-1.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
          <div className="pt-1">
            <dt className="text-ink-2">Rule that fired</dt>
            <dd className="mt-0.5">{loan.ruleFired}</dd>
          </div>
          <div className="pt-1 text-xs text-ink-2">MyLoans copy saved {fmtDateTime(snap?.retrievedAt)} ({snap?.adapter ?? "-"}).</div>
        </dl>
      </details>
      {can(user, PERMISSIONS.RULES_OVERRIDE) && (
        <OverrideForm loanId={loan.id} current={{ classification: loan.classification, financingType: loan.financingType, orcrStatus: loan.orcrStatus, mortgage: loan.mortgageResult }} />
      )}
    </section>
  );
}

// ===========================================================================
// Check documents and send (work view)
// ===========================================================================

async function sendOptions(loan: LoanDetail, ctx: Ctx, t: Txn): Promise<SendOptions> {
  const [branches, dps, ltoOffices, openCounts, ltoWarnings] = await Promise.all([
    prisma.branch.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    processors(),
    prisma.ltoOffice.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    // Open jobs = assigned + in process + on hold (the same count as the Monitoring page).
    openJobCounts(),
    advisoryWarnings(),
  ]);
  const labelDocs = loan.documents.filter((d) => d.transactionId === t.id && d.documentId);
  const lastLto = loan.transactions.flatMap((x) => x.dpAssignments).filter((a) => a.ltoOfficeId).sort((a, b) => b.endorsedAt.getTime() - a.endorsedAt.getTime())[0]?.ltoOfficeId ?? null;
  // Sent back (declined or returned): a new round. The processor is chosen again: nothing pre-selected.
  const previous = undefined as { dpBranchId: string; dpUserId: string } | undefined;
  const recommended: Record<string, string | null> = {};
  for (const b of branches) recommended[b.id] = (await recommendDp(b.id))?.id ?? null;
  return {
    loanId: loan.id,
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    dps: dps.map((d) => {
      const open = openCounts.get(d.id) ?? 0;
      const a = availability(d.capacity, open, d.onLeave);
      return { id: d.id, name: d.name, branchIds: d.branchIds, open, capacity: a.capacity, availPct: a.pct, availStatus: a.status, leave: d.onLeave ? leaveText(d.leaveUntil, fmtDate) : null };
    }),
    ltoWarnings,
    recommended,
    ltoOffices: ltoOffices.map((l) => ({ id: l.id, name: l.name })),
    defaultBranchId: previous?.dpBranchId ?? loan.branchId,
    previousDpId: previous?.dpUserId ?? null,
    resend: t.status === "RETURNED",
    needsLto: t.type.needsLto,
    // The office last used on this loan (for any transaction), else the branch's usual one.
    defaultLtoOfficeId: lastLto ?? loan.branch.usualLtoOfficeId ?? null,
    pastDay2: ctx.pastDay2,
    deadlineText: dayText(ctx.deadline),
    fundsNeeded: t.fundsNeeded,
    fundsKinds: t.fundsKinds,
    suggestedKinds: [...new Set(t.type.caRules.map((r) => r.kind))],
    labelsHref: labelDocs.length ? `/loans/${loan.pn}/labels?ids=${labelDocs.map((d) => d.id).join(",")}` : null,
    labelsPrinted: labelDocs.length > 0 && labelDocs.every((d) => d.labelPrintedAt),
    next: nextAfter(loan, t),
    sourceBlock: await sendBlockReason(prisma, loan.id, t.type.code),
    // Returned with papers handed over: the LA confirms them back first.
    papersBlock: t.status === "RETURNED" && loan.documents.some((d) => d.transactionId === t.id && d.stage === "IN_TRANSIT") ? PAPERS_BACK_FIRST : null,
  };
}

/** After sending, the next transaction (in order, after this one) that still needs the LA. */
function nextAfter(loan: LoanDetail, t: Txn): { href: string; name: string } | null {
  const live = loan.transactions.filter((x) => x.status !== "CANCELLED");
  const i = live.findIndex((x) => x.id === t.id);
  const n = [...live.slice(i + 1), ...live.slice(0, i)].find((x) => PRE_SEND.includes(x.status));
  return n ? { href: `/loans/${loan.pn}?tab=todo&tx=${n.type.code}`, name: txnName(n.type.code, n.type.name) } : null;
}

async function WorkView({ loan, ctx, user, selected, review }: { loan: LoanDetail; ctx: Ctx; user: CurrentUser; selected: Txn; review: ReviewData | null }) {
  const la = can(user, PERMISSIONS.CHECKLIST_TICK);
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const opens = openItemsFor(loan, ctx.holidays);
  const mine = opens.filter((i) => i.txnId === selected.id);
  const missingItem = mine.find((i) => i.kind === "missing");
  const requested = new Set(missingItem?.lineIds ?? []);
  const requestedInfo = missingItem ? askedText(missingItem) : undefined;
  const lines: Line[] = selected.checks
    .filter((c) => !c.rule || c.rule.active || c.checked)
    .map((c) => ({
      id: c.id,
      label: c.rule?.label ?? c.otherLabel ?? "Other paper",
      kind: c.rule ? c.rule.kind : "OTHER",
      group: c.rule?.oneOfGroup ?? null,
      originality: c.rule?.originality ?? "ORIGINAL",
      checked: c.checked,
      documentId: c.documentItem?.documentId ?? null,
      required: c.required,
      active: c.rule ? c.rule.active : true,
      requested: requested.has(c.id),
      requestedInfo: requested.has(c.id) ? requestedInfo : undefined,
    }));
  const a = selected.dpAssignments.find((x) => liveAssignment(x.status));
  // Declined or returned by the DP: the findings card at the top says it (no second line here).
  const sb = sentBack(selected.status, selected.dpAssignments);
  // Returned with papers handed over by the processor: the LA confirms them before sending again.
  const papersBack = selected.status === "RETURNED" ? loan.documents.filter((d) => d.transactionId === selected.id && d.stage === "IN_TRANSIT") : [];
  const handedAt = selected.dpAssignments.find((x) => x.papersHandedAt)?.papersHandedAt ?? null;
  const assignmentText = sb ? null :
    selected.status === "ASSIGNED" && a ? `Sent to ${a.dpUser.name} on ${dayText(a.endorsedAt)}. Waiting for them to accept.`
    : selected.status === "IN_PROCESS" && a ? `${a.dpUser.name} is working on it.`
    : selected.status === "FORWARDED" && a ? `${a.dpUser.name} sent the package back to ${a.receivingLa?.name ?? "the branch"}.`
    : selected.status === "COMPLETED" && selected.type.requiresDp ? "Done. The package came back complete." : null;
  const send = can(user, PERMISSIONS.DP_SEND) && selected.type.requiresDp ? await sendOptions(loan, ctx, selected) : null;
  // The Processor job card appears only once the transaction was sent.
  const sent = selected.type.requiresDp && !PRE_SEND.includes(selected.status) && selected.status !== "CANCELLED";
  const jobCard = sent;
  const rows = [...(review ? [sourceRow(review)] : []), ...backRows(loan, user), ...openRows(loan, opens, user)];
  // The hold is explained by the summary at the top, so the header carries no second On hold pill.
  const titleChips = mine.filter((i) => i.kind !== "hold").map((i) => ({ id: i.id, ...titleChipOf(i) }));
  const hold = openHold(selected.holds);
  // On hold: the transaction is locked (readable, controls disabled) until the holder resumes it.
  const locked = hold ? lockedMessage(hold.raisedByLabel, hold.raisedAt, hold.ownerLabel) : null;
  const round = la || user.roleKey === "ADMIN" ? roundChip(selected.dpAssignments) : null;
  // The missing-paper pop-up may also put it on hold (waiting on borrower) for the person who does the work.
  const canHold = ownsTxn(user, loan, selected) && can(user, PERMISSIONS.HOLDS_RAISE) && !openHold(selected.holds);
  const openMissing = loan.exceptions.some((e) => e.transactionId === selected.id && e.type === "LEGAL_DOCS_COMPLETION" && e.status === "OPEN");

  const selectedIndex = live.findIndex((t) => t.id === selected.id) + 1;
  const items = txnItems(loan, ctx, opens);
  const sums = live.map((t) => checklistStatusOf(t.checks));
  const summary = { done: sums.reduce((x, c) => x + c.requiredDone, 0), total: sums.reduce((x, c) => x + c.requiredTotal, 0) };

  // "Add a transaction": active custom types (never created by the automation), not already on this loan file.
  const canAdd = can(user, PERMISSIONS.TXN_ADD) && !["For Vault Transmittal", "In transit to Vault", "In Safekeeping", "Closed", "Archived", "Disposed"].includes(loan.stage);
  const addable = canAdd
    ? (await prisma.transactionType.findMany({
        where: { builtIn: false, active: true },
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { rules: { where: { active: true } } } } },
      })).map((t) => ({ id: t.id, name: t.name, papers: t._count.rules, requiresDp: t.requiresDp, added: live.some((x) => x.typeId === t.id) }))
    : [];
  // A custom transaction done by the LA (no processor) is finished with "Mark as done".
  const laCustom = can(user, PERMISSIONS.TXN_COMPLETE) && !selected.type.builtIn && !selected.type.requiresDp && ["FOR_CHECKLIST", "READY", "RETURNED"].includes(selected.status);

  return (
    <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_310px] min-[1100px]:items-start">
      <StoredToast key={`toast-${selected.id}`} />
      <LiveToast />
      <LiveAnnouncer />
      <FocusFromUrl />
      <div className="flex min-w-0 flex-col gap-3 min-[1100px]:hidden">
        <OpenItemsCard rows={rows} selected={selected.type.code} collapsible />
        <TxnStrip items={items} selected={selected.type.code} summary={summary} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
      <SelectionFocus key={`focus-${selected.id}`} headingId={`w-${selected.id}`} />
      {hold && (
        <HoldSummary id={`open-${hold.id}`} hold={holdBrief(hold)} now={new Date().toISOString()} canResume={mayResume(user, loan, selected)}
          canAddDetails={mayAddDetails(hold, user)} transfer={await transferFor(user, loan, hold.id)} clockNote />
      )}
      {sb && <SentBackCard sb={sb} forSender={sentBackIsFor(sb, { id: user.id, isBranchLa: la && inScope(user, loan.branchId) })} />}
      <LockedArea locked={locked} id={`lock-${selected.id}`}>
      <div className="flex min-w-0 flex-col gap-4">
      {la && papersBack.length > 0 && (
        <PapersBackCard transactionId={selected.id} dpName={sb?.dpName ?? "The processor"} handedAt={fmtDateTime(handedAt ?? new Date())}
          papers={papersBack.map((d) => ({ id: d.id, label: d.label, code: d.documentId }))} />
      )}
      <WorkCard
        // Keyed on the transaction only: saving the last tick (For checklist → Ready) must not wipe the funds or processor choice.
        key={`work-${selected.id}`}
        txnId={selected.id}
        index={selectedIndex}
        total={live.length}
        code={selected.type.code}
        name={txnName(selected.type.code, selected.type.name)}
        borrower={loan.borrowerName}
        status={selected.status}
        requiresDp={selected.type.requiresDp}
        lines={lines}
        editable={la && (["FOR_CHECKLIST", "READY", "RETURNED"].includes(selected.status) || (selected.status === "ASSIGNED" && a?.status === "PENDING_ACCEPTANCE" && can(user, PERMISSIONS.DP_SEND)))}
        canAct={la}
        openMissingRequest={openMissing}
        titleChips={titleChips}
        canHold={canHold}
        round={round}
        assignmentText={jobCard ? null : assignmentText}
        edstReference={selected.edstReference}
        send={send}
      />
      {jobCard && <TxnJobPanel loan={loan} txn={selected} user={user} tats={ctx.tats} holidays={ctx.holidays} statusText={assignmentText} />}
      {!jobCard && <LaHoldStrip txn={selected} user={user} />}
      {laCustom && <MarkDone transactionId={selected.id} name={selected.type.name} ready={checklistStatusOf(selected.checks).complete} />}
      </div>
      </LockedArea>
      {addable.length > 0 && <AddTransaction loanId={loan.id} types={addable} />}
      {/* Phone: room for the pinned Send bar, so everything below the panel can scroll above it. */}
      {send && la && PRE_SEND.includes(selected.status) && <div aria-hidden="true" className="h-36 sm:hidden" />}
      </div>
      <aside aria-label="Transactions on this loan file" className="sticky top-[88px] hidden max-h-[calc(100dvh-104px)] flex-col gap-3 overflow-y-auto min-[1100px]:flex">
        <OpenItemsCard rows={rows} selected={selected.type.code} />
        <TxnSideList items={items} selected={selected.type.code} summary={summary} />
      </aside>
    </div>
  );
}

/**
 * "Put on hold" for work in the LA's hands (papers, Ready to send, EDST, custom LA work). An open
 * hold shows as the banner at the top instead. Once sent, the job card has the button.
 */
async function LaHoldStrip({ txn, user }: { txn: Txn; user: CurrentUser }) {
  if (["COMPLETED", "CANCELLED"].includes(txn.status) || openHold(txn.holds)) return null;
  const laOwns = can(user, PERMISSIONS.CHECKLIST_TICK) && (txn.type.ownerRole === "LA" || [...PRE_SEND, "FORWARDED"].includes(txn.status));
  if (!laOwns || !can(user, PERMISSIONS.HOLDS_RAISE)) return null;
  const reasons = await prisma.holdReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } });
  if (!reasons.length) return null;
  return (
    <section aria-label="Waiting on something?" className="flex min-h-12 flex-wrap items-center gap-2.5 rounded-[14px] border border-line px-4 py-1.5">
      <span className="flex-1 text-[15px] text-ink">Waiting on the borrower or someone else?</span>
      <PutOnHoldForm transactionId={txn.id} reasons={reasons} />
    </section>
  );
}

// ===========================================================================
// Documents
// ===========================================================================

function DocumentsTab({ loan, la }: { loan: LoanDetail; la: boolean }) {
  const labelled = loan.documents.filter((d) => d.documentId);
  const live = loan.transactions.filter((t) => t.status !== "CANCELLED");
  const base = `/loans/${loan.pn}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[15px] text-ink-2">{labelled.length} of {loan.documents.length} papers are in your hands and have a label code.</p>
        {la && labelled.length > 0 && (
          <Link href={`${base}/labels`} className="btn-gold w-full sm:w-auto"><PrinterIcon size={20} /> Print all labels</Link>
        )}
      </div>
      {live.map((t) => {
        const docs = loan.documents.filter((d) => d.transactionId === t.id);
        if (docs.length === 0) return null;
        return (
          <section key={t.id} aria-labelledby={`d-${t.id}`} className="card overflow-hidden">
            <h2 id={`d-${t.id}`} className="border-b border-line px-5 py-3.5 text-lg font-bold text-navy">{txnName(t.type.code, t.type.name)}</h2>
            <ul>
              {docs.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {d.label} <span className="tag">{d.originality === "ORIGINAL" ? "Original" : "Copy"}</span>
                    </p>
                    {d.documentId && <p className="mono text-xs text-ink-2">{d.documentId}</p>}
                  </div>
                  <div className="text-sm sm:w-64">
                    {d.stage === "EXPECTED" ? (
                      <span className="text-ink-2">Not with you yet</span>
                    ) : (
                      <>
                        <span className="block font-medium text-ink">{d.stage === "AT_BRANCH" ? `At the ${d.location || "branch"}` : d.location || DOC_STAGE_LABEL[d.stage] || d.stage}</span>
                        <span className="block text-ink-2">{d.custodianLabel}, since {timeAgo(d.since).toLowerCase()}</span>
                      </>
                    )}
                  </div>
                  <div className="sm:w-36 sm:text-right">
                    {d.documentId && la ? (
                      <Link href={`${base}/labels?ids=${d.id}`} className="btn-ghost btn-sm w-full sm:w-auto">Print label</Link>
                    ) : d.documentId ? (
                      <span className="text-xs text-ink-2">{d.labelPrintedAt ? "Label printed" : "Label not printed"}</span>
                    ) : null}
                    {d.labelPrintedAt && la && <span className="mt-1 block text-xs text-ok-fg">Printed {timeAgo(d.labelPrintedAt).toLowerCase()}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const PRE_SEND = ["FOR_CHECKLIST", "READY", "RETURNED"];
/** Needs the LA: papers to tick, a send, a resend, or a package to receive. */
const needsAction = (t: { status: string }) => PRE_SEND.includes(t.status) || t.status === "FORWARDED";

/** One entry per live transaction for the side list (desktop) and the strip (tablet and phone). */
function txnItems(loan: LoanDetail, ctx: Ctx, opens: OpenItem[]): TxnItem[] {
  const base = `/loans/${loan.pn}`;
  return loan.transactions.filter((t) => t.status !== "CANCELLED").map((t, i) => ({
    code: t.type.code, n: i + 1, name: txnName(t.type.code, t.type.name),
    status: statusOf(loan, t, ctx, opens),
    dot: opens.some((o) => o.txnId === t.id && o.kind !== "hold") ? "bad" : opens.some((o) => o.txnId === t.id) ? "hold" : null,
    href: `${base}?tab=todo&tx=${t.type.code}`,
    done: t.status === "COMPLETED",
  }));
}

/** The one status wording of a transaction (Loan File list, Check documents list and strip). */
function statusOf(loan: LoanDetail, t: Txn, ctx: Ctx, opens: OpenItem[]): TxnStatus {
  const back = t.dpAssignments[0];
  const c = checklistStatusOf(t.checks);
  const p = openProblem(t.problems);
  const h = openHold(t.holds);
  return txnStatus({
    code: t.type.code, requiresDp: t.type.requiresDp, status: t.status,
    requiredDone: c.requiredDone, requiredTotal: c.requiredTotal, tickedAny: t.checks.some((x) => x.checked),
    edstReference: t.edstReference,
    returnedForPapers: t.status === "RETURNED" && !!back?.returnReasonId ? (back.returnReason?.name ?? "Papers needed") : null,
    sentBack: sentBack(t.status, t.dpAssignments)?.kind ?? null,
    tat: txnTat(t, ctx.tats, ctx.holidays),
    problem: p ? { reason: p.reason.name, days: Math.max(1, problemDays([p], ctx.holidays)) } : null,
    hold: h ? { reason: holdReasonName(h), days: Math.max(1, holdDays([h], ctx.holidays)) } : null,
    missingPapers: opens.filter((o) => o.txnId === t.id && o.kind === "missing").reduce((x, o) => x + Math.max(1, o.papers.length), 0),
  });
}


/** Open problems, holds and missing-paper requests of every live transaction (from the stored records). */
function openItemsFor(loan: LoanDetail, holidays: ReadonlySet<string>): OpenItem[] {
  return openItemsOf(loan.transactions.filter((t) => t.status !== "CANCELLED").map((t) => {
    const ex = loan.exceptions.find((e) => e.transactionId === t.id && e.type === "LEGAL_DOCS_COMPLETION" && e.status === "OPEN");
    const d = (ex?.details ?? null) as { missing?: unknown; askedFrom?: string | null } | null;
    const ids = ex ? requestedCheckIds(ex.details) : null;
    const rows = ids
      ? t.checks.filter((c) => ids.includes(c.id) && !c.checked).map((c) => ({ id: c.id, label: c.rule?.label ?? c.otherLabel ?? "Other paper" }))
      : null;
    return {
      id: t.id, code: t.type.code, name: txnName(t.type.code, t.type.name), problems: t.problems, holds: t.holds,
      request: ex ? {
        id: ex.id, raisedAt: ex.raisedAt, raisedByLabel: (d as { askedBy?: string } | null)?.askedBy === "DP" ? `${ex.raisedByLabel} (DP)` : ex.raisedByLabel, rows,
        askedFrom: d?.askedFrom && d.askedFrom in ASKED_FROM ? ASKED_FROM[d.askedFrom as AskedFrom] : null,
        papers: Array.isArray(d?.missing) ? d!.missing.map(String) : [],
      } : null,
      stillMissing: checklistStatusOf(t.checks).missing,
    };
  }), holidays);
}

/** "Asked by Ana Cruz · 2 minutes ago · from Borrower". */
function askedText(i: OpenItem, now: Date = new Date()): string {
  return `Asked by ${i.by} · ${timeAgo(i.since, now).toLowerCase()}${i.askedFrom ? ` · from ${i.askedFrom}` : ""}`;
}

/** The person who does the work on a transaction: the LA while it is in the LA's hands, the DP on an active job. */
function ownsTxn(user: CurrentUser, loan: LoanDetail, t: Txn): boolean {
  const laOwns = can(user, PERMISSIONS.CHECKLIST_TICK) && inScope(user, loan.branchId) && (t.type.ownerRole === "LA" || [...PRE_SEND, "FORWARDED"].includes(t.status));
  const a = t.dpAssignments.find((x) => ["PENDING_ACCEPTANCE", "ACCEPTED"].includes(x.status));
  const dpOwns = !!a && (a.dpUserId === user.id || a.secondaryDpUserId === user.id) && can(user, PERMISSIONS.JOBS_WORK);
  return laOwns || dpOwns;
}

/** May resume this transaction's hold: only the person who put it on hold (Admin included: no override). */
function mayResume(user: CurrentUser, _loan: LoanDetail, t: Txn): boolean {
  const h = openHold(t.holds);
  return !!h && mayResumeHold(h, user);
}

/** The hold, for the summary and the Resume form (serializable). */
function holdBrief(h: Txn["holds"][number]): HoldBrief {
  return { holdId: h.id, reason: holdReasonName(h), note: h.note, raisedBy: h.raisedByLabel, raisedAt: h.raisedAt.toISOString(), owner: h.ownerLabel ?? null };
}

/** "Transfer hold" for people with holds:transfer in scope (Admin: any), with who can receive it. */
async function transferFor(user: CurrentUser, loan: LoanDetail, holdId: string) {
  return mayTransferHold(user, loan.branchId) ? { candidates: await transferCandidates(user, holdId) } : null;
}

/**
 * "Sent back to you": transactions the DP declined or returned, for the Loan Associate who sent them
 * only (not another LA of the branch): findings, the DP and when.
 */
function backRows(loan: LoanDetail, user: CurrentUser): OpenRow[] {
  return loan.transactions.filter((t) => t.status !== "CANCELLED").flatMap((t) => {
    const sb = sentBack(t.status, t.dpAssignments);
    // The sender; or, when the sender is inactive, every active LA of the branch.
    if (!sb || !sentBackIsFor(sb, { id: user.id, isBranchLa: can(user, PERMISSIONS.CHECKLIST_TICK) && inScope(user, loan.branchId) })) return [];
    const note = inactiveSenderNote(sb);
    return [{
      id: `back-${t.id}`, kind: "returned" as const, badge: sb.kind === "declined" ? "Declined by the DP" : "Returned by the DP", txnCode: t.type.code, txnName: txnName(t.type.code, t.type.name),
      reason: sb.findings || "No findings were written.", who: `${sb.dpName} (DP) · ${fmtDateTime(sb.at)} · Round ${sb.round}${note ? ` · ${note}` : ""}`, since: "",
      days: 0, href: `/loans/${loan.pn}?tab=todo&tx=${t.type.code}`, target: "", canResume: false, funds: txnFundsType(t),
    }];
  });
}

/** The MyLoans change under review, as an Open items row ("MyLoans changes" group). */
function sourceRow(r: ReviewData): OpenRow {
  return {
    id: r.id, kind: "source", txnCode: "", txnName: "MyLoans", days: 0, href: "", target: "", canResume: false, review: r,
    reason: r.category === "MATERIAL" ? `Changed: ${r.fields}` : r.category === "REPLACEMENT" ? "A replacement PN was given" : "Cancelled or not released in MyLoans",
    who: r.canReview ? "Review it" : "Waiting for Admin to review", since: "",
  };
}

/** "MyLoans · Last checked 2:10 PM" with Refresh, and the replacement links. */
function SourceStrip({ loan }: { loan: LoanDetail }) {
  const when = fmtShort(loan.lastCheckedAt ?? loan.retrievedAt);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]" data-source-strip>
      {loan.replacesPn && <Link href={`/loans/${loan.replacesPn}`} className="chip c-navy h-7 no-underline" data-replaces>Replaces {loan.replacesPn}</Link>}
      {loan.replacedByPn && <Link href={`/loans/${loan.replacedByPn}`} className="chip c-navy h-7 no-underline" data-replaced-by>Replaced by {loan.replacedByPn}</Link>}
      <span className="flex-1" />
      {loan.sourceCurrent
        ? <span className="text-ink-2" data-last-checked>MyLoans · Last checked {when}</span>
        : <span className="chip c-act h-auto min-h-7 whitespace-normal py-1" data-last-checked>Last checked {when}. MyLoans did not answer.</span>}
      <RefreshButton loanId={loan.id} />
    </div>
  );
}

/** Rows of the Open items card: words, since when, the one action, and where pressing it goes (?tx=). */
function openRows(loan: LoanDetail, opens: OpenItem[], user: CurrentUser): OpenRow[] {
  const now = new Date();
  return opens.map((i) => {
    const target = focusTargetOf(i);
    const t = loan.transactions.find((x) => x.id === i.txnId)!;
    const owns = ownsTxn(user, loan, t);
    const h = i.kind === "hold" ? t.holds.find((x) => x.id === i.id) : undefined;
    return {
      id: i.id, kind: i.kind, txnCode: i.txnCode, txnName: i.txnName, reason: i.reason, target, days: i.days, funds: txnFundsType(t),
      who: i.kind === "missing" ? askedText(i, now) : i.kind === "hold" ? `Put on hold by ${i.by}` : `Raised by ${i.by}`,
      since: i.kind === "missing" ? "" : `since ${i.days} day${i.days === 1 ? "" : "s"}`,
      href: `/loans/${loan.pn}?tab=todo&tx=${i.txnCode}&focus=${target}`,
      canResume: !!h && mayResumeHold(h, user),
      remarks: h ? firstLine(h.note) : undefined,
      hold: h ? holdBrief(h) : undefined,
      problem: i.kind === "problem" ? {
        raisedText: `Raised by ${i.by} on ${fmtShort(i.since)}`, note: i.note, outside: i.outsideControl,
        canResolve: (owns && can(user, PERMISSIONS.PROBLEMS_RESOLVE)) || can(user, PERMISSIONS.PROBLEMS_RESOLVE_ANY),
        canOutside: can(user, PERMISSIONS.PROBLEMS_OUTSIDE),
      } : undefined,
    };
  });
}
