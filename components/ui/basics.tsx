import { initials, type Tone } from "@/lib/ui/plain";
import { CheckIcon } from "./icons";

export function Avatar({ name, size = 44, tone = "navy" }: { name: string; size?: 32 | 40 | 44 | 56; tone?: "navy" | "gold" }) {
  const cls = size === 56 ? "h-14 w-14 text-lg" : size === 40 ? "h-10 w-10 text-[15px]" : size === 32 ? "h-8 w-8 text-xs" : "h-11 w-11 text-base";
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full ${tone === "gold" ? "bg-gold font-bold text-navy" : "bg-navy font-semibold text-white"} ${cls}`}>
      {initials(name)}
    </span>
  );
}

const TONE_CLASS: Record<Tone, string> = { act: "c-act", wait: "c-wait", ok: "c-ok", bad: "c-bad", mute: "c-mute", navy: "c-navy", hold: "c-hold" };

export function ToneChip({ tone, children, check, title }: { tone: Tone; children: React.ReactNode; check?: boolean; title?: string }) {
  return (
    // A long text (for example "MyLoans changed borrower details, waiting for review") wraps on a phone.
    <span className={`chip ${TONE_CLASS[tone]}${typeof children === "string" && children.length > 30 ? " h-auto min-h-7 max-w-full whitespace-normal py-1 text-left" : ""}`} title={title}>
      {check && <CheckIcon size={14} strokeWidth={2.6} />}
      {children}
    </span>
  );
}

export function Banner({ tone, children }: { tone: "bad" | "wait" | "ok" | "act"; children: React.ReactNode }) {
  const cls = tone === "bad" ? "border-bad-line bg-bad-bg text-bad-fg" : tone === "ok" ? "border-ok-line bg-ok-bg text-ok-fg" : tone === "act" ? "border-act-line bg-act-bg text-act-fg" : "border-wait-line bg-wait-bg text-wait-fg";
  return (
    <p role={tone === "bad" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-[15px] ${cls}`}>
      {children}
    </p>
  );
}

/** The page name, shown once as the large heading at the top of the content, with one line of help. */
export function PageHeader({ title, help, children, before }: { title: React.ReactNode; help?: React.ReactNode; children?: React.ReactNode; before?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start gap-4">
      {before}
      <div className="min-w-0 flex-1">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.015em] text-navy sm:text-[28px] lg:text-[32px]">{title}</h1>
        {help && <p className="mt-1 text-[15px] text-ink-2 sm:text-base">{help}</p>}
      </div>
      {children}
    </header>
  );
}
