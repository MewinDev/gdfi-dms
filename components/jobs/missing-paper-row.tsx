import { WarningIcon } from "@/components/ui/icons";

/** A paper the Loan Associate marked Missing with remarks, as the processor's paper lists show it. */
export interface MissingPaperLine {
  label: string;
  documentId: string | null;
  reason: string | null;
  remarks: string | null;
  /** "LA Antipolo · Nov 11, 2026, 6:18 PM PHT". */
  byText: string;
}

/**
 * One row of the processor's paper list for a missing paper: an amber warning icon where the tick box
 * would be (nothing to tick), the Missing chip where Original or Copy goes, then the reason and remarks
 * and who marked it, lined up with the title. The Document ID sits on the right from 1024 px, under the
 * reason line below that. No hooks: it renders in the server page and in the review form alike.
 */
export function MissingPaperRow({ p, as: Tag = "li" }: { p: MissingPaperLine; as?: "li" | "div" }) {
  return (
    <Tag className="flex min-h-11 flex-col justify-center gap-0.5 border-b border-l-[3px] border-line border-l-act-fg bg-act-bg py-2 pl-[9px] pr-3 last:border-b-0" data-missing-paper="MISSING">
      <div className="flex flex-wrap items-center gap-2">
        <span role="img" aria-label="Missing, with remarks" className="flex h-5 w-5 shrink-0 items-center justify-center text-act-fg" data-missing-icon>
          <WarningIcon size={18} />
        </span>
        <span className="min-w-0 flex-1 text-[15px]">{p.label} <span className="tag bg-white text-act-fg ring-1 ring-act-line" data-missing-chip>Missing</span></span>
        {p.documentId && <span className="mono hidden text-xs text-ink-2 lg:inline">{p.documentId}</span>}
      </div>
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="text-[13px] text-ink" data-missing-reason><strong className="font-semibold">{p.reason ?? "No reason"}</strong>{p.remarks ? ` · ${p.remarks}` : ""}</p>
        <p className="text-xs text-ink-2" data-missing-by>{p.byText}</p>
        {p.documentId && <p className="mono text-xs text-ink-2 lg:hidden">{p.documentId}</p>}
      </div>
    </Tag>
  );
}

/** "4 of 5 papers · 1 missing with remarks". */
export const paperCountText = (present: number, missing: number) =>
  `${present} of ${present + missing} paper${present + missing === 1 ? "" : "s"}${missing ? ` · ${missing} missing with remarks` : ""}`;

export const MISSING_NOTE = "Papers marked Missing by the Loan Associate go through as exceptions. They are not a reason to return the file.";
