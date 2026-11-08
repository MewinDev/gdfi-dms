/**
 * Processing stages: pure rules (no database). Used by the service, the seed, Settings, Import and tests.
 *
 * A transaction type that needs a processor has an ordered list of stages:
 *   its own stages (OWN, in Settings order), then LTO drop off and LTO pickup (only while the type has
 *   "Needs LTO processing" on), then Check and verify (always last).
 * Proposed defaults below: to be confirmed with Collateral and Mortgage; all are editable in Settings.
 */

export const FIELD_TYPES = ["text", "date", "number", "file", "tick"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABEL: Record<FieldType, string> = { text: "Text", date: "Date", number: "Number", file: "File", tick: "Tick (yes)" };

export interface EvidenceField { key: string; label: string; type: FieldType; required: boolean }
export type StageKind = "OWN" | "LTO_DROP" | "LTO_PICKUP" | "VERIFY";

export interface StageDef {
  code: string;
  name: string;
  kind: StageKind;
  sortOrder: number;
  fields: EvidenceField[];
  targetDays: number | null;
  active: boolean;
}

/** System stages always come after the type's own stages, in this order. */
export const SYSTEM_ORDER: Record<Exclude<StageKind, "OWN">, number> = { LTO_DROP: 1000, LTO_PICKUP: 1001, VERIFY: 1002 };
export const KIND_LABEL: Record<StageKind, string> = {
  OWN: "Own stage", LTO_DROP: "Added when Needs LTO processing is on", LTO_PICKUP: "Added when Needs LTO processing is on", VERIFY: "Always last",
};

const f = (key: string, label: string, type: FieldType, required = true): EvidenceField => ({ key, label, type, required });

/** Proposed defaults. Notary and PPSR reuse the fields of the old "Complete" step. */
export const DEFAULT_OWN_STAGES: Record<string, Omit<StageDef, "active" | "targetDays">[]> = {
  NOTARY: [{ code: "NOTARIZATION", name: "Notarization", kind: "OWN", sortOrder: 1, fields: [f("name", "Notary name", "text"), f("docNo", "Document", "text"), f("pageNo", "Page number", "text"), f("bookNo", "Book number", "text"), f("series", "Series", "text")] }],
  PPSR: [{ code: "PPSR-REG", name: "PPSR registration", kind: "OWN", sortOrder: 1, fields: [f("filedOn", "Filed on", "date"), f("registrationDate", "Registered on", "date"), f("registrationNo", "Registration number", "text"), f("certificate", "Certificate", "file")] }],
  MORTGAGE: [],
};

export const DEFAULT_SYSTEM_STAGES: Omit<StageDef, "active" | "targetDays">[] = [
  { code: "LTO-DROP", name: "LTO drop off", kind: "LTO_DROP", sortOrder: SYSTEM_ORDER.LTO_DROP, fields: [f("droppedAt", "Dropped on", "date"), f("office", "LTO office", "text"), f("orNumber", "Official receipt number", "text")] },
  { code: "LTO-PICKUP", name: "LTO pickup", kind: "LTO_PICKUP", sortOrder: SYSTEM_ORDER.LTO_PICKUP, fields: [f("pickedUpAt", "Picked up on", "date"), f("annotatedOrCr", "Annotated OR/CR received", "tick")] },
  // Evidence is the checklist of every paper ("Received back and complete"), plus an optional note.
  { code: "VERIFY", name: "Check and verify", kind: "VERIFY", sortOrder: SYSTEM_ORDER.VERIFY, fields: [] },
];

/** The stages a job of this type runs, in order: active own stages, LTO stages when the type needs LTO, then Check and verify. */
export function planStages<T extends { kind: StageKind; sortOrder: number; active: boolean }>(stages: T[], needsLto: boolean): T[] {
  const rank = (s: T) => (s.kind === "OWN" ? 0 : SYSTEM_ORDER[s.kind]);
  return stages
    .filter((s) => s.active && (s.kind === "OWN" || s.kind === "VERIFY" || needsLto))
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder);
}

/** Stepper states: Done, Now (the first one not done) and Later. */
export type StepState = "done" | "now" | "later";
export function stepStates(rows: { status: "LATER" | "STARTED" | "DONE" }[]): StepState[] {
  const first = rows.findIndex((r) => r.status !== "DONE");
  return rows.map((r, i) => (r.status === "DONE" ? "done" : i === first ? "now" : "later"));
}

