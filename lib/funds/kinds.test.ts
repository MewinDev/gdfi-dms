import { describe, expect, it } from "vitest";
import {
  amountModeText, checkKindAmount, codeFromName, kindNameProblem, kindOptions, kindText, lineAmountSource, nameKey, otherDescriptionProblem, otherSuggestions,
  presetWas, sortKinds, sourceHint, startingAmount, type KindLike,
} from "./kinds";

const k = (code: string, name: string, extra: Partial<KindLike> = {}): KindLike => ({ code, name, active: true, sortOrder: 1, amountMode: "TYPED", amountCents: null, ...extra });

describe("kind names", () => {
  it("needs 2 to 40 characters", () => {
    expect(kindNameProblem("")).toMatch(/Type the name/);
    expect(kindNameProblem(" a ")).toMatch(/at least 2/);
    expect(kindNameProblem("x".repeat(41))).toMatch(/at most 40/);
    expect(kindNameProblem("  Photo   copy ")).toBeNull();
  });
  it("is unique ignoring case and spaces", () => {
    expect(nameKey("Photo Copy")).toBe(nameKey("photocopy"));
    expect(nameKey(" COURIER ")).toBe("courier");
  });
  it("makes a unique code from the name", () => {
    expect(codeFromName("Photo copy", [])).toBe("PHOTO_COPY");
    expect(codeFromName("Other", ["OTHER"])).toBe("OTHER_2");
    expect(codeFromName("2GO courier", [])).toBe("K_2GO_COURIER");
  });
});

describe("Other description", () => {
  it("needs 3 to 60 characters with words", () => {
    expect(otherDescriptionProblem("")).toMatch(/Say what this expense is/);
    expect(otherDescriptionProblem("  ab ")).toMatch(/at least 3/);
    expect(otherDescriptionProblem("x".repeat(61))).toMatch(/60 characters/);
    expect(otherDescriptionProblem("12345")).toMatch(/in words/);
    expect(otherDescriptionProblem("!!!---")).toMatch(/in words/);
    expect(otherDescriptionProblem(" Courier ")).toBeNull();
    expect(otherDescriptionProblem("Parking 2h")).toBeNull();
  });
  it("shows next to the kind, and old rows say not described", () => {
    expect(kindText("OTHER", "Other", "Courier")).toBe("Other: Courier");
    expect(kindText("OTHER", "Other", "")).toBe("Other (not described)");
    expect(kindText("NOTARY_FEE", "Notary fee", "ignored")).toBe("Notary fee");
  });
});

describe("order and options", () => {
  it("keeps Other last and hides inactive kinds unless already on the record", () => {
    const list = [k("OTHER", "Other", { sortOrder: 0, builtIn: true }), k("B", "B", { sortOrder: 2 }), k("A", "A", { sortOrder: 1 }), k("Z", "Zed", { active: false, sortOrder: 3 })];
    expect(sortKinds(list).map((x) => x.code)).toEqual(["A", "B", "Z", "OTHER"]);
    expect(kindOptions(list).map((x) => x.code)).toEqual(["A", "B", "OTHER"]);
    expect(kindOptions(list, "Z").map((x) => x.code)).toEqual(["A", "B", "Z", "OTHER"]);
  });
});

describe("amount per kind", () => {
  it("each mode: person enters, suggested, fixed", () => {
    expect(startingAmount({ kind: k("C", "Courier") })).toEqual({ cents: null, source: null, locked: false });
    expect(startingAmount({ kind: k("C", "Courier", { amountMode: "SUGGESTED", amountCents: 50000 }) })).toEqual({ cents: 50000, source: "PRESET", locked: false });
    expect(startingAmount({ kind: k("C", "Courier", { amountMode: "FIXED", amountCents: 120000 }) })).toEqual({ cents: 120000, source: "PRESET", locked: true });
    expect(amountModeText("TYPED", null)).toBe("Person enters");
    expect(amountModeText("SUGGESTED", 50000)).toBe("Suggested PHP 500");
    expect(amountModeText("FIXED", 120000)).toBe("Fixed PHP 1,200");
  });
  it("a rule's Suggested amount wins over the kind's own amount (and does not lock)", () => {
    expect(startingAmount({ ruleSuggestedCents: 30000, kind: k("C", "C", { amountMode: "FIXED", amountCents: 50000 }) })).toEqual({ cents: 30000, source: "RULE", locked: false });
    expect(startingAmount({ officeCents: 60000, ruleSuggestedCents: 30000, kind: null }).source).toBe("OFFICE");
  });
  it("Other never has a preset", () => {
    expect(startingAmount({ kind: k("OTHER", "Other", { amountMode: "FIXED", amountCents: 100 }) }).cents).toBeNull();
    expect(checkKindAmount("OTHER", "SUGGESTED", 100)).toEqual({ ok: false, message: expect.stringMatching(/Other is always entered by the person/) });
  });
  it("checks the amount", () => {
    expect(checkKindAmount("C", "TYPED", 500)).toEqual({ ok: true, cents: null });
    expect(checkKindAmount("C", "FIXED", null).ok).toBe(false);
    expect(checkKindAmount("C", "FIXED", 0).ok).toBe(false);
    expect(checkKindAmount("C", "FIXED", 999_999_999).ok).toBe(true);
    expect(checkKindAmount("C", "FIXED", 1_000_000_000).ok).toBe(false);
  });
  it("records where the amount came from, and the preset when it was changed", () => {
    const start = { cents: 50000, source: "PRESET" as const, locked: false };
    expect(lineAmountSource(start, 50000)).toEqual({ amountSource: "PRESET", presetCents: 50000, locked: false });
    expect(lineAmountSource(start, 60000)).toEqual({ amountSource: "TYPED", presetCents: 50000, locked: false });
    expect(lineAmountSource({ cents: null, source: null, locked: false }, 60000)).toEqual({ amountSource: "TYPED", presetCents: null, locked: false });
    expect(presetWas(50000, 60000)).toBe("Preset was ₱500.00");
    expect(presetWas(50000, 50000)).toBe("");
    expect(sourceHint("RULE", false)).toBe("Suggested by rule");
    expect(sourceHint("PRESET", false)).toBe("Preset for this kind");
  });
});

describe("Often typed as Other", () => {
  it("groups ignoring case, needs 3, skips existing kinds", () => {
    const out = otherSuggestions(["Courier", "courier ", "COURIER", "Parking", "Parking", "photo copy", "Photocopy", "PhotoCopy"], new Set(["photocopy"]));
    expect(out).toHaveLength(1);
    expect(nameKey(out[0].text)).toBe("courier");
    expect(out[0].count).toBe(3);
  });
});
