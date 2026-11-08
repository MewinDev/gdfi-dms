import type { TxnStatus } from "@/lib/ui/txn-status";
import { TatChip } from "@/components/jobs/chips";
import { AlertIcon, PauseIcon } from "@/components/ui/icons";

const TONE = { act: "c-act", wait: "c-wait", ok: "c-ok", bad: "c-bad", mute: "c-mute", navy: "c-navy" } as const;

/**
 * The chips of a transaction row, in the same order everywhere: the status chip, the TAT chip (when it
 * applies), then the markers (Problem, On hold, Missing paper). Words and an icon, never colour alone.
 */
export function TxnStatusChips({ s, tat = true }: { s: TxnStatus; tat?: boolean }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" data-status-chips>
      <span className={`chip ${TONE[s.chip.tone]} h-auto min-h-6 whitespace-normal py-0.5 text-xs`} data-status-chip>{s.chip.text}</span>
      {tat && s.tat && <span className="[&_.chip]:min-h-6 [&_.chip]:text-xs" data-tat-chip><TatChip data={s.tat} /></span>}
      {s.markers.map((m) => (
        <span key={m.kind} data-marker={m.kind} className={`chip h-6 px-2 text-xs ${m.kind === "hold" ? "c-navy" : "c-bad"}`}>
          {m.kind === "hold" ? <span className="text-gold"><PauseIcon size={12} strokeWidth={2.6} /></span> : <AlertIcon size={12} strokeWidth={2.6} />}
          {m.text}
        </span>
      ))}
    </span>
  );
}