/** The stage that may start or finish now: the first one not done (stages run in order). */
export function currentIndex(rows: { status: "LATER" | "STARTED" | "DONE" }[]): number {
  return rows.findIndex((r) => r.status !== "DONE");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: string) => ISO.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/**
 * Checks evidence against the stage's fields (server and screen). Values come as strings (a form);
 * a file is already stored and given as { key, name }. Returns the cleaned values or the first problem.
 */
export function checkEvidence(
  fields: EvidenceField[],
  raw: Record<string, unknown>,
  today: string,
): { ok: true; values: Record<string, unknown> } | { ok: false; field: string; error: string } {
  const values: Record<string, unknown> = {};
  for (const fd of fields) {
    const v = raw[fd.key];
    if (fd.type === "tick") {
      const on = v === true || v === "on" || v === "true" || v === "yes";
      if (fd.required && !on) return { ok: false, field: fd.key, error: `Tick "${fd.label}".` };
      values[fd.key] = on;
      continue;
    }
    if (fd.type === "file") {
      const file = v && typeof v === "object" && "key" in (v as object) ? (v as { key: string; name: string }) : null;
      const text = typeof v === "string" ? v.trim() : "";
      if (fd.required && !file && !text) return { ok: false, field: fd.key, error: `${fd.label}: attach the file.` };
      if (file) values[fd.key] = { key: file.key, name: file.name, ...("mime" in file ? { mime: (file as { mime?: string }).mime } : {}) };
      continue;
    }
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    if (!s) {
      if (fd.required) return { ok: false, field: fd.key, error: `${fd.label} is required.` };
      continue;
    }
    if (s.length > 200) return { ok: false, field: fd.key, error: `${fd.label} is too long.` };
    if (fd.type === "date") {
      if (!realDate(s)) return { ok: false, field: fd.key, error: `${fd.label}: pick a date.` };
      if (s > today) return { ok: false, field: fd.key, error: `${fd.label} cannot be in the future.` };
    }
    if (fd.type === "number" && !Number.isFinite(Number(s.replace(/,/g, "")))) return { ok: false, field: fd.key, error: `${fd.label} must be a number.` };
    values[fd.key] = fd.type === "number" ? Number(s.replace(/,/g, "")) : s;
  }
  return { ok: true, values };
}

/** A key for a new evidence field, from its label, unique within the stage. */
export function fieldKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("").slice(0, 30) || "field";
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}${i}`;
  return k;
}

/** Evidence fields in a file (Import / Export): "Label:type:required; Label:type:optional". */
export function fieldsToText(fields: EvidenceField[]): string {
  return fields.map((x) => `${x.label}:${x.type}:${x.required ? "required" : "optional"}`).join("; ");
}
export function fieldsFromText(text: string, existing: EvidenceField[] = []): { ok: true; fields: EvidenceField[] } | { ok: false; error: string } {
  const parts = text.split(";").map((p) => p.trim()).filter(Boolean);
  const out: EvidenceField[] = [];
  for (const p of parts) {
    const [label, type = "text", req = "required"] = p.split(":").map((x) => x.trim());
    if (!label) return { ok: false, error: `"${p}": the label is missing.` };
    if (!(FIELD_TYPES as readonly string[]).includes(type.toLowerCase())) return { ok: false, error: `"${label}": the type must be text, date, number, file or tick.` };
    if (!["required", "optional"].includes(req.toLowerCase())) return { ok: false, error: `"${label}": write required or optional.` };
    const old = existing.find((e) => e.label.toLowerCase() === label.toLowerCase());
    out.push({ key: old?.key ?? fieldKey(label, [...existing.map((e) => e.key), ...out.map((o) => o.key)]), label, type: type.toLowerCase() as FieldType, required: req.toLowerCase() === "required" });
  }
  return { ok: true, fields: out };
}

/** A short evidence summary for the Journey (never file contents: the file name only). */
export function evidenceSummary(fields: EvidenceField[], evidence: Record<string, unknown> | null | undefined): string {
  if (!evidence) return "";
  const parts: string[] = [];
  for (const fd of fields) {
    const v = evidence[fd.key];
    if (v === undefined || v === null || v === "") continue;
    if (fd.type === "tick") parts.push(`${fd.label}: ${v ? "yes" : "no"}`);
    else if (fd.type === "file") parts.push(`${fd.label}: ${typeof v === "object" ? (v as { name?: string }).name ?? "file" : String(v)}`);
    else parts.push(`${fd.label}: ${String(v)}`);
  }
  return parts.join(" · ");
}
