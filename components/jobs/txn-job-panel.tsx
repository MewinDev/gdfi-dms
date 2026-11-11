import { mayReceive } from "@/lib/services/jobs";
import { advisoryWarnings } from "@/lib/services/lto-advisories";
import { prisma } from "@/lib/db";
import { can, type CurrentUser, inScope } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { LoanDetail } from "@/lib/services/queries";
import type { TatMap } from "@/lib/workflow/tat";
import { flagKindChoices } from "@/lib/services/expense-kinds";
import { liveAssignment } from "@/lib/ui/plain";
import { openHold, openProblem, txnFunds, txnFundsType, txnTat } from "@/lib/jobs/view";
import { FundsTypePill } from "@/components/funds/funds-type-pill";
import { FundsChip, TatChip } from "./chips";
import { FundsFlagForm, PutOnHoldForm, RaiseProblemForm, ReceivePackageForm } from "./forms";
import { AttemptTimeline } from "./timeline";
import { ChangeLtoOfficeForm, ChangeProcessorForm, ProcessorNoteForm, PullBackForm, UpdatePapersButton } from "@/components/loan/sent-actions";
import { ltoEstimate } from "@/lib/ui/lto";
import { MapPinIcon } from "@/components/ui/icons";
import { SentToast } from "./sent-toast";

type Txn = LoanDetail["transactions"][number];

const DP_STATUS: Record<string, string> = {
  PENDING_ACCEPTANCE: "Waiting for the processor to accept", ACCEPTED: "Processor is working on it", DECLINED: "Declined by the processor",
  WITHDRAWN: "Returned by the processor", CLOSED: "Done",
};

/**
 * The job card on Check documents (the LA's view): funds, processor status, TAT and problem.
 * The LA may change the funds flag until the processor accepts, raise and resolve problems on
 * transactions it owns, and receive the package (Phase 5).
 */
