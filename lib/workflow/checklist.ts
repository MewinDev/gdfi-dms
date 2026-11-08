/**
 * Checklist completeness (pure; used by the server rule and by the screen).
 *
 * - Every line is Required or Optional (the `required` flag copied onto the loan file's line).
 * - A required pick-one group ("Proof of sale": Deed of Sale or Sales Invoice) counts as ONE
 *   required paper: at least one line in the group must be ticked.
 * - Optional lines never block anything.
 * - Lines whose rule was switched off (inactive) are ignored, as before.
 */

export interface CheckLine {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
  /** Pick-one group name, or null for a single line. */
  group: string | null;
  active: boolean;
}

export interface MissingPaper {
  /** Plain name shown in "Still needed: ...". */
  name: string;
  /** Lines to scroll to (one, or every line of a pick-one group). */
  lineIds: string[];
}

export interface ChecklistStatus {
  complete: boolean;
  missing: MissingPaper[];
  requiredTotal: number;
  requiredDone: number;
  optionalTotal: number;
  optionalDone: number;
}

export function checklistStatus(lines: CheckLine[]): ChecklistStatus {
  const live = lines.filter((l) => l.active);
  const missing: MissingPaper[] = [];
  let requiredTotal = 0;
  let requiredDone = 0;

  for (const l of live) {
    if (!l.required || l.group) continue;
    requiredTotal++;
    if (l.checked) requiredDone++;
    else missing.push({ name: l.label, lineIds: [l.id] });
  }

  const groups = new Map<string, CheckLine[]>();
  for (const l of live) {
    if (!l.required || !l.group) continue;
    groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  }
  for (const [g, members] of groups) {
    requiredTotal++;
    if (members.some((m) => m.checked)) requiredDone++;
    else missing.push({ name: `${g} (${members.map((m) => m.label).join(" or ")})`, lineIds: members.map((m) => m.id) });
  }

  const optional = live.filter((l) => !l.required);
  return {
    complete: missing.length === 0,
    missing,
    requiredTotal,
    requiredDone,
    optionalTotal: optional.length,
    optionalDone: optional.filter((l) => l.checked).length,
  };
}

/** "Still needed: A, B." */
export function stillNeededText(missing: { name: string }[]): string {
  return `Still needed: ${missing.map((m) => m.name).join(", ")}.`;
}
