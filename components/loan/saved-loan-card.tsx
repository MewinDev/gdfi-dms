"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { refreshFoundLoanAction } from "@/app/actions/loan";
import { Avatar, ToneChip } from "@/components/ui/basics";

export interface SavedLoanCardData {
  pn: string;
  borrowerName: string;
  productName: string;
  branchName: string;
  stageText: string;
  holder: { role: "Processor" | "Owner"; name: string };
  next: string;
  holds: string[];
  problems: number;
  changed: boolean;
  cancelled: { on: string; reason: string | null } | null;
  closed: boolean;
  replacedByPn: string | null;
  stale: boolean;
}

/**
 * Find a loan, a PN already saved in the DMS: a compact card in the result card's layout (name, PN and
 * product, chips, who has it, the next step) with Open loan file and Cancel. No questions (answered when
 * it was opened) and no MyLoans call; when the saved copy is older than the setting, one refresh runs in
 * the background after the card shows, and a change it finds adds the "MyLoans changed" chip.
 */
export function SavedLoanCard({ d }: { d: SavedLoanCardData }) {
  const [changed, setChanged] = useState(d.changed);
  const asked = useRef(false);
  useEffect(() => {
    if (!d.stale || asked.current) return;
    asked.current = true; // once per card
    refreshFoundLoanAction(d.pn).then((r) => { if (r.changed) setChanged(true); }).catch(() => null);
  }, [d.pn, d.stale]);

  const ended = !!d.cancelled || d.closed;
  return (
    <section aria-labelledby="saved-title" className="card min-w-0 p-4 sm:p-6" data-find-saved={d.pn}>
      {(d.cancelled || d.replacedByPn) && (
        <p className="mb-4 rounded-xl bg-bad-bg px-3 py-2 text-sm font-semibold text-bad-fg" data-saved-ended>
          {d.cancelled ? `This loan was cancelled on ${d.cancelled.on}.` : "This loan was replaced."}
          {d.cancelled?.reason && !d.replacedByPn ? ` ${d.cancelled.reason}.` : ""}
          {d.replacedByPn && (
            <> Replaced by <Link href={`/search?q=${encodeURIComponent(d.replacedByPn)}`} className="link font-mono" data-saved-replacement>{d.replacedByPn}</Link>.</>
          )}
        </p>
      )}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4" data-find-head>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={d.borrowerName} size={40} />
          <div className="min-w-0">
            <h2 id="saved-title" className="text-lg font-bold leading-tight text-navy">{d.borrowerName}</h2>
            <p className="text-sm text-ink-2"><span className="font-mono">{d.pn}</span> · {d.productName.trim() || "No product name"}</p>
          </div>
        </div>
        <ul aria-label="Loan file status" className="flex flex-wrap items-center gap-2" data-saved-chips>
          <li><ToneChip tone="ok" check>Already in the DMS</ToneChip></li>
          <li><ToneChip tone={ended ? "mute" : "navy"}>{d.cancelled ? "Cancelled" : d.stageText}</ToneChip></li>
          {d.holds.map((h) => <li key={h}><ToneChip tone="hold">On hold: {h}</ToneChip></li>)}
          {d.problems > 0 && <li><ToneChip tone="bad">{d.problems} problem{d.problems === 1 ? "" : "s"}</ToneChip></li>}
          {changed && <li data-saved-changed><ToneChip tone="bad">MyLoans changed</ToneChip></li>}
        </ul>
      </div>
      <dl className="mt-4 grid grid-cols-12 gap-x-6 gap-y-4">
        {([
          [d.holder.role === "Processor" ? "With processor" : "Owner", d.holder.name],
          ["Branch", d.branchName],
          ["Next step", d.next],
        ] as const).map(([k, v], i) => (
          <div key={k} className={`min-w-0 ${i === 2 ? "col-span-12 md:col-span-6" : "col-span-6 md:col-span-3"}`}>
            <dt className="text-xs text-ink-2">{k}</dt>
            <dd className="mt-0.5 break-words text-base font-semibold text-navy" data-saved-fact={k}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={`/loans/${d.pn}`} className="btn-navy" data-saved-open>Open loan file</Link>
        <Link href="/search" className="btn-ghost">Cancel</Link>
      </div>
    </section>
  );
}
