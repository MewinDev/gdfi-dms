import { describe, expect, it } from "vitest";
import { charDiff } from "./char-diff";

describe("charDiff: the characters that differ", () => {
  it("marks only the changed characters on each side", () => {
    expect(charDiff("Ana Cruz", "Anna Cruz")).toEqual({ was: [{ text: "Ana Cruz", changed: false }], now: [{ text: "An", changed: false }, { text: "n", changed: true }, { text: "a Cruz", changed: false }] });
    expect(charDiff("12 Rizal Ave", "21 Rizal Ave").was.some((p) => p.changed)).toBe(true);
    expect(charDiff("same", "same")).toEqual({ was: [{ text: "same", changed: false }], now: [{ text: "same", changed: false }] });
    expect(charDiff("", "New")).toEqual({ was: [], now: [{ text: "New", changed: true }] });
  });
  it("long texts: the middle between the common start and end", () => {
    const a = `${"x".repeat(200)}AAA${"y".repeat(200)}`, b = `${"x".repeat(200)}B${"y".repeat(200)}`;
    expect(charDiff(a, b).now.find((p) => p.changed)!.text).toBe("B");
  });
});
