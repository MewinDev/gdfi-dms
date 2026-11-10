import type { TxnStatus } from "@/lib/ui/txn-status";
import type { Tone } from "@/lib/ui/plain";
import { AlertIcon, ArrowLeftIcon, CheckIcon, ClockIcon, FileTextIcon, MinusIcon, PauseIcon } from "@/components/ui/icons";

const TONE: Record<Tone, string> = { act: "c-act", wait: "c-wait", ok: "c-ok", bad: "c-bad", mute: "c-mute", navy: "c-navy", hold: "c-hold" };

function PillIcon({ s }: { s: TxnStatus }) {
  const p = { size: 12, strokeWidth: 2.6 };
  if (s.pill.kind === "hold") return <PauseIcon {...p} />;
  if (s.pill.kind === "problem") return <AlertIcon {...p} />;
  if (s.pill.kind === "missing") return <FileTextIcon {...p} />;
  if (s.pill.kind === "returned") return <ArrowLeftIcon {...p} />;
  if (s.pill.tone === "ok") return <CheckIcon {...p} />;
  if (s.pill.tone === "wait") return <ClockIcon {...p} />;
  if (s.pill.tone === "mute") return <MinusIcon {...p} />;
  return <FileTextIcon {...p} />;
}

/**
 * The one status pill of a transaction row (soft colours, an icon and the word: colour is never the
 * only signal), then the day count as plain grey text ("Day 1 of 2"; "+1 day late" in red).
 */
export function TxnStatusChips({ s, clock = true }: { s: TxnStatus; clock?: boolean }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-status-chips>
      <span className={`chip ${TONE[s.pill.tone]} h-auto min-h-6 whitespace-normal px-2 py-0.5 text-xs`} data-status-chip data-pill={s.pill.kind}>
        <PillIcon s={s} />{s.pill.text}
      </span>
      {clock && s.clock && <span className={`text-xs ${s.clock.late ? "font-semibold text-bad-fg" : "text-ink-2"}`} data-clock>{s.clock.text}</span>}
    </span>
  );
}
