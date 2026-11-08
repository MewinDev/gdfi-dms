import { ToneChip } from "@/components/ui/basics";

const TEXT: Record<string, [string, "act" | "wait" | "ok" | "bad" | "mute" | "navy"]> = {
  REQUESTED: ["Waiting for approval", "wait"],
  APPROVED: ["Approved · to release", "act"],
  RELEASED: ["Released", "navy"],
  FOR_LIQUIDATION: ["For liquidation", "navy"],
  PARTIALLY_LIQUIDATED: ["Partly liquidated", "act"],
  LIQUIDATED: ["Liquidated", "ok"],
  CLOSED: ["Closed", "mute"],
  DENIED: ["Denied", "bad"],
  CANCELLED: ["Cancelled", "mute"],
};

export function AdvanceStatusChip({ status, overdue }: { status: string; overdue?: boolean }) {
  const [t, tone] = TEXT[status] ?? [status, "mute"];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <ToneChip tone={tone}>{t}</ToneChip>
      {overdue && <ToneChip tone="bad">Liquidation overdue</ToneChip>}
    </span>
  );
}
