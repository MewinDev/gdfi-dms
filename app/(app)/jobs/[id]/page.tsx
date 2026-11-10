import type { Metadata } from "next";
import { anyStepKeys } from "@/lib/funds/access";
import { activeAdvisories, advisoryWarnings } from "@/lib/services/lto-advisories";
import { ReportLtoProblemButton, ResolveAdvisoryButton } from "@/components/monitoring/advisory-forms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requirePageAny } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canSeeJob, LTO_BLOCK_MESSAGE, lineTotals, loadAssignment, ltoBlocked } from "@/lib/services/jobs";
import { heldFor } from "@/lib/services/pasuyo";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { businessDate, fmtShort } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import { flagKindChoices, kindNames, lineKindText } from "@/lib/services/expense-kinds";
import { doneTat, openHold, openProblem, txnFunds, txnTat } from "@/lib/jobs/view";
import { FundsTypePill } from "@/components/funds/funds-type-pill";
import { problemDays } from "@/lib/workflow/tat";
import { dayText, txnName } from "@/lib/ui/plain";
import { PageTop } from "@/components/loan/page-top";
import { Banner, PageHeader, ToneChip } from "@/components/ui/basics";
import { FundsChip, LabelsChip, TatChip } from "@/components/jobs/chips";
import { AttemptTimeline } from "@/components/jobs/timeline";
import {
  AttemptForm, CompleteForm, ForwardForm, FundsFlagForm, OutsideControlToggle, RaiseProblemForm, ResolveProblemForm, ReviewForm,
  PasuyoForm, PutOnHoldForm,
} from "@/components/jobs/forms";
import { HoldSummary } from "@/components/jobs/hold-summary";
import { lockedMessage, mayAddDetails, mayResumeHold, holdReasonName } from "@/lib/ui/holds";
import { LockedArea } from "@/components/ui/locked-area";
import { mayTransferHold, transferCandidates } from "@/lib/services/holds";
import { sentBackKind } from "@/lib/ui/rounds";
import { ReturnToLaForm } from "@/components/jobs/return-to-la-form";
import { ChangeLtoOfficeForm } from "@/components/loan/sent-actions";
import { ltoEstimate } from "@/lib/ui/lto";
import { MapPinIcon, WarningIcon } from "@/components/ui/icons";
import { updatesBeforeAccept } from "@/lib/services/sent-changes";
import { LiveAnnouncer, LiveToast } from "@/components/ui/live-toast";
import { receiverWhere } from "@/lib/services/jobs";
import { stageRows, verifiablePapers } from "@/lib/services/job-stages";
import { currentIndex, stepStates, type StepState } from "@/lib/stages/rules";
import { stepClock, tatChip } from "@/lib/workflow/tat";
import {
  CompleteJobButton, FinishStageButton, ForwardToBranchForm, PinnedAction, StartStageButton, VerifyPapers, type ForwardBranch, type StageView,
} from "@/components/jobs/stages";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAny([PERMISSIONS.JOBS_WORK, ...anyStepKeys("view"), PERMISSIONS.REPORTS_TAT]);
  const { id } = await params;
  const names = await kindNames();
  const a = await loadAssignment(prisma, id).catch(() => null);
  if (!a || !canSeeJob(user, a)) notFound();
  // Declined or returned to the LA: it went back to the LA who sent it. A processor never sees it again
  // (the loan's Journey stays where their role may open the loan file).
  if (sentBackKind(a) && can(user, PERMISSIONS.JOBS_WORK)) {
    return (
      <div className="flex w-full flex-col gap-4" data-no-longer-yours>
        <LiveToast />
        <LiveAnnouncer />
        <PageHeader title="This job is no longer with you." help="It went back to the Loan Associate who sent it. Nothing here needs you." />
        <p><Link href="/jobs" className="btn-ghost">Go to my jobs</Link></p>
      </div>
    );
  }
  const [t, tats, holidays] = await Promise.all([
    prisma.loanTransaction.findUniqueOrThrow({
      where: { id: a.transactionId },
      include: {
        type: true,
        documents: { orderBy: { createdAt: "asc" } },
        advanceLines: { include: { advance: true } },
        attempts: { orderBy: { createdAt: "desc" }, include: { reason: true, dpUser: { select: { name: true } }, spends: true } },
        problems: { orderBy: { raisedAt: "desc" }, include: { reason: true } },
        holds: { orderBy: { raisedAt: "desc" }, include: { reason: true } },
      },
    }),
    getTatMap(),
    getHolidaySet(),
  ]);
  const now = new Date();
  const today = businessDate(now);
  // The processor it was sent to, or the second processor (Pasuyo) working it for them.
  const mine = (a.dpUserId === user.id || a.secondaryDpUserId === user.id) && can(user, PERMISSIONS.JOBS_WORK);
  const working = mine && a.status === "ACCEPTED" && t.status === "IN_PROCESS";
  const problem = openProblem(t.problems);
  const hold = openHold(t.holds);
  // Holds: the DP on their own open job (waiting for acceptance or in process). Admin resumes any.
  const jobOpen = a.status === "PENDING_ACCEPTANCE" || (a.status === "ACCEPTED" && t.status === "IN_PROCESS");
  const mayHold = mine && jobOpen && can(user, PERMISSIONS.HOLDS_RAISE);
  const mayResume = !!hold && mayResumeHold(hold, user); // only the person who put it on hold
  const holdReasons = mayHold && !hold ? await prisma.holdReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }) : [];
  const funds = txnFunds(t);
  const tat = a.status === "CLOSED" && a.decidedAt ? doneTat(t.type.code, a.decidedAt, a.forwardedAt ?? a.closedAt ?? now, tats, holidays) : txnTat(t, tats, holidays, now);
  const blocked = working && (await ltoBlocked(prisma, a)) ? LTO_BLOCK_MESSAGE : undefined;
  const reasons = await prisma.problemReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const lines = working
    ? await Promise.all(t.advanceLines.filter((l) => !l.denied && l.releasedCents > 0).map(async (l) => ({ lineId: l.id, label: `${l.advance.number} · ${lineKindText(names, l)}`, balanceCents: (await lineTotals(prisma, l.id)).balance })))
    : [];
  const las = working && a.processing
    ? await prisma.user.findMany({ where: receiverWhere(a.loan.branchId), orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const canPass = working && !a.processing && can(user, PERMISSIONS.JOBS_PASUYO);
  const [pasuyoEvents, passBranches, passProcessors, held] = await Promise.all([
    prisma.pasuyoEvent.findMany({ where: { assignmentId: a.id }, orderBy: { createdAt: "asc" } }),
    canPass ? prisma.branch.findMany({ where: { active: true, hidden: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    canPass
      ? prisma.user.findMany({
          where: { active: true, id: { notIn: [user.id, a.dpUserId, ...(a.secondaryDpUserId ? [a.secondaryDpUserId] : [])] }, role: { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } } },
          orderBy: { name: "asc" }, select: { id: true, name: true, allBranches: true, role: { select: { key: true } }, branches: { select: { branchId: true } } },
        })
      : [],
    canPass ? heldFor(prisma, a, user.id) : [],
  ]);
  const heldCents = held.reduce((x, h) => x + h.balance, 0);
  // Return to LA: papers needed (after accepting, before completing).
  const canReturn = working && !a.processing && can(user, PERMISSIONS.JOBS_RETURN_TO_LA);
  const [returnReasons, papers, returnHeld] = canReturn
    ? await Promise.all([
        prisma.returnReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }),
        prisma.checklistCheck.findMany({ where: { transactionId: t.id, OR: [{ rule: { active: true } }, { ruleId: null }, { checked: true }] }, include: { rule: true }, orderBy: { createdAt: "asc" } }),
        heldFor(prisma, a, user.id),
      ])
    : [[], [], []];
  const returnHeldCents = returnHeld.reduce((x, h) => x + h.balance, 0);
  // Where the processor takes it (types that need LTO processing, or an office given at Send).
  const atLto = t.type.needsLto || !!a.ltoOffice;
  const canChangeLto = atLto && working && !a.processing;
  const ltoOffices = canChangeLto ? (await prisma.ltoOffice.findMany({ where: { active: true }, orderBy: { name: "asc" } })).map((o) => ({ id: o.id, name: o.name, estimate: ltoEstimate(o) })) : [];
  // LTO advisories: a warning on the job that uses the office (never blocks anything), and the
  // processor's "Report an LTO problem" while the job is at an LTO stage.
  const ltoWarnings = atLto ? await advisoryWarnings(now) : {};
  const officeAdvisories = a.ltoOfficeId ? await activeAdvisories(user, [a.ltoOfficeId], now) : [];
  // What the LA changed since sending (shown to the processor until they accept).
  const updates = a.status === "PENDING_ACCEPTANCE" ? await updatesBeforeAccept(a) : null;
  const docs = t.documents.filter((d) => d.documentId);
  const labels = !!t.labelsPrintedAt || (docs.length > 0 && docs.every((d) => d.labelPrintedAt));
  const kinds = t.fundsKinds.map((k) => names.get(k) ?? k).join(", ");
  const pDays = problemDays(t.problems, holidays, now);
  const incomplete = t.status === "IN_PROCESS" ? await prisma.loanException.findFirst({ where: { transactionId: t.id, type: "INCOMPLETE_PACKAGE", status: "OPEN" }, orderBy: { raisedAt: "desc" } }) : null;

  // Processing stages (Settings > Processing stages): Done, Now, Later.
  const accepted = a.status === "ACCEPTED" || a.status === "CLOSED" || t.status === "FORWARDED" || t.status === "COMPLETED";
  const stages = accepted && t.type.requiresDp ? await stageRows(prisma, a) : [];
  const states = stepStates(stages);
  const ci = currentIndex(stages);
  const cur = working && ci >= 0 && !a.processing ? stages[ci] : null;
  const allDone = stages.length > 0 && ci < 0;
  const curView: StageView | null = cur ? { id: cur.id ?? cur.code, name: cur.name, kind: cur.kind, status: cur.status, fields: cur.fields, startedText: cur.startedAt ? fmtShort(cur.startedAt) : null } : null;
  const ticks = (cur?.kind === "VERIFY" ? (cur.evidence?.papers ?? {}) : {}) as Record<string, { at: string; by: string }>;
  const papersToVerify = cur?.kind === "VERIFY"
    ? verifiablePapers(t.documents).map((d) => ({ id: d.id, label: d.label, original: d.originality === "ORIGINAL", tickedText: ticks[d.id] ? `${fmtShort(new Date(ticks[d.id].at))} · ${ticks[d.id].by}` : null }))
    : [];
  const stageBlocked = cur?.kind === "LTO_DROP" && cur.status === "LATER" ? blocked : undefined;
  const canReportLto = working && !!a.ltoOffice && (cur?.kind === "LTO_DROP" || cur?.kind === "LTO_PICKUP") && (can(user, PERMISSIONS.LTO_REPORTS_CREATE) || can(user, PERMISSIONS.LTO_REPORTS_MANAGE));
  // Forward to branch: every active branch with a Loan Associate who may receive papers. Nothing pre-selected.
  const forwardBranches: ForwardBranch[] = working && a.processing
    ? await (async () => {
        const [branches, receivers] = await Promise.all([
          prisma.branch.findMany({ where: { active: true, hidden: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
          prisma.user.findMany({ where: { active: true, role: receiverWhere("").role }, orderBy: { name: "asc" }, select: { id: true, name: true, allBranches: true, branches: { select: { branchId: true } } } }),
        ]);
        // Any branch (forwarding is not limited by the DP's own access), then an LA who works there.
        return branches.map((b) => ({ ...b, las: receivers.filter((r) => r.allBranches || r.branches.some((x) => x.branchId === b.id)).map((r) => ({ id: r.id, name: r.name })) })).filter((b) => b.las.length > 0);
      })()
    : [];
  const withDpCount = t.documents.filter((d) => d.stage === "WITH_DP").length;
  // Phone: the main next action, pinned above the bottom navigation.
  const pinned: { label: string; target: string; href?: string } | null =
    a.status === "PENDING_ACCEPTANCE" && mine ? { label: "Review the papers", target: "review" }
    : !working ? null
    : a.processing ? { label: "Forward to branch", target: "forward-primary" }
    : allDone ? { label: "Complete job", target: "stage-primary" }
    : cur?.kind === "VERIFY" && cur.status === "STARTED" ? { label: "Check and verify", target: "verify-h" }
    : cur && cur.status === "STARTED" ? { label: `Finish ${cur.name}`, target: "stage-primary" }
    : cur && !stageBlocked ? { label: `Start ${cur.name}`, target: "stage-primary" }
    : stageBlocked ? { label: "Request a cash advance", target: "work", href: "/my-funds" }
    : { label: "Work on it", target: "work" };

  return (
    <div className="dense flex w-full flex-col gap-4 lg:-mx-2 lg:-mt-2">
      <PageTop
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Jobs", href: "/jobs" }, { label: a.loan.pn }]}
        back={{ label: "Jobs", href: "/jobs" }}
        title={txnName(t.type.code, t.type.name)}
        subtitle={`${a.loan.borrowerName} · ${a.loan.pn} · ${a.loan.branch.name}${a.ltoOffice ? ` · ${a.ltoOffice.name}` : ""}`}
        right={<span className="hidden md:block"><TatChip data={tat} /></span>}
      />

      <section aria-label="Status" className="flex flex-wrap items-center gap-2">
        <span className="md:hidden"><TatChip data={tat} /></span>
        <FundsChip status={funds} />
        {docs.length > 0 && <LabelsChip printed={labels} />}
        {a.secondaryDpUser && <ToneChip tone="wait">Pasuyo</ToneChip>}
        {t.attempts.length > 0 && <ToneChip tone="mute">{t.attempts.length} attempt{t.attempts.length === 1 ? "" : "s"}</ToneChip>}
        {pDays > 0 && <ToneChip tone={problem ? "bad" : "mute"}>Problem time {pDays} day{pDays === 1 ? "" : "s"}</ToneChip>}
        <Link href={`/loans/${a.loan.pn}`} className="link ml-auto inline-flex min-h-11 items-center text-sm">Open the loan file</Link>
      </section>

      {atLto && (
        <section aria-labelledby="lto-h" className="flex flex-col gap-1 rounded-xl border border-line-soft bg-select-bg p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-4" data-process-at>
          <div className="min-w-0 flex-1">
            <h2 id="lto-h" className="flex items-center gap-2 text-[17px] font-bold text-navy"><MapPinIcon size={18} /> Process at: {a.ltoOffice?.name ?? "no office chosen yet"}</h2>
            <p className="text-[13px] text-ink-2">{a.ltoOffice ? `${a.ltoOffice.city ? `${a.ltoOffice.city} · ` : ""}${ltoEstimate(a.ltoOffice) ?? "No estimate yet"}` : "Ask the Loan Associate which office."}</p>
          </div>
          {(canChangeLto || canReportLto) && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {canReportLto && <ReportLtoProblemButton assignmentId={a.id} officeName={a.ltoOffice!.name} />}
              {canChangeLto && <ChangeLtoOfficeForm mode="dp" id={a.id} offices={ltoOffices} currentId={a.ltoOfficeId} warnings={ltoWarnings} />}
            </div>
          )}
          {officeAdvisories.length > 0 && (
            <div className="basis-full sm:mt-1" data-job-advisories>
              {officeAdvisories.map((x) => (
                <div key={x.id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-act-line bg-act-bg px-3 py-2 text-[13px] text-act-fg" data-advisory-warning>
                  <WarningIcon size={16} /> <span className="min-w-0 flex-1">{x.warning}. {x.remarks}</span>
                  {x.prompt && <span className="font-semibold" data-stale-prompt>{x.prompt}</span>}
                  {x.mayResolve && <ResolveAdvisoryButton id={x.id} summary={x.warning} label={x.prompt ? "No longer active: resolve" : "Resolve"} />}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="-mt-2 text-[13px] text-ink-2">
        Sent to <strong className="text-ink">{a.dpUser.name}</strong>
        {a.secondaryDpUser && <>, with a second processor (Pasuyo) <strong className="text-ink">{a.secondaryDpUser.name}</strong></>}.
      </p>

      {incomplete && (
        <section aria-label="Package incomplete" className="flex flex-col gap-1 rounded-[14px] border-2 border-act-fg/50 bg-act-bg p-4 text-act-fg" data-package-incomplete>
          <h2 className="text-lg font-bold">Package incomplete: {(incomplete.details as { note?: string } | null)?.note || incomplete.reason}</h2>
          <p className="text-[15px]">{incomplete.raisedByLabel} on {dayText(incomplete.raisedAt)}. Correct it, then forward it again under Stages. The clock keeps counting.</p>
        </section>
      )}

      {problem && (
        <section aria-label="Problem" className="flex flex-col gap-2 rounded-[14px] border-2 border-bad-fg/60 bg-bad-bg p-4 text-bad-fg">
          <h2 className="text-lg font-bold">Problem: {problem.reason.name}{problem.outsideControl ? " · Outside our control" : ""}</h2>
          <p className="text-[15px]">Raised by {problem.raisedByLabel} on {dayText(problem.raisedAt)}{problem.note ? ` · ${problem.note}` : ""}. The turnaround time keeps counting.</p>
          <div className="flex flex-wrap gap-2">
            {(mine || can(user, PERMISSIONS.PROBLEMS_RESOLVE_ANY)) && <ResolveProblemForm problemId={problem.id} />}
            {can(user, PERMISSIONS.PROBLEMS_OUTSIDE) && <OutsideControlToggle problemId={problem.id} on={problem.outsideControl} />}
          </div>
        </section>
      )}

      <LiveToast />
      <LiveAnnouncer />
      {hold && (
        <HoldSummary hold={{ holdId: hold.id, reason: holdReasonName(hold), note: hold.note, raisedBy: hold.raisedByLabel, raisedAt: hold.raisedAt.toISOString(), owner: hold.ownerLabel ?? null }}
          now={now.toISOString()} canResume={mayResume} canAddDetails={mayAddDetails(hold, user)} clockNote
          transfer={mayTransferHold(user, a.loan.branchId) ? { candidates: await transferCandidates(user, hold.id) } : null} />
      )}

      {/* On hold: the job is locked (readable, every control disabled) until the holder resumes it. */}
      <LockedArea locked={hold ? lockedMessage(hold.raisedByLabel, hold.raisedAt, hold.ownerLabel) : null} id="lock-job">
      <div className="flex min-w-0 flex-col gap-4">

      {stages.length > 0 && (
        <section aria-labelledby="stages-h" className="card flex flex-col gap-3 p-4 sm:p-5" data-stages>
          <h2 id="stages-h" className="text-lg font-bold text-navy">Stages</h2>
          <ol className="flex flex-wrap gap-2" data-stage-stepper>
            {stages.map((r, i) => {
              const st: StepState = states[i];
              const chip = r.targetDays !== null && r.startedAt
                ? tatChip(stepClock({ targetDays: r.targetDays, start: r.startedAt, end: r.finishedAt ?? undefined }, holidays, now), today)
                : null;
              return (
                <li key={r.code} data-step={st} aria-current={st === "now" ? "step" : undefined}
                  className={`flex min-h-10 items-center gap-2 rounded-full border px-3 py-1 text-[14px] ${st === "done" ? "border-ok-fg/40 bg-ok-bg text-ok-fg" : st === "now" ? "border-navy bg-white font-semibold text-navy" : "border-line bg-fill text-ink-2"}`}>
                  <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${st === "done" ? "bg-ok-fg text-white" : st === "now" ? "bg-navy text-white" : "bg-white text-ink-2"}`}>{st === "done" ? "✓" : i + 1}</span>
                  {r.name}
                  <span className="sr-only">{st === "done" ? " (done)" : st === "now" ? " (now)" : " (later)"}</span>
                  {chip && <TatChip data={chip} />}
                </li>
              );
            })}
          </ol>
          {stages.some((r) => r.migrated) && <p className="text-[13px] text-ink-2">Recorded before stages existed: stages were marked done from the stored references.</p>}
          {curView && (
            <div className="flex flex-col gap-3 rounded-xl border border-line-soft bg-select-bg p-3" data-current-stage={curView.kind}>
              <h3 id={curView.kind === "VERIFY" ? "verify-h" : undefined} tabIndex={-1} className="text-[16px] font-bold text-navy">
                Now: {curView.name}{curView.status === "STARTED" && curView.startedText ? <span className="ml-2 text-[13px] font-normal text-ink-2">started {curView.startedText}</span> : null}
              </h3>
              {curView.status === "LATER" && <StartStageButton assignmentId={a.id} stage={curView} blocked={stageBlocked} />}
              {curView.status === "STARTED" && curView.kind !== "VERIFY" && <FinishStageButton assignmentId={a.id} stage={curView} today={today} office={a.ltoOffice?.name ?? null} />}
              {curView.status === "STARTED" && curView.kind === "VERIFY" && <VerifyPapers assignmentId={a.id} stage={curView} papers={papersToVerify} problemOpen={!!problem} />}
              <p className="text-[13px] text-ink-2">Attempts, holds and problems you record now belong to {curView.name}.</p>
            </div>
          )}
          {working && allDone && !a.processing && <CompleteJobButton assignmentId={a.id} />}
          {working && a.processing && (
            <div className="flex flex-col gap-2 rounded-xl border border-line-soft p-3">
              <h3 className="text-[16px] font-bold text-navy">Forward to branch</h3>
              <ForwardToBranchForm assignmentId={a.id} branches={forwardBranches} loanBranch={a.loan.branch.name} paperCount={withDpCount} />
            </div>
          )}
        </section>
      )}

      {a.status === "PENDING_ACCEPTANCE" && (
        <section aria-labelledby="review" className="card flex flex-col gap-3 p-4 sm:p-5">
          <h2 id="review" className="text-lg font-bold text-navy">Review the papers</h2>
          {updates && (
            <div className="flex flex-col gap-1 rounded-xl border border-line-soft bg-select-bg p-3" data-updated-by>
              <p className="text-[13px] font-semibold text-navy">Updated by {updates.by} · {fmtShort(updates.at)}</p>
              <ul className="list-disc pl-5 text-[13px] text-ink">{updates.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          <p className="text-[15px] text-ink-2">Sent by {a.assignedBy.name} on {dayText(a.endorsedAt)}. {t.fundsNeeded === "YES" ? `Needs funds: ${kinds}.` : t.fundsNeeded === "NO" ? "No funds needed." : ""}</p>
          {mine ? (
            <ReviewForm
              assignmentId={a.id} laName={a.assignedBy.name}
              returnReasons={can(user, PERMISSIONS.JOBS_RETURN_TO_LA) ? await prisma.returnReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }) : []}
              papers={(docs.length ? docs : t.documents).map((d) => ({ checkId: d.checkId, label: d.label, original: d.originality === "ORIGINAL", documentId: d.documentId, labelPrinted: !!d.labelPrintedAt }))}
            />
          ) : (
            <>
              <PaperList docs={docs.length ? docs : t.documents} />
              <p className="text-sm text-ink-2">Waiting for {a.dpUser.name} to accept.</p>
            </>
          )}
          {mayHold && !hold && holdReasons.length > 0 && <div><PutOnHoldForm transactionId={t.id} reasons={holdReasons} /></div>}
        </section>
      )}

      {a.status === "ACCEPTED" && t.status === "IN_PROCESS" && (
        <section aria-labelledby="work" className="card flex flex-col gap-3 p-4 sm:p-5">
          <h2 id="work" className="text-lg font-bold text-navy">Work on it</h2>
          {t.fundsNeeded === "YES" && (
            <p className="text-[15px]">Needs funds: {kinds}. {funds === "NEEDED" ? <Link href="/my-funds" className="link">Request a cash advance</Link> : funds === "DENIED" ? "Finance said no. Resolve or reschedule with the Loan Associate." : null}</p>
          )}
          {working ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {!a.processing && <AttemptForm assignmentId={a.id} today={today} reasons={reasons} lines={lines} blocked={blocked} />}
                {stages.length === 0 && !a.processing && t.attempts.length > 0 && !blocked && <CompleteForm assignmentId={a.id} code={t.type.code} today={today} />}
                {canReturn && (
                  <ReturnToLaForm
                    assignmentId={a.id} laName={a.assignedBy.name} reasons={returnReasons}
                    papers={papers.map((c) => ({ id: c.id, label: c.rule?.label ?? c.otherLabel ?? "Other paper" }))}
                    heldText={returnHeldCents > 0 ? peso(returnHeldCents) : null}
                    handover={t.documents.filter((d) => d.stage === "WITH_DP").map((d) => ({ id: d.id, label: d.label }))}
                  />
                )}
                {!problem && <RaiseProblemForm transactionId={t.id} reasons={reasons} />}
                {mayHold && !hold && holdReasons.length > 0 && <PutOnHoldForm transactionId={t.id} reasons={holdReasons} />}
                <FundsFlagForm assignmentId={a.id} needed={t.fundsNeeded} kinds={t.fundsKinds} choices={await flagKindChoices(t.fundsKinds)} />
                {canPass && (
                  <PasuyoForm
                    assignmentId={a.id} branches={passBranches} defaultBranchId={a.dpBranchId}
                    processors={passProcessors.map((p) => ({ id: p.id, name: p.name, branchIds: p.allBranches ? passBranches.map((b) => b.id) : p.branches.map((b) => b.branchId) }))}
                    heldText={heldCents > 0 ? peso(heldCents) : null}
                  />
                )}
              </div>
              {t.attempts.length === 0 && !a.processing && <p className="help">Log an attempt for each day you work on it (it belongs to the current stage).</p>}
              {a.processing && stages.length === 0 && (
                <>
                  <Banner tone="ok">Completed. Forward the package to the Loan Associate at {a.loan.branch.name}.</Banner>
                  <ForwardForm assignmentId={a.id} las={las} />
                </>
              )}
              {a.processing && stages.length > 0 && <Banner tone="ok">Completed. Choose the branch and the Loan Associate under Stages, then forward.</Banner>}
            </>
          ) : (
            <p className="text-sm text-ink-2">{a.dpUser.name} is working on it.</p>
          )}
        </section>
      )}
      </div>
      </LockedArea>

      {t.status === "FORWARDED" && (
        <Banner tone="wait">Forwarded on {dayText(a.forwardedAt)}. Waiting for the Loan Associate to check the papers.</Banner>
      )}
      {(a.status === "DECLINED" || a.status === "WITHDRAWN") && (
        <Banner tone="wait">{a.status === "DECLINED" ? "Declined" : "Returned"}: {a.declineReasons ?? a.returnReasons}</Banner>
      )}
      {a.status === "PULLED_BACK" && <Banner tone="wait">{a.returnReasons ?? "Pulled back by the Loan Associate before you accepted."} It is no longer on your list.</Banner>}
      {a.status === "CLOSED" && <Banner tone="ok">Done. The Loan Associate received the package complete.</Banner>}

      <section aria-labelledby="attempts" className="card p-4 sm:p-5">
        <h2 id="attempts" className="text-lg font-bold text-navy">Attempts</h2>
        {t.attempts.length === 0 ? <p className="mt-2 text-[15px] text-ink-2">No attempts yet.</p> : <AttemptTimeline attempts={t.attempts} />}
        {t.problems.some((p) => p.resolvedAt) && (
          <ul className="mt-3 border-t border-line pt-2 text-[13px] text-ink-2">
            {t.problems.filter((p) => p.resolvedAt).map((p) => (
              <li key={p.id}>Problem {p.reason.name}: {dayText(p.raisedAt)} to {dayText(p.resolvedAt)} · {p.resolutionNote}</li>
            ))}
          </ul>
        )}
      </section>

      {pinned && !hold && (
        <>
          <div aria-hidden="true" className="h-16 sm:hidden" />
          <PinnedAction label={pinned.label} targetId={pinned.target} href={pinned.href} />
        </>
      )}

      {pasuyoEvents.length > 0 && (
        <section aria-labelledby="pasuyo" className="card p-4 sm:p-5">
          <h2 id="pasuyo" className="text-lg font-bold text-navy">Pasuyo history</h2>
          <ol className="relative mt-2 flex flex-col gap-3 border-l-2 border-line pl-5">
            {pasuyoEvents.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden="true" className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-gold" />
                <p className="text-[15px] font-semibold">{e.fromLabel ? `${e.fromLabel} passed it to ${e.toLabel}` : `${e.byLabel} added ${e.toLabel} as second processor at Send`}</p>
                <p className="text-[13px] text-ink-2">
                  {dayText(e.createdAt)} · {e.reason}{e.note ? ` · ${e.note}` : ""}
                  {e.funds === "RETURNED" ? " · cash returned to Finance" : e.funds === "HANDED" ? ` · cash handed to ${e.toLabel}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {t.advanceLines.length > 0 && (
        <section aria-labelledby="funds" className="card p-4 sm:p-5">
          <h2 id="funds" className="text-lg font-bold text-navy">Funds</h2>
          <ul className="mt-2 flex flex-col gap-1 text-[15px]">
            {t.advanceLines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2"><FundsTypePill code={l.advance.fundsTypeCode} name={l.advance.fundsTypeName} /><span>{l.advance.number} · {lineKindText(names, l)} · asked {peso(l.requestedCents)}{l.releasedCents ? ` · ${l.advance.transferDate || l.advance.accountLast4 ? "sent" : "released"} ${peso(l.releasedCents)}` : ""}{l.denied ? " · not approved" : ""}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PaperList({ docs }: { docs: { id: string; label: string; documentId: string | null; labelPrintedAt: Date | null; originality: string }[] }) {
  return (
    <ul className="flex flex-col rounded-xl border border-line">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0">
          <span className="min-w-0 flex-1 text-[15px]">{d.label} <span className="tag">{d.originality === "ORIGINAL" ? "Original" : "Copy"}</span></span>
          {d.documentId && <span className="mono text-xs text-ink-2">{d.documentId}</span>}
          <span className={`chip ${d.labelPrintedAt ? "c-ok" : "c-act"}`}>{d.labelPrintedAt ? "Label printed" : "Label not printed"}</span>
        </li>
      ))}
    </ul>
  );
}
