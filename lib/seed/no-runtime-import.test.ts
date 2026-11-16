import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * lib/seed builds sample data for npm run db:reset-seed only (scripts/db-reset-seed.ts). It is exempt
 * from the role-key scan (tests/integration/permissions-pass.test.ts) because it never decides access,
 * so it must never be reachable from the running app: no page, component, action, route, proxy,
 * instrumentation or lib module outside lib/seed may import it.
 */
const ROOTS = ["app", "components", "lib"];
const FILES = ["proxy.ts", "instrumentation.ts"];
const SEED_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/lib\/seed(?:\/[^"']*)?|(?:\.{1,2}\/)+(?:lib\/)?seed(?:\/[^"']*)?)["']/;

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (p === path.join("lib", "seed")) continue; // the seed's own files may import each other
      sources(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("lib/seed is never imported by app runtime code", () => {
  it("no page, component, route, action, proxy, instrumentation or lib module imports lib/seed", () => {
    const files = [...ROOTS.flatMap((r) => sources(r)), ...FILES];
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => SEED_IMPORT.test(l)).map(([f, n, l]) => `${f}:${n} ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("the pattern catches the import forms it must catch", () => {
    for (const bad of [
      `import { applyFoundationSeed } from "@/lib/seed/foundation";`,
      `const f = await import("@/lib/seed/foundation");`,
      `import x from "../seed/stage-spread";`,
      `import x from "../../lib/seed";`,
    ]) expect(SEED_IMPORT.test(bad), bad).toBe(true);
    for (const ok of [`import { seedTestUsers } from "./seeders";`, `import { x } from "@/lib/settings";`]) expect(SEED_IMPORT.test(ok), ok).toBe(false);
  });
});
