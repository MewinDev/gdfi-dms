import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/workflow: every file has a title, a "Last updated" line, working relative links and non-empty
 * Mermaid blocks. Full Mermaid parsing needs a browser, so it is a manual check (mermaid-cli);
 * here each block gets a light structure check (flowchart header, every class used is defined).
 */
const DIR = path.resolve("docs/workflow");
const files = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");
const slug = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");

describe("docs/workflow", () => {
  it("has the index and the twelve documents", () => {
    expect(files).toEqual([
      "01-glossary.md", "02-big-picture.md", "03-loan-associate.md", "04-dp-job.md", "05-funds.md",
      "06-exceptions.md", "07-rules-and-roles.md", "08-systems.md", "09-status-and-open-questions.md", "10-processing-stages.md", "11-monitoring.md", "12-permissions.md", "README.md",
    ]);
  });

  it.each(files)("%s: title, purpose and Last updated", (f) => {
    const lines = read(f).split(/\r?\n/);
    expect(lines[0]).toMatch(/^# \S/);
    expect(lines[2]?.trim().length, "a one-line purpose under the title").toBeGreaterThan(10);
    expect(read(f)).toMatch(/^Last updated: \d{1,2} [A-Z][a-z]+ \d{4} \(PHT\)$/m);
  });

  it.each(files)("%s: relative links point to files and headings that exist", (f) => {
    const text = read(f).replace(/```[\s\S]*?```/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split("#");
      const full = file ? path.resolve(DIR, file) : path.join(DIR, f);
      expect(existsSync(full), `${f} links to ${target}`).toBe(true);
      if (anchor) {
        const headings = [...readFileSync(full, "utf8").matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]));
        expect(headings, `${f} links to #${anchor}`).toContain(anchor);
      }
    }
  });

  it.each(files)("%s: Mermaid blocks are non-empty flowcharts whose classes are all defined", (f) => {
    for (const [, body] of read(f).matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
      expect(body.trim().length).toBeGreaterThan(0);
      expect(body).toMatch(/^flowchart (TD|TB|LR|RL|BT)\s*$/m);
      const defined = new Set([...body.matchAll(/^\s*classDef (\w+)/gm)].map((m) => m[1]));
      const used = new Set([...body.matchAll(/:::(\w+)/g)].map((m) => m[1]));
      for (const c of used) expect(defined, `class ${c}`).toContain(c);
      expect((body.match(/"/g) ?? []).length % 2, "balanced quotes").toBe(0);
    }
  });

  it("the glossary defines the agreed words; the rules name holds:manage and holds:transfer", () => {
    const g = read("01-glossary.md");
    for (const w of ["Missing paper", "On hold", "Hold owner", "Locked", "Transfer hold", "Papers handed over", "Cash to settle", "Round", "Problem", "Pull back", "Decline", "Return to LA: papers needed", "Cash advance", "Fund transfer", "Funds type", "Capacity", "Availability", "Overdue", "LTO advisory"]) {
      expect(g.split(/\r?\n/).some((line) => line.startsWith(`| **${w}** |`)), w).toBe(true);
    }
    expect(read("07-rules-and-roles.md")).toContain("holds:manage");
    expect(read("07-rules-and-roles.md")).toContain("holds:transfer");
    expect(read("07-rules-and-roles.md")).toContain("fundtypes:manage");
    for (const k of ["monitor:dp", "monitor:lto", "ltoreports:create", "ltoreports:manage", "dpcapacity:manage", "Operations Monitor"]) expect(read("07-rules-and-roles.md"), k).toContain(k);
  });

  it("the monitoring document defines every count and the advisories", () => {
    const m = read("11-monitoring.md");
    for (const w of ["Includes time on hold", "Assigned", "In process", "On hold", "Overdue", "Time to accept", "Processing time", "Availability %", "On leave", "At the LTO now", "Avg time at the LTO", "Still active? Please confirm"]) expect(m, w).toContain(w);
    expect(read("09-status-and-open-questions.md")).toMatch(/Monitoring \(Operations\)[\s\S]*availability thresholds/);
  });

  it("the funds diagram and notes cover both funds types and the type change before release", () => {
    const f = read("05-funds.md");
    for (const w of ["Cash advance", "Fund transfer", "Send transfer", "Release cash", "change the type"]) expect(f, w).toContain(w);
    expect(read("09-status-and-open-questions.md")).toMatch(/Funds types[\s\S]*confirm the names and codes/);
  });

  it("the five diagram files each hold one diagram", () => {
    for (const f of files.filter((x) => /^0[2-6]-/.test(x))) expect(read(f).match(/```mermaid/g), f).toHaveLength(1);
  });
});
