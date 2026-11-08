"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";

export interface DocItem {
  id: string;
  documentId: string | null;
  label: string;
  original: boolean;
  txnName: string | null;
  holder: string;
  place: string;
  /** "Nov 7, 9:12 AM" (PHT, formatted on the server). */
  sinceText: string;
  trail: { id: string; label: string; when: string; by: string | null; place: string | null; ack: string | null; remarks: string | null; simulated: boolean }[];
  periods: { holder: string; place: string | null; from: string; to: string | null; held: string }[];
}

/**
 * Documents scope: a searchable list of papers (by name or Document ID). Each row shows the current
 * holder; it opens the custody trail (newest first) with who, where, when, "Acknowledged by", and the
 * time each holder held the paper. All texts arrive formatted in PHT from the server.
 */
export function DocsList({ docs }: { docs: DocItem[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? docs.filter((d) => d.label.toLowerCase().includes(s) || (d.documentId ?? "").toLowerCase().includes(s)) : docs;
  }, [docs, q]);
  return (
    <section aria-labelledby="docs-h" className="card flex min-w-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center sm:p-4">
        <h2 id="docs-h" className="text-[17px] font-bold text-navy sm:mr-auto">Papers and who holds them</h2>
        <label className="relative block sm:w-72">
          <span className="sr-only">Find a paper by name or Document ID</span>
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"><SearchIcon size={18} /></span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or Document ID" className="input pl-10" />
        </label>
      </div>
      <p className="sr-only" role="status">{shown.length} paper{shown.length === 1 ? "" : "s"} shown</p>
      {shown.length === 0 && <p className="p-4 text-[15px] text-ink-2">No paper matches.</p>}
      <ul>
        {shown.map((d) => (
          <li key={d.id} className="border-t border-line first:border-t-0" data-doc={d.documentId ?? d.id}>
            <details className="group">
              <summary className="flex min-h-12 cursor-pointer list-none flex-col gap-1 px-3 py-2.5 hover:bg-fill sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{d.label} <span className="tag">{d.original ? "Original" : "Copy"}</span></span>
                  <span className="block text-[13px] text-ink-2">
                    {d.documentId ? <span className="mono">{d.documentId}</span> : "No Document ID yet"}{d.txnName ? ` · ${d.txnName}` : ""}
                  </span>
                </span>
                <span className="min-w-0 text-[13px] sm:w-80 sm:text-right">
                  <span className="block font-semibold text-navy">{d.holder}</span>
                  <span className="block text-ink-2">{d.place ? `${d.place} · ` : ""}since {d.sinceText}</span>
                </span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-line bg-fill px-3 py-3 sm:px-4">
                {d.trail.length === 0 ? <p className="text-[13px] text-ink-2">No hand-overs recorded yet.</p> : (
                  <ol aria-label={`Custody trail of ${d.label}`} className="relative flex flex-col gap-2.5 border-l-2 border-line pl-4">
                    {d.trail.map((m) => (
                      <li key={m.id} className="relative text-[13px]">
                        <span aria-hidden="true" className={`absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full ${m.ack ? "bg-ok-fg" : "bg-navy"}`} />
                        <p className="font-semibold text-ink">
                          {m.label}
                          {m.simulated && <span className="chip c-act ml-2 h-5 text-[11px]">Simulated</span>}
                        </p>
                        <p className="text-ink-2">{m.when}{m.by ? ` · by ${m.by}` : ""}{m.place ? ` · ${m.place}` : ""}</p>
                        {m.ack && <p className="text-ok-fg">Acknowledged by {m.ack}</p>}
                        {m.remarks && <p className="text-ink-2">{m.remarks}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {d.periods.length > 0 && (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="table whitespace-nowrap bg-white">
                      <caption className="sr-only">Time held by each holder</caption>
                      <thead><tr><th scope="col">Holder</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Time held</th></tr></thead>
                      <tbody>
                        {d.periods.map((p, i) => (
                          <tr key={i}><td>{p.holder}{p.place ? <span className="block text-xs text-ink-2">{p.place}</span> : null}</td><td>{p.from}</td><td>{p.to ?? "Now"}</td><td>{p.held}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