export async function TxnJobPanel({ loan, txn, user, tats, holidays, statusText }: { loan: LoanDetail; txn: Txn; user: CurrentUser; tats: TatMap; holidays: ReadonlySet<string>; /** "Sent to Grace Tan on Nov 7. Waiting for them to accept." */ statusText?: string | null }) {
  const now = new Date();
  const a = txn.dpAssignments.find((x) => liveAssignment(x.status)) ?? null;
  const funds = txnFunds(txn);
  const tat = txnTat(txn, tats, holidays, now);
  const problem = openProblem(txn.problems);
  const hold = openHold(txn.holds);
  const la = can(user, PERMISSIONS.CHECKLIST_TICK) && inScope(user, loan.branchId);
  // The LA owns the transaction while it is in the LA's hands (and for LA-owned types).
  const laOwns = la && (txn.type.ownerRole === "LA" || ["FOR_CHECKLIST", "READY", "RETURNED", "FORWARDED"].includes(txn.status));
  const reasons = laOwns || can(user, PERMISSIONS.PROBLEMS_RESOLVE_ANY)
    ? await prisma.problemReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })
    : [];
  const mayHold = laOwns && can(user, PERMISSIONS.HOLDS_RAISE) && !hold && !["COMPLETED", "CANCELLED"].includes(txn.status);
  const holdReasons = mayHold ? await prisma.holdReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }) : [];
  const canFlag = can(user, PERMISSIONS.FUNDS_FLAG) && la && txn.type.requiresDp && txn.status === "ASSIGNED" && a?.status === "PENDING_ACCEPTANCE";
  const receiving = txn.status === "FORWARDED" && a && mayReceive(user, { ...a, loan });
  const choices = await flagKindChoices(txn.fundsKinds);
  const kinds = txn.fundsKinds.map((k) => choices.find((c) => c[0] === k)?.[1] ?? k).join(", ");
  // Sent, not accepted yet: the LA who may send can still change it (the server re-checks on every change).
  const changeable = !!a && txn.status === "ASSIGNED" && a.status === "PENDING_ACCEPTANCE" && la && can(user, PERMISSIONS.DP_SEND);
  const offices = changeable && txn.type.needsLto
    ? (await prisma.ltoOffice.findMany({ where: { active: true }, orderBy: { name: "asc" } })).map((o) => ({ id: o.id, name: o.name, estimate: ltoEstimate(o) }))
    : [];
  const processors = changeable
    ? (await prisma.user.findMany({
        where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } } }, orderBy: { name: "asc" },
        select: { id: true, name: true, branches: { select: { branch: { select: { name: true } } } } },
      })).map((p) => ({ id: p.id, name: p.name, branches: p.branches.map((b) => b.branch.name).join(", ") }))
    : [];

  return (
    <section id={`job-${txn.id}`} aria-label={`${txn.type.name}: job`} className={`card flex scroll-mt-28 flex-col gap-3 p-4 sm:p-5 ${problem ? "border-l-4 border-l-[var(--bad-fg)]" : hold ? "shadow-[inset_4px_0_0_var(--hold-stripe)]" : ""}`}>
      <SentToast txnId={txn.id} targetId={`job-${txn.id}`} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[17px] font-bold text-navy">
          {a ? `Sent to ${a.dpUser.name}` : "Processor job"}
          {a?.secondaryDpUser && <span className="block text-[13px] font-semibold text-ink-2">with a second processor (Pasuyo) {a.secondaryDpUser.name}</span>}
        </h2>
        {a?.secondaryDpUser && <span className="chip c-wait">Pasuyo</span>}
        <TatChip data={tat} />
      </div>
      {statusText && <p className="-mt-2 text-[13px] text-ink-2">{statusText}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {/* Before Send, the send step asks the funds question; the chip follows once it is sent. */}
        {txn.type.requiresDp && !["FOR_CHECKLIST", "READY", "RETURNED"].includes(txn.status) && <FundsChip status={funds} />}
        {(() => { const ft = txnFundsType(txn); return ft ? <FundsTypePill code={ft.code} name={ft.name} /> : null; })()}
        {a?.ltoOffice && <span className="chip c-wait" data-lto-chip><MapPinIcon size={14} strokeWidth={2.4} />At {a.ltoOffice.name}</span>}
        {a && !statusText && <span className="chip c-mute">{DP_STATUS[a.status] ?? a.status} · {a.dpUser.name}</span>}
      </div>
      {txn.fundsNeeded === "YES" && kinds && <p className="text-[13px] text-ink-2">Funds for: {kinds}. The processor asks Finance for the amount.</p>}

      {changeable && a && (
        <div className="flex flex-col gap-2 rounded-xl border border-line-soft bg-select-bg p-3" data-before-accept>
          <p className="text-[15px] font-semibold text-navy">Not accepted yet. You can still change this.</p>
          <div className="flex flex-wrap gap-2">
            <UpdatePapersButton target={`papers-${txn.id}`} />
            {canFlag && <FundsFlagForm transactionId={txn.id} needed={txn.fundsNeeded} kinds={txn.fundsKinds} label="Change funds" choices={choices} />}
            <ChangeProcessorForm transactionId={txn.id} current={{ dpId: a.dpUserId, secondId: a.secondaryDpUserId }} processors={processors} />
            {txn.type.needsLto && <ChangeLtoOfficeForm mode="la" id={txn.id} offices={offices} currentId={a.ltoOfficeId} warnings={offices.length ? await advisoryWarnings() : undefined} />}
            <ProcessorNoteForm transactionId={txn.id} />
            <PullBackForm transactionId={txn.id} dpName={a.dpUser.name} />
          </div>
        </div>
      )}

      {receiving && a && <ReceivePackageForm assignmentId={a.id} from={a.dpUser.name} papers={loan.documents.filter((d) => d.transactionId === txn.id && d.stage === "IN_TRANSIT").length} />}

      {((canFlag && !changeable) || (laOwns && !problem && can(user, PERMISSIONS.PROBLEMS_RAISE) && reasons.length > 0) || (mayHold && holdReasons.length > 0)) && (
        <div className="flex flex-wrap gap-2">
          {canFlag && !changeable && <FundsFlagForm transactionId={txn.id} needed={txn.fundsNeeded} kinds={txn.fundsKinds} choices={choices} />}
          {laOwns && !problem && can(user, PERMISSIONS.PROBLEMS_RAISE) && reasons.length > 0 && <RaiseProblemForm transactionId={txn.id} reasons={reasons} />}
          {mayHold && holdReasons.length > 0 && <PutOnHoldForm transactionId={txn.id} reasons={holdReasons} />}
        </div>
      )}

      {txn.attempts.length > 0 && (
        <details className="border-t border-line pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-navy">Attempts ({txn.attempts.length})</summary>
          <AttemptTimeline attempts={txn.attempts} />
        </details>
      )}
    </section>
  );
}
