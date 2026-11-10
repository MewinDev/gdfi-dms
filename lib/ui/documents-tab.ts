/**
 * The Documents tab's words (one compact line per paper). Pure, so the server, the browser and the
 * unit tests say the same thing. Nothing here changes a paper, a label code or custody: it only says
 * where a paper is in one short phrase, and the custody sentence for the row's details line.
 */
import { fmtShort } from "@/lib/time";

export interface PaperLike {
  stage: string;
  location: string;
  custodianLabel: string;
  since: Date;
  documentId: string | null;
  labelPrintedAt?: Date | null;
}

/** The filter above the cards (?papers=with-you). */
export type PapersFilter = "all" | "with-you" | "not-yet";
export const PAPERS_FILTERS: { key: PapersFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "with-you", label: "With you" }, { key: "not-yet", label: "Not yet" },
];
export const papersFilterOf = (raw: string | undefined): PapersFilter => (raw === "with-you" || raw === "not-yet" ? raw : "all");

/** Where a paper is, in one short phrase: With you (at the branch), Not yet (expected), or its place. */
export type WhereKind = "with-you" | "not-yet" | "other";
export function whereOf(d: Pick<PaperLike, "stage" | "custodianLabel">): { kind: WhereKind; text: string } {
  const who = d.custodianLabel.replace(/\s*\(.*\)\s*$/, "").trim();
  switch (d.stage) {
    case "AT_BRANCH": return { kind: "with-you", text: "With you" };
    case "EXPECTED": return { kind: "not-yet", text: "Not yet" };
    case "IN_TRANSIT": return { kind: "other", text: "On the way" };
    case "WITH_DP": return { kind: "other", text: who ? `At ${who}` : "At the processor" };
    case "IN_SAFEKEEPING": return { kind: "other", text: "In the vault" };
    case "PULLED_OUT": return { kind: "other", text: "Pulled out" };
    case "RELEASED": return { kind: "other", text: "Released" };
    case "LOST": return { kind: "other", text: "Lost" };
    case "DISPOSED": return { kind: "other", text: "Disposed" };
    default: return { kind: "other", text: d.stage.charAt(0) + d.stage.slice(1).toLowerCase().replace(/_/g, " ") };
  }
}

/** The role word said once ("DP DP 1" → "DP 1"). */
const once = (s: string) => s.replace(/\b(LA|DP)\s+\1\b/g, "$1");

/**
 * The custody sentence for the row's details line and tooltip, in Philippine time (not "ago"):
 * "LA 1 (LA, Antipolo) at the Antipolo branch, since Nov 10, 12:10 AM", plus when the label was printed.
 */
export function custodyLine(d: PaperLike): string {
  if (d.stage === "EXPECTED") return "Not with you yet: it is on the checklist and has not been ticked.";
  const place = d.stage === "AT_BRANCH"
    ? `at the ${d.location || "branch"}`
    : d.location ? `· ${once(d.location)}` : "";
  const printed = d.documentId ? (d.labelPrintedAt ? ` Label printed ${fmtShort(d.labelPrintedAt)}.` : " Label not printed yet.") : "";
  return `${once(d.custodianLabel)}${place ? ` ${place}` : ""}, since ${fmtShort(d.since)}.${printed}`;
}

/** "6 of 7 with you". */
export function countText(docs: Pick<PaperLike, "stage">[]): string {
  return `${docs.filter((d) => d.stage === "AT_BRANCH").length} of ${docs.length} with you`;
}

/** The papers the filter shows. */
export function filterPapers<T extends Pick<PaperLike, "stage">>(docs: T[], f: PapersFilter): T[] {
  if (f === "with-you") return docs.filter((d) => whereOf({ stage: d.stage, custodianLabel: "" }).kind === "with-you");
  if (f === "not-yet") return docs.filter((d) => whereOf({ stage: d.stage, custodianLabel: "" }).kind === "not-yet");
  return docs;
}

/** How many papers each filter shows (for the counts on the filter). */
export function filterCounts(docs: Pick<PaperLike, "stage">[]): Record<PapersFilter, number> {
  return { all: docs.length, "with-you": filterPapers(docs, "with-you").length, "not-yet": filterPapers(docs, "not-yet").length };
}

/** The label code without the PN in front ("GD1652026901003-CHM-01" → "CHM-01"); the full code is in the tooltip. */
export const shortCode = (documentId: string, pn: string) => (documentId.startsWith(`${pn}-`) ? documentId.slice(pn.length + 1) : documentId);

/** The empty message when a filter shows nothing. */
export function emptyText(f: PapersFilter): string {
  return f === "not-yet" ? "All papers are with you." : f === "with-you" ? "No papers are with you yet." : "No papers yet.";
}
