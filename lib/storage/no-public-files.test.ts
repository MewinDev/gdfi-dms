// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * D-019 (plan §4): stored files (receipts, stage evidence, LTO proof) are never under public/ and never have
 * a static URL; they open only through /api/files/[kind]/[id]. public/ holds the site's own assets only.
 */
const ROOT = process.cwd();
/** The only files public/ may hold: the site's own assets. A new asset is added here on purpose. */
const SITE_ASSETS = ["favicon.ico", "logo.jpg"];
const slash = (p: string) => p.split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [slash(path.relative(path.join(ROOT, "public"), p))];
  });
}

describe("no stored file under public/ (D-019)", () => {
  it("public/ holds only the site's own assets", () => {
    expect(walk(path.join(ROOT, "public")).sort()).toEqual([...SITE_ASSETS].sort());
  });

  it("the receipt store is outside public/ and refuses a folder inside it", async () => {
    const { RECEIPTS_ROOT, isUnderPublic } = await import("./receipts");
    expect(isUnderPublic(RECEIPTS_ROOT)).toBe(false);
    expect(isUnderPublic("public")).toBe(true);
    expect(isUnderPublic("public/receipts")).toBe(true);
    expect(isUnderPublic(path.join(ROOT, "public", "x"))).toBe(true);
    expect(isUnderPublic("storage/receipts")).toBe(false);
    expect(isUnderPublic("publicity")).toBe(false);
  });

  it("no env file points RECEIPTS_DIR into public/", async () => {
    const { isUnderPublic } = await import("./receipts");
    for (const f of readdirSync(ROOT).filter((n) => n.startsWith(".env"))) {
      const m = readFileSync(path.join(ROOT, f), "utf8").match(/^\s*RECEIPTS_DIR\s*=\s*"?([^"\r\n]*)"?/m);
      if (m?.[1]) expect(isUnderPublic(m[1]), f).toBe(false);
    }
  });

  it("the app builds file links only through /api/files", () => {
    const hits: string[] = [];
    const scan = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== "node_modules" && !n.startsWith(".")) scan(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(n) || /\.test\.tsx?$/.test(n)) continue;
        const s = readFileSync(p, "utf8");
        if (/["'`]\/(storage|uploads|receipts)\//.test(s) || /\/api\/(receipts|stage-files)\b/.test(s)) hits.push(slash(path.relative(ROOT, p)));
      }
    };
    for (const d of ["app", "components", "lib"]) scan(path.join(ROOT, d));
    expect(hits).toEqual([]);
  });
});
