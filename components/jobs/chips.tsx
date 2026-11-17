import type { TatChipData } from "@/lib/workflow/tat";
import { FUNDS_LABEL, type FundsStatus } from "@/lib/funds/rules";
import { FUNDS_TONE } from "@/lib/jobs/view";
import { AlertIcon, CheckIcon, ClockIcon, CoinsIcon, HourglassIcon, PauseIcon, WarningIcon } from "@/components/ui/icons";

const TAT_STYLE: Record<TatChipData["state"], { cls: string; Icon: typeof ClockIcon; label: string }> = {
  waiting: { cls: "c-mute", Icon: HourglassIcon, label: "Waiting" },
  // D-041 colours: green with 2 or more working days left, amber 1 day left or due today, red late, grey paused.
  processing: { cls: "c-ok", Icon: ClockIcon, label: "Processing" },
  soon: { cls: "c-act", Icon: ClockIcon, label: "Due soon" },
  due: { cls: "c-act", Icon: ClockIcon, label: "Due today" },
  hold: { cls: "c-hold", Icon: PauseIcon, label: "On hold" },
  paused: { cls: "c-mute", Icon: PauseIcon, label: "Paused" },
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
    <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-tat={data.state} title={data.note}>
      {/* Long problem texts wrap on a phone instead of pushing the page sideways. */}
      <span className={`chip ${s.cls} h-auto min-h-6 max-w-full whitespace-normal py-0.5`}>
        <s.Icon size={14} strokeWidth={2.4} />
        {data.text}
        {data.note && <span className="sr-only">. {data.note}</span>}
      </span>
      {(data.state === "problem" || data.state === "hold" || data.state === "paused") && data.lateText && <span className="chip c-bad"><WarningIcon size={14} strokeWidth={2.4} />{data.lateText}</span>}
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
