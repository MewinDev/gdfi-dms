/**
 * Checklist completeness (pure; used by the server rule and by the screen).
 *
 * Confirmed rule (missing papers with reasons):
 * - Every line is Required or Optional (the `required` flag copied onto the loan file's line).
 * - A required paper is Present (ticked) or Missing. Missing needs a reason and remarks saved for that
 *   paper; then the file can still go on ("an exception"). Received late counts as Present.
 * - An optional paper counts only when "Include in this file" is ticked (or it is ticked Present or
 *   marked Missing, which includes it). Included, it behaves exactly like a required paper; not
 *   included, it is ignored (nothing expects it, it needs no remarks).
 * - A required pick-one group ("Proof of sale": Deed of Sale or Sales Invoice) counts as ONE required
 *   paper: one line Present, or (none present) a line marked Missing with remarks.
 * - Lines whose rule was switched off (inactive) are ignored, as before.
 * The gate (`complete`): no expected paper is still unanswered, and every missing one has remarks.
 */

export type MissingState = "MISSING" | "RECEIVED_LATE";

export interface CheckLine {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
  /** Pick-one group name, or null for a single line. */
  group: string | null;
  active: boolean;
  /** Null: Present (checked) or not answered yet. */
  missing?: MissingState | null;
  /** The reason and remarks of a Missing paper are saved. */
  remarksSaved?: boolean;
  /** Optional papers: "Include in this file" is ticked. */
  included?: boolean;
}

export interface MissingPaper {
  /** Plain name shown in "Still needed: ..." and "Add remarks for: ...". */
  name: string;
  /** Lines to scroll to (one, or every line of a pick-one group). */
  lineIds: string[];
}

export interface ChecklistStatus {
  /** May go on (Send, EDST, Mark as done): nothing still needed, every missing paper has remarks. */
  complete: boolean;
  /** Expected papers neither Present nor marked Missing ("Still needed"). */
  missing: MissingPaper[];
  /** Marked Missing without saved remarks: blocks until the remarks are saved. */
  needsRemarks: MissingPaper[];
  /** Marked Missing with remarks: the file goes on, shown as an exception. */
  exceptions: MissingPaper[];
  /** Required papers (a pick-one group is one): done = Present, or Missing with remarks. */
  requiredTotal: number;
  requiredDone: number;
  /** Optional papers, and how many are included in this file. */
  optionalTotal: number;
  optionalDone: number;
  /** Every expected paper (required, and optional ones included): for the "tick" step. */
  expectedTotal: number;
  expectedDone: number;
}

/** An optional line is part of the file when included, ticked, or marked Missing. */
export const isIncluded = (l: Pick<CheckLine, "required" | "checked" | "missing" | "included">) =>
  l.required || !!l.included || l.checked || !!l.missing;

/** Present (ticked, also when it arrived late), Missing with remarks, Missing without, or not answered. */
type Answer = "present" | "exception" | "needsRemarks" | "open";
function answerOf(l: CheckLine): Answer {
  if (l.checked) return "present";
  if (l.missing === "MISSING") return l.remarksSaved ? "exception" : "needsRemarks";
  return "open";
}

export function checklistStatus(lines: CheckLine[]): ChecklistStatus {
  const live = lines.filter((l) => l.active);
  const out = { missing: [] as MissingPaper[], needsRemarks: [] as MissingPaper[], exceptions: [] as MissingPaper[] };
  let requiredTotal = 0, requiredDone = 0, expectedTotal = 0, expectedDone = 0;
  const count = (a: Answer, name: string, lineIds: string[], required: boolean) => {
    expectedTotal++;
    if (required) requiredTotal++;
    if (a === "present" || a === "exception") { expectedDone++; if (required) requiredDone++; }
    if (a === "exception") out.exceptions.push({ name, lineIds });
    if (a === "needsRemarks") out.needsRemarks.push({ name, lineIds });
    if (a === "open") out.missing.push({ name, lineIds });
  };

  for (const l of live) {
    if (l.group && l.required) continue;
    if (!isIncluded(l)) continue;
    count(answerOf(l), l.label, [l.id], l.required);
  }

  const groups = new Map<string, CheckLine[]>();
  for (const l of live) {
    if (!l.required || !l.group) continue;
    groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  }
  for (const [g, members] of groups) {
    const answers = members.map(answerOf);
    const name = `${g} (${members.map((m) => m.label).join(" or ")})`;
    // One line present answers the group; otherwise a missing line decides (with or without remarks).
    const a: Answer = answers.includes("present") ? "present" : answers.includes("needsRemarks") ? "needsRemarks" : answers.includes("exception") ? "exception" : "open";
    const ids = a === "needsRemarks" || a === "exception" ? members.filter((m) => m.missing === "MISSING").map((m) => m.id) : members.map((m) => m.id);
    count(a, a === "open" ? name : members.filter((m) => m.missing === "MISSING").map((m) => m.label).join(", "), ids, true);
  }

  const optional = live.filter((l) => !l.required);
  return {
    complete: out.missing.length === 0 && out.needsRemarks.length === 0,
    ...out,
    requiredTotal,
    requiredDone,
    optionalTotal: optional.length,
    optionalDone: optional.filter(isIncluded).length,
    expectedTotal,
    expectedDone,
  };
}

/** "Still needed: A, B." */
export function stillNeededText(missing: { name: string }[]): string {
  return `Still needed: ${missing.map((m) => m.name).join(", ")}.`;
}

/** "Add remarks for: Deed of Sale, Valid ID" (the papers marked Missing without saved remarks). */
export function addRemarksText(needsRemarks: { name: string }[]): string {
  return `Add remarks for: ${needsRemarks.map((m) => m.name).join(", ")}`;
}

/** Why it cannot go on yet, in one or two plain sentences (null: it can). */
export function blockText(s: Pick<ChecklistStatus, "missing" | "needsRemarks">): string | null {
  const parts = [s.missing.length ? `${stillNeededText(s.missing)} Mark each one Present or Missing.` : "", s.needsRemarks.length ? `${addRemarksText(s.needsRemarks)}.` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Remarks of a missing paper: 5 to 500 characters (the same rule as the server and the database). */
export const REMARKS_MIN = 5;
export const REMARKS_MAX = 500;
export function remarksProblem(raw: string): string | null {
  const t = raw.trim();
  if (t.length < REMARKS_MIN) return `Write the remarks (at least ${REMARKS_MIN} characters).`;
  if (t.length > REMARKS_MAX) return `Keep the remarks to ${REMARKS_MAX} characters or fewer.`;
  return null;
}
