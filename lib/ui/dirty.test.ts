import { describe, expect, it } from "vitest";
import { changedFields, dirtyState, type FormValues } from "./dirty";

const opened: FormValues = [["kind", "branch"], ["code", "168"], ["name", "A. Mabini"], ["branchIds", "a"], ["branchIds", "b"]];

describe("Unsaved-changes check", () => {
  it("is false for an untouched form", () => {
    expect(dirtyState({ forms: [{ initial: opened, current: [...opened] }] })).toEqual({ dirty: false });
  });

  it("is false for list steps and read-only pop-ups (no tracked form)", () => {
    expect(dirtyState({ forms: [] })).toEqual({ dirty: false });
    expect(dirtyState({ forms: [], importPending: false })).toEqual({ dirty: false });
  });

  it("is true after typing, and names what changed", () => {
    const typed: FormValues = opened.map(([k, v]) => [k, k === "name" ? "Makati City" : v]);
    expect(dirtyState({ forms: [{ initial: opened, current: typed }] })).toEqual({ dirty: true, kind: "form", changed: ["name"] });
  });

  it("counts checkbox groups by their set of values (order does not matter)", () => {
    const reordered: FormValues = [["kind", "branch"], ["code", "168"], ["name", "A. Mabini"], ["branchIds", "b"], ["branchIds", "a"]];
    expect(changedFields(opened, reordered)).toEqual([]);
    const fewer = opened.filter(([k, v]) => !(k === "branchIds" && v === "b"));
    expect(changedFields(opened, fewer)).toEqual(["branchIds"]);
  });

  it("typing back the original value is not a change", () => {
    expect(dirtyState({ forms: [{ initial: opened, current: opened.map(([k, v]) => [k, v]) }] }).dirty).toBe(false);
  });

  it("is true after choosing an import file", () => {
    expect(dirtyState({ forms: [], importPending: true })).toEqual({ dirty: true, kind: "import" });
  });
});
