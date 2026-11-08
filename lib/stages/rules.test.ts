import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWN_STAGES, DEFAULT_SYSTEM_STAGES, checkEvidence, currentIndex, evidenceSummary, fieldKey, fieldsFromText, fieldsToText, planStages, stepStates,
  type EvidenceField, type StageKind,
} from "./rules";

const st = (code: string, kind: StageKind, sortOrder: number, active = true) => ({ code, kind, sortOrder, active });

describe("planStages", () => {
  const all = [st("VERIFY", "VERIFY", 1002), st("LTO-PICKUP", "LTO_PICKUP", 1001), st("B", "OWN", 2), st("LTO-DROP", "LTO_DROP", 1000), st("A", "OWN", 1), st("OLD", "OWN", 0, false)];
  it("own stages in order, then LTO drop off and pickup, then Check and verify last", () => {
    expect(planStages(all, true).map((s) => s.code)).toEqual(["A", "B", "LTO-DROP", "LTO-PICKUP", "VERIFY"]);
  });
  it("without Needs LTO processing the LTO stages are left out; Check and verify stays", () => {
    expect(planStages(all, false).map((s) => s.code)).toEqual(["A", "B", "VERIFY"]);
  });
  it("inactive stages are skipped (Check and verify too, when Admin made it inactive)", () => {
    expect(planStages([st("VERIFY", "VERIFY", 1002, false), st("A", "OWN", 1)], true).map((s) => s.code)).toEqual(["A"]);
  });
});

describe("proposed defaults", () => {
  it("Notary: Notarization with the old Complete fields; PPSR registration; Mortgage none of its own", () => {
    expect(DEFAULT_OWN_STAGES.NOTARY.map((s) => s.name)).toEqual(["Notarization"]);
    expect(DEFAULT_OWN_STAGES.NOTARY[0].fields.map((f) => f.key)).toEqual(["name", "docNo", "pageNo", "bookNo", "series"]);
    expect(DEFAULT_OWN_STAGES.PPSR[0].fields.map((f) => `${f.label}:${f.type}`)).toEqual(["Filed on:date", "Registered on:date", "Registration number:text", "Certificate:file"]);
    expect(DEFAULT_OWN_STAGES.MORTGAGE).toEqual([]);
    expect(DEFAULT_SYSTEM_STAGES.map((s) => s.name)).toEqual(["LTO drop off", "LTO pickup", "Check and verify"]);
    expect(DEFAULT_SYSTEM_STAGES[2].fields).toEqual([]);
  });
});

describe("stepper", () => {
  it("Done, Now (first not done) and Later; stages run in order", () => {
    const rows = [{ status: "DONE" as const }, { status: "STARTED" as const }, { status: "LATER" as const }];
    expect(stepStates(rows)).toEqual(["done", "now", "later"]);
    expect(currentIndex(rows)).toBe(1);
    expect(currentIndex([{ status: "DONE" as const }])).toBe(-1);
  });
});

describe("checkEvidence", () => {
  const fields: EvidenceField[] = [
    { key: "droppedAt", label: "Dropped on", type: "date", required: true },
    { key: "orNumber", label: "Official receipt number", type: "text", required: true },
    { key: "fee", label: "Fee", type: "number", required: false },
    { key: "annotated", label: "Annotated OR/CR received", type: "tick", required: true },
    { key: "cert", label: "Certificate", type: "file", required: true },
  ];
  const ok = { droppedAt: "2026-11-06", orNumber: " OR-1 ", fee: "1,500", annotated: "on", cert: { key: "k.pdf", name: "cert.pdf" } };
  it("accepts complete evidence and cleans it", () => {
    expect(checkEvidence(fields, ok, "2026-11-08")).toEqual({ ok: true, values: { droppedAt: "2026-11-06", orNumber: "OR-1", fee: 1500, annotated: true, cert: { key: "k.pdf", name: "cert.pdf" } } });
  });
  it.each([
    [{ orNumber: "" }, "orNumber", "Official receipt number is required."],
    [{ droppedAt: "2026-02-30" }, "droppedAt", "Dropped on: pick a date."],
    [{ droppedAt: "2026-11-09" }, "droppedAt", "Dropped on cannot be in the future."],
    [{ annotated: "" }, "annotated", 'Tick "Annotated OR/CR received".'],
    [{ cert: undefined }, "cert", "Certificate: attach the file."],
    [{ fee: "abc" }, "fee", "Fee must be a number."],
  ])("refuses %o", (over, field, error) => {
    expect(checkEvidence(fields, { ...ok, ...over }, "2026-11-08")).toEqual({ ok: false, field, error });
  });
  it("an optional field may be blank", () => {
    const r = checkEvidence(fields, { ...ok, fee: "" }, "2026-11-08");
    expect(r.ok && "fee" in r.values).toBe(false);
  });
});

describe("evidence fields as text (Import / Export) and keys", () => {
  it("round trip; existing keys are kept by label", () => {
    const existing: EvidenceField[] = [{ key: "name", label: "Notary name", type: "text", required: true }];
    const r = fieldsFromText("Notary name:text:required; Signed on:date:optional", existing);
    expect(r).toEqual({ ok: true, fields: [existing[0], { key: "signedOn", label: "Signed on", type: "date", required: false }] });
    expect(fieldsToText(r.ok ? r.fields : [])).toBe("Notary name:text:required; Signed on:date:optional");
  });
  it("refuses an unknown type or a missing label, in plain words", () => {
    expect(fieldsFromText("Paid:money:required")).toEqual({ ok: false, error: '"Paid": the type must be text, date, number, file or tick.' });
    expect(fieldsFromText(":text:required")).toMatchObject({ ok: false });
  });
  it("keys are unique within a stage", () => {
    expect(fieldKey("Signed on", ["signedOn"])).toBe("signedOn2");
  });
  it("the summary shows file names, never file contents or keys", () => {
    const f: EvidenceField[] = [{ key: "cert", label: "Certificate", type: "file", required: true }, { key: "ok", label: "Annotated", type: "tick", required: true }];
    expect(evidenceSummary(f, { cert: { key: "secret-key.pdf", name: "cert.pdf" }, ok: true })).toBe("Certificate: cert.pdf · Annotated: yes");
  });
});
