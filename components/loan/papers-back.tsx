"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { confirmPapersBackAction } from "@/app/actions/loan";

const confirmAnnounced = announcing(confirmPapersBackAction);

/**
 * After a Return to LA the processor handed over the papers received at Accept. The LA confirms them
 * here: all received, or one or more "Not received" (a Problem is raised naming those papers). Send
 * again stays locked until this is done.
 */
export function PapersBackCard({ transactionId, dpName, handedAt, papers }: {
  transactionId: string; dpName: string; handedAt: string; papers: { id: string; label: string; code: string | null }[];
}) {
  const [state, action] = useActionState(confirmAnnounced, null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setMissing((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section id="papers-back" aria-labelledby="papers-back-h" className="hold-card flex scroll-mt-28 flex-col gap-2 py-3 pl-5 pr-3 sm:pr-4" data-papers-back>
      <h3 id="papers-back-h" className="text-[15px] font-bold text-ink">Confirm you received the papers</h3>
      <p className="text-[13px] text-ink-2">Papers handed over by {dpName} (DP) · {handedAt}. Confirm each one before sending it again. Mark one &ldquo;Not received&rdquo; if it did not arrive: a problem is raised for it.</p>
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="transactionId" value={transactionId} />
        <ul className="flex flex-col gap-1.5">
          {papers.map((p) => (
            <li key={p.id} className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-1.5" data-paper-back={missing.has(p.id) ? "missing" : "received"}>
              <span className="min-w-0 flex-1 text-[15px]">{p.label}{p.code && <span className="mono ml-2 text-ink-2">{p.code}</span>}</span>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
                <input type="checkbox" name="notReceived" value={p.id} checked={missing.has(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5 accent-[var(--navy)]" />
                Not received
              </label>
            </li>
          ))}
        </ul>
        <FormMessage state={state} />
        <div>
          <SubmitButton className="btn-ghost btn-sm">{missing.size ? `Confirm (${missing.size} not received)` : "Confirm all received"}</SubmitButton>
        </div>
      </form>
    </section>
  );
}
