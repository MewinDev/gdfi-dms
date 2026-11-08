import { peso } from "@/lib/funds/rules";
import { dayText } from "@/lib/ui/plain";

export interface AttemptView {
  id: string;
  date: string;
  result: "DONE" | "NOT_PROCESSED";
  note: string;
  restDecision: string;
  simulated: boolean;
  reason: { name: string } | null;
  dpUser: { name: string };
  spends: { cents: number }[];
}

/** Attempts, newest first. Append-only: a correction is a new attempt. */
export function AttemptTimeline({ attempts }: { attempts: AttemptView[] }) {
  const n = attempts.length;
  return (
    <ol className="relative mt-2 flex flex-col gap-3 border-l-2 border-line pl-5" aria-label="Attempts">
      {attempts.map((a, i) => {
        const spent = a.spends.reduce((s, x) => s + x.cents, 0);
        const done = a.result === "DONE";
        return (
          <li key={a.id} className="relative">
            <span aria-hidden="true" className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ${done ? "bg-[var(--ok-fg)]" : "bg-[var(--bad-fg)]"}`} />
            <p className="text-[15px] font-semibold">
              Attempt {n - i} · {dayText(a.date)} · <span className={done ? "text-ok-fg" : "text-bad-fg"}>{done ? "Done" : `Not processed${a.reason ? ` (${a.reason.name})` : ""}`}</span>
            </p>
            <p className="text-[13px] text-ink-2">
              {a.dpUser.name}
              {spent > 0 ? ` · spent ${peso(spent)}` : ""}
              {a.restDecision === "CARRY_OVER" ? " · rest carried over" : a.restDecision === "RETURN" ? " · rest returned" : ""}
              {a.note ? ` · ${a.note}` : ""}
              {a.simulated ? " · Test event" : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
