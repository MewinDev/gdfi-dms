import { fmtDateTime } from "@/lib/time";
import type { SentBack } from "@/lib/ui/rounds";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * At the top of a transaction the DP declined or returned: what they found, who and when (PHT), the
 * round, and what to do now. Soft amber (not a Problem); the LA fixes it and sends it again.
 */
export function SentBackCard({ sb, forSender }: { sb: SentBack; forSender: boolean }) {
  return (
    <section aria-label={sb.label} className="rounded-[14px] border border-act-line bg-white p-3 pl-4 shadow-[inset_4px_0_0_var(--hold-stripe)] sm:p-4 sm:pl-5" data-sent-back={sb.kind}>
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink" data-sent-back-title>
        <span className="text-act-fg"><ArrowLeftIcon size={16} strokeWidth={2.4} /></span>{sb.label}
      </h3>
      <blockquote className="mt-1 whitespace-pre-line break-words border-l-2 border-act-line pl-3 text-[15px] text-ink" data-findings>{sb.findings || "No findings were written."}</blockquote>
      <p className="mt-1 text-[13px] text-ink-2" data-sent-back-by>By {sb.dpName} (DP) · {fmtDateTime(sb.at)} · Round {sb.round}</p>
      {!sb.senderActive && <p className="mt-0.5 text-[13px] font-semibold text-act-fg" data-inactive-sender>Sender {sb.senderName ?? "unknown"} is inactive. Any Loan Associate of the branch can fix it and send it again.</p>}
      <p className="mt-0.5 text-[13px] text-ink-2">
        {forSender
          ? "Fix it, then send it again. You choose the processor again (it may be someone else). The TAT clock keeps running."
          : `It went back to ${sb.senderName ?? "the Loan Associate who sent it"}, who fixes it and sends it again.`}
      </p>
    </section>
  );
}
