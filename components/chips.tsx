import { ROLE_CHIPS } from "@/lib/auth/permissions";
import { TAT_LABEL, type TatBadge as TatBadgeValue } from "@/lib/time";

const ROLE_BG: Record<string, string> = {
  la: "bg-chip-la",
  dp: "bg-chip-dp",
  vault: "bg-chip-vault",
  dig: "bg-chip-dig",
  qa: "bg-chip-qa",
  fin: "bg-chip-fin",
  appr: "bg-chip-appr",
  sys: "bg-chip-sys",
};

export function RoleChip({ role, label }: { role: string; label?: string }) {
  const r = ROLE_CHIPS[role] ?? { label: role, token: "sys" };
  return <span className={`chip ${ROLE_BG[r.token]}`}>{label ?? r.label}</span>;
}

type Tone = "ok" | "err" | "info" | "warn" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  err: "bg-err-bg text-err-fg",
  info: "bg-info-bg text-info-fg",
  warn: "bg-warn-bg text-warn-fg",
  neutral: "bg-chip-sys text-ink",
};

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip ${TONE[tone]}`} title={title}>
      {children}
    </span>
  );
}

const STAGE_TONE: Record<string, Tone> = {
  Opened: "neutral",
  "For checklist": "warn",
  "No DP assignment required": "warn",
  "Assigned to DP": "info",
  "In process": "info",
  "Awaiting LA acceptance": "warn",
  "For Vault Transmittal": "warn",
  "In transit to Vault": "info",
  "In Safekeeping": "ok",
  Closed: "ok",
  Archived: "neutral",
  Disposed: "neutral",
};

export function StageChip({ stage }: { stage: string }) {
  return <Chip tone={STAGE_TONE[stage] ?? "neutral"}>{stage}</Chip>;
}

export function TatBadge({ badge, title }: { badge: TatBadgeValue | null | undefined; title?: string }) {
  if (!badge) return <span className="text-xs text-ink-2">-</span>;
  const tone: Tone = badge === "OVERDUE" ? "err" : badge === "DUE_TODAY" ? "warn" : "ok";
  return (
    <Chip tone={tone} title={title}>
      {TAT_LABEL[badge]}
    </Chip>
  );
}

const TXN_STATUS: Record<string, { label: string; tone: Tone }> = {
  FOR_CHECKLIST: { label: "For checklist", tone: "warn" },
  READY: { label: "Ready", tone: "info" },
  ASSIGNED: { label: "Assigned to DP", tone: "info" },
  RETURNED: { label: "Returned to LA", tone: "err" },
  IN_PROCESS: { label: "In process", tone: "info" },
  FORWARDED: { label: "Forwarded to branch", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function TxnStatusChip({ status }: { status: string }) {
  const s = TXN_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function SimulatedTag() {
  return <Chip tone="warn">Simulated</Chip>;
}
