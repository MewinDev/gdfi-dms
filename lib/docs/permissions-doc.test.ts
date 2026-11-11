import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isHiddenPermission } from "@/lib/auth/permissions";
import { DOC_FILE, auditMark, withGenerated } from "./permissions-doc";

describe("docs/workflow/12-permissions.md is generated from the code", () => {
  const doc = readFileSync(DOC_FILE, "utf8");

  it("is up to date (run npm run docs:permissions after changing lib/auth/permissions.ts)", () => {
    // Line endings do not count (Git on Windows checks the file out with CRLF).
    const lf = (t: string) => t.replace(/\r\n/g, "\n");
    expect(lf(withGenerated(doc)) === lf(doc), "docs/workflow/12-permissions.md is out of date: run npm run docs:permissions").toBe(true);
  });

  it("lists every permission in the catalogue and in the audit table", () => {
    // Hidden ticks (a feature switched off for now, such as the CSV exports) are left out of the doc on purpose.
    for (const k of ALL_PERMISSIONS.filter((x) => !isHiddenPermission(x))) expect(doc.split(`\`${k}\``).length - 1, k).toBeGreaterThanOrEqual(2);
  });

  it("marks gaps and splits", () => {
    expect(auditMark("none (shown to everyone who sees the loan file)", "loans:refresh")).toBe("**Gap, closed**");
    expect(auditMark("source:manage", "myloans:sync")).toBe("Split or renamed");
    expect(auditMark("loans:view", "loans:view")).toBe("");
  });
});
