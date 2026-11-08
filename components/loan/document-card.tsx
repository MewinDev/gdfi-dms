import Link from "next/link";
import { elapsed, fmtDateTime } from "@/lib/time";

const NEXT_STEP: Record<string, string> = {
  EXPECTED: "LA confirms it is physically present (checklist)",
  AT_BRANCH: "Hand over to the DP, or transmit to the Vault",
  IN_TRANSIT: "Receiver acknowledges by scan",
  WITH_DP: "DP processes and forwards to the branch",
  IN_SAFEKEEPING: "Stays in the vault until pull-out or release",
  PULLED_OUT: "Return to the vault by the expected date",
  RELEASED: "None (released)",
  LOST: "Replacement and QA finding",
  DISPOSED: "None (disposed)",
};

export const DOC_STAGE_LABEL: Record<string, string> = {
  EXPECTED: "Expected",
  AT_BRANCH: "At branch",
  IN_TRANSIT: "In transit",
  WITH_DP: "With DP",
  IN_SAFEKEEPING: "In safekeeping",
  PULLED_OUT: "Pulled out",
  RELEASED: "Released",
  LOST: "Lost",
  DISPOSED: "Disposed",
};

export interface DocCardData {
  documentId: string | null;
  label: string;
  stage: string;
  custodianLabel: string;
  location: string;
  since: Date;
  originality: string;
  pn: string;
  borrowerName?: string;
}

/** Answers: Where is it? Who has it, and since when? What is the next step? How long has it been there? */
export function DocumentCard({ d }: { d: DocCardData }) {
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="mono font-semibold text-navy">{d.documentId ?? "No Document ID yet"}</p>
          <p className="text-sm">
            {d.label} <span className="text-ink-2">({d.originality === "ORIGINAL" ? "original" : "copy"})</span>
          </p>
        </div>
        <span className="chip bg-chip-sys">{DOC_STAGE_LABEL[d.stage] ?? d.stage}</span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold text-ink-2">Where is it?</dt><dd>{d.location || "Not yet received"}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-2">Who has it, since when?</dt><dd>{d.custodianLabel}, since {fmtDateTime(d.since)}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-2">Next step</dt><dd>{NEXT_STEP[d.stage] ?? "-"}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-2">How long there?</dt><dd>{elapsed(d.since)}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-ink-2">
        Loan File <Link className="font-semibold text-navy underline" href={`/loans/${d.pn}?tab=documents`}>{d.pn}</Link>
        {d.borrowerName ? ` · ${d.borrowerName}` : ""}
      </p>
    </article>
  );
}
