import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Screenshots are taken only on purpose (npm run docs:screenshots), through docShot in tests/e2e/helpers.ts. */
describe("documentation screenshots are opt-in", () => {
  it("no e2e spec calls .screenshot( except through docShot", () => {
    const dir = path.join(process.cwd(), "tests", "e2e");
    const hits = readdirSync(dir).filter((n) => n.endsWith(".ts") && n !== "helpers.ts")
      .filter((n) => /\.screenshot\(/.test(readFileSync(path.join(dir, n), "utf8").replace(/docShot\(/g, "")));
    expect(hits).toEqual([]);
  });

  it("docShot writes nothing unless DOCS_SCREENSHOTS=1, and the command exists", () => {
    const helpers = readFileSync(path.join(process.cwd(), "tests", "e2e", "helpers.ts"), "utf8");
    expect(helpers).toMatch(/if \(process\.env\.DOCS_SCREENSHOTS !== "1"\) return;/);
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["docs:screenshots"]).toContain("--screenshots");
  });
});
