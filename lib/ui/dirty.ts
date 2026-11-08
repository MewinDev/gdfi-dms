/**
 * "Unsaved changes" check for the Settings and Users pop-ups. Pure: compares the values a form had
 * when it opened with its values now. List steps and read-only pop-ups have no tracked form, so they
 * are never dirty. An import counts as unsaved when a file was chosen or checked but not imported.
 */

export type FormValues = [name: string, value: string][];

/** Values as a stable signature (order kept; repeated names such as checkboxes count). */
export const signature = (values: FormValues) => JSON.stringify(values);

/** Field names whose values differ (added, removed or changed), in first-seen order. */
export function changedFields(initial: FormValues, current: FormValues): string[] {
  const group = (v: FormValues) => {
    const m = new Map<string, string[]>();
    for (const [k, val] of v) m.set(k, [...(m.get(k) ?? []), val]);
    return m;
  };
  const a = group(initial);
  const b = group(current);
  const names = [...new Set([...a.keys(), ...b.keys()])];
  return names.filter((n) => JSON.stringify([...(a.get(n) ?? [])].sort()) !== JSON.stringify([...(b.get(n) ?? [])].sort()));
}

export interface DirtyInput {
  /** Tracked forms on screen: values when opened and now. */
  forms: { initial: FormValues; current: FormValues }[];
  /** Import step: a file was chosen or checked but not imported. */
  importPending?: boolean;
}

export type DirtyResult = { dirty: false } | { dirty: true; kind: "form"; changed: string[] } | { dirty: true; kind: "import" };

export function dirtyState(input: DirtyInput): DirtyResult {
  if (input.importPending) return { dirty: true, kind: "import" };
  const changed = input.forms.flatMap((f) => changedFields(f.initial, f.current));
  return changed.length ? { dirty: true, kind: "form", changed: [...new Set(changed)] } : { dirty: false };
}

export const DISCARD_BODY = {
  form: "You changed something that is not saved yet. If you leave now, those changes will be lost.",
  import: "You chose a file but have not imported it. If you leave now, nothing will be imported.",
} as const;
