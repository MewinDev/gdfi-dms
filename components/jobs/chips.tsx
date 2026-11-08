import type { TatChipData } from "@/lib/workflow/tat";
import { FUNDS_LABEL, type FundsStatus } from "@/lib/funds/rules";
import { FUNDS_TONE } from "@/lib/jobs/view";
import { ToneChip } from "@/components/ui/basics";
import { AlertIcon, CheckIcon, ClockIcon, CoinsIcon, HourglassIcon, PauseIcon, TagIcon, WarningIcon } from "@/components/ui/icons";

const TAT_STYLE: Record<TatChipData["state"], { cls: string; Icon: typeof ClockIcon; label: string }> = {
  waiting: { cls: "c-mute", Icon: HourglassIcon, label: "Waiting" },
  processing: { cls: "c-navy", Icon: ClockIcon, label: "Processing" },
  due: { cls: "c-act", Icon: ClockIcon, label: "Due today" },
  hold: { cls: "c-navy", Icon: PauseIcon, label: "On hold" },
  problem: { cls: "c-bad", Icon: AlertIcon, label: "Problem" },
  overdue: { cls: "c-bad", Icon: WarningIcon, label: "Overdue" },
  done: { cls: "c-ok", Icon: CheckIcon, label: "Done" },
};

/**
 * The one TAT chip (Waiting / Processing / Due today / On hold / Problem / Overdue / Done).
 * Words and an icon, never colour alone. A problem or hold that is also late shows "+N days late"
 * beside it.
 */
export function TatChip({ data }: { data: TatChipData | null }) {
  if (!data) return null;
  const s = TAT_STYLE[data.state];
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-tat={data.state}>
      {/* Long problem texts wrap on a phone instead of pushing the page sideways. */}
      <span className={`chip ${s.cls} h-auto min-h-6 max-w-full whitespace-normal py-0.5`}>
        <span className={data.state === "hold" ? "text-gold" : undefined}><s.Icon size={14} strokeWidth={2.4} /></span>
        {data.text}
      </span>
      {(data.state === "problem" || data.state === "hold") && data.lateText && <span className="chip c-bad"><WarningIcon size={14} strokeWidth={2.4} />{data.lateText}</span>}
    </span>
  );
}

export function FundsChip({ status }: { status: FundsStatus }) {
  return (
    <span className={`chip c-${FUNDS_TONE[status]}`} data-funds={status}>
      <CoinsIcon size={14} strokeWidth={2.4} />
      {FUNDS_LABEL[status]}
    </span>
  );
}

export function LabelsChip({ printed }: { printed: boolean }) {
  return (
    <span className={`chip ${printed ? "c-ok" : "c-act"}`}>
      <TagIcon size={14} strokeWidth={2.4} />
      {printed ? "Labels printed" : "Labels not printed"}
    </span>
  );
}

export function HoldChip({ reason, days }: { reason: string; days: number }) {
  return <span className="chip c-navy"><span className="text-gold"><PauseIcon size={14} strokeWidth={2.4} /></span>On hold · {reason} · {days} day{days === 1 ? "" : "s"}</span>;
}

export function ProblemChip({ reason, days }: { reason: string; days: number }) {
  return <ToneChip tone="bad">Problem · {reason} · {days} day{days === 1 ? "" : "s"}</ToneChip>;
}
