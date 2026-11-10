import { describe, expect, it } from "vitest";
import { countText, custodyLine, emptyText, filterCounts, filterPapers, papersFilterOf, shortCode, whereOf } from "./documents-tab";

const at = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const paper = (stage: string, p: Record<string, unknown> = {}) => ({
  stage, location: "Antipolo branch", custodianLabel: "LA 1 (LA, Antipolo)", since: at("2026-11-10 00:10"), documentId: null as string | null, labelPrintedAt: null as Date | null, ...p,
});

describe("Documents tab words", () => {
  it("count text per transaction: in hand of all", () => {
    expect(countText([paper("AT_BRANCH"), paper("AT_BRANCH"), paper("EXPECTED")])).toBe("2 of 3 with you");
    expect(countText([paper("EXPECTED")])).toBe("0 of 1 with you");
    expect(countText([])).toBe("0 of 0 with you");
  });

  it("the filter: All, With you, Not yet (from the address; anything else is All)", () => {
    const docs = [paper("AT_BRANCH"), paper("EXPECTED"), paper("WITH_DP"), paper("EXPECTED")];
    expect(papersFilterOf("with-you")).toBe("with-you");
    expect(papersFilterOf("not-yet")).toBe("not-yet");
    expect(papersFilterOf("nonsense")).toBe("all");
    expect(papersFilterOf(undefined)).toBe("all");
    expect(filterPapers(docs, "all")).toHaveLength(4);
    expect(filterPapers(docs, "with-you").map((d) => d.stage)).toEqual(["AT_BRANCH"]);
    expect(filterPapers(docs, "not-yet").map((d) => d.stage)).toEqual(["EXPECTED", "EXPECTED"]);
    expect(filterCounts(docs)).toEqual({ all: 4, "with-you": 1, "not-yet": 2 });
    expect(emptyText("not-yet")).toBe("All papers are with you.");
  });

  it("where: one short phrase, never a sentence", () => {
    expect(whereOf(paper("AT_BRANCH"))).toEqual({ kind: "with-you", text: "With you" });
    expect(whereOf(paper("EXPECTED"))).toEqual({ kind: "not-yet", text: "Not yet" });
    expect(whereOf(paper("WITH_DP", { custodianLabel: "DP 1 (DP)" }))).toEqual({ kind: "other", text: "At DP 1" });
    expect(whereOf(paper("IN_TRANSIT")).text).toBe("On the way");
    expect(whereOf(paper("IN_SAFEKEEPING")).text).toBe("In the vault");
    for (const s of ["AT_BRANCH", "EXPECTED", "IN_TRANSIT", "WITH_DP", "IN_SAFEKEEPING", "PULLED_OUT", "RELEASED", "LOST", "DISPOSED"]) {
      expect(whereOf(paper(s)).text.split(" ").length).toBeLessThanOrEqual(4);
    }
  });

  it("custody details line: who, where and since when in Philippine time, and the label", () => {
    expect(custodyLine(paper("AT_BRANCH", { documentId: "GD1-CHM-01" }))).toBe("LA 1 (LA, Antipolo) at the Antipolo branch, since Nov 10, 12:10 AM. Label not printed yet.");
    expect(custodyLine(paper("AT_BRANCH", { documentId: "GD1-CHM-01", labelPrintedAt: at("2026-11-10 09:05") }))).toBe("LA 1 (LA, Antipolo) at the Antipolo branch, since Nov 10, 12:10 AM. Label printed Nov 10, 9:05 AM.");
    expect(custodyLine(paper("WITH_DP", { custodianLabel: "DP 1 (DP)", location: "With DP DP 1", documentId: "X" }))).toBe("DP 1 (DP) · With DP 1, since Nov 10, 12:10 AM. Label not printed yet.");
    expect(custodyLine(paper("EXPECTED"))).toBe("Not with you yet: it is on the checklist and has not been ticked.");
    expect(custodyLine(paper("AT_BRANCH"))).not.toMatch(/ago/);
  });

  it("short label code without the PN; the full code stays in the tooltip", () => {
    expect(shortCode("GD1652026901003-CHM-01", "GD1652026901003")).toBe("CHM-01");
    expect(shortCode("OTHER-1", "GD1652026901003")).toBe("OTHER-1");
  });
});
