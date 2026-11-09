import { describe, expect, it } from "vitest";
import { reviewBranchName, reviewNames } from "./review-name";

describe("Branch review item names on the Home card", () => {
  it("shows the branch name only", () => {
    expect(reviewBranchName({ title: "Alicia (710)", code: "710" })).toBe("Alicia");
    expect(reviewBranchName({ title: "Amang Rodriguez - Pasig (174)", code: "174" })).toBe("Amang Rodriguez - Pasig");
    expect(reviewBranchName({ title: "Test Branch (999)", code: "999" })).toBe("Test Branch");
    expect(reviewBranchName({ title: "Bacoor(DONT USE) (721)", code: "721" })).toBe("Bacoor(DONT USE)");
  });

  it("leaves titles without a trailing code alone (a branch without a code, an unknown code seen in a PN)", () => {
    expect(reviewBranchName({ title: "Quezon City", code: null })).toBe("Quezon City");
    expect(reviewBranchName({ title: "Code 777 (Antipolo)", code: "777" })).toBe("Code 777 (Antipolo)");
  });

  it("keeps the code only for two items with the same name", () => {
    expect(reviewNames([
      { title: "San Jose (305)", code: "305" }, { title: "Alicia (710)", code: "710" }, { title: "San Jose (512)", code: "512" },
    ])).toEqual([{ name: "San Jose", code: "305" }, { name: "Alicia", code: null }, { name: "San Jose", code: "512" }]);
  });
});
