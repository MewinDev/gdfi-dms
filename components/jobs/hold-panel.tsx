import { holdDays } from "@/lib/workflow/tat";
import { fmtShort } from "@/lib/time";
import { PauseIcon } from "@/components/ui/icons";
import { ResumeHoldForm } from "./forms";

export interface HoldLike {
  id: string;
  raisedAt: Date;
  resumedAt: Date | null;
  raisedByLabel: string;
  note: string;
  reason: { name: string };
}

/**
 * The open hold, in words: navy with a pause icon (a problem stays red and wins).
 * "On hold: Waiting on borrower · 1 day" / "Put on hold by Ana Cruz on Nov 7, 12:51 PM. The
 * turnaround time keeps counting." and the note. Resume (opens the Resume pop-up) only for people
 * who can resolve it.
 */
export function HoldBanner({ hold, holidays, canResume, now = new Date(), id }: { hold: HoldLike; holidays: ReadonlySet<string>; canResume: boolean; now?: Date; id?: string }) {
  const days = Math.max(1, holdDays([hold], holidays, now));
  return (
    <section id={id} role="status" aria-label="On hold" className="flex scroll-mt-28 flex-col gap-2 rounded-xl bg-navy p-3 text-white sm:flex-row sm:items-center sm:gap-4 sm:p-4" data-hold-open data-open-item="hold">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          <span className="text-gold"><PauseIcon size={18} /></span>
          On hold: {hold.reason.name} · {days} day{days === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[13px] text-white/90">
          Put on hold by {hold.raisedByLabel} on {fmtShort(hold.raisedAt)}. The turnaround time keeps counting.
        </p>
        {hold.note && <p className="mt-0.5 text-[13px] text-white/90">Note: {hold.note}</p>}
      </div>
      {canResume && <div className="shrink-0"><ResumeHoldForm holdId={hold.id} reason={hold.reason.name} days={days} buttonClass="btn-gold btn-sm" /></div>}
    </section>
  );
}
