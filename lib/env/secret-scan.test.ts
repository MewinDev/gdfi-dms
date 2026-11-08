import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { findSecrets, knownSecretValues } from "./secret-scan";

// Fakes are built at run time so this file never holds a secret-looking string itself.
const j = (...p: string[]) => p.join("");

describe("findSecrets", () => {
  it("finds each kind and reports the line, never the text", () => {
    const text = [
      "ok line",
      j("const s = '", "abc", "8Q~", "A".repeat(10), "b".repeat(10), "C".repeat(12), "';"),
      j("DATABASE_URL=postgresql://user:", "Zq7", "pW9kLm2@db.host.example:5432/x"),
      j("headers: { Authorization: 'Bearer ", "AbC123dEf456GhI789jKl012MnO", "' }"),
      j("MYLOANS_API_KEY=", "k9F3h2LmQ8w7XzR4t6Yp"),
      j("-----BEGIN ", "PRIVATE KEY-----"),
      j("eyJ", "hbGciOiJIUzI1NiJ9", ".eyJ", "zdWIiOiIxMjM0NTY3ODkw", ".", "SflKxwRJSMeKKF2QT4fw"),
    ].join("\n");
    const hits = findSecrets(text);
    expect(hits.map((h) => h.line).sort()).toEqual([2, 3, 4, 5, 6, 7]);
    expect(JSON.stringify(hits)).not.toContain("k9F3h2");
  });

  it("lets placeholders, references and empty values through", () => {
    const text = [
      'DATABASE_URL="postgresql://gdfi:change-me-local-only@localhost:5432/gdfi_dms"',
      "SESSION_SECRET=",
      "CRON_SECRET=replace-with-a-long-random-string",
      "MYLOANS_API_KEY=process.env.MYLOANS_API_KEY",
      "# DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres",
    ].join("\n");
    expect(findSecrets(text)).toEqual([]);
  });

  it("finds a value copied from this PC's env files", () => {
    const real = j("Rk2", "Tq9", "Vb7", "Xw4");
    expect(findSecrets(`note: ${real}`, knownSecretValues({ GRAPH_CLIENT_SECRET: real, APP_BASE_URL: "http://localhost:3001" }))).toEqual([{ kind: "a value from this PC's env files", line: 1 }]);
  });
});

describe("the repository holds no secret", () => {
  const read = (f: string) => (existsSync(f) ? (parseEnv(readFileSync(f, "utf8")) as Record<string, string>) : {});
  const known = knownSecretValues({ ...read(".env"), ...read(".env.local") });
  const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8", maxBuffer: 1e8 }).split("\n").filter(Boolean);
  // Tracked files and untracked files that are not ignored: everything a commit now would contain.
  const files = [...new Set([...git("ls-files"), ...git("ls-files --others --exclude-standard")])]
    .filter((f) => !/\.(png|jpe?g|gif|ico|webp|pdf|zip|woff2?|ttf)$/i.test(f) && existsSync(f) && statSync(f).size < 5_000_000);

  it("scans the tracked and committable files, test fixtures and docs", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.startsWith("docs/"))).toBe(true);
    expect(files.some((f) => f.startsWith("tests/"))).toBe(true);
  });

  it("finds no secret-looking string (file names only on failure)", () => {
    const found = files.flatMap((f) => {
      const hits = findSecrets(readFileSync(f, "utf8"), known);
      return hits.length ? [`${f}: ${[...new Set(hits.map((h) => `${h.kind} line ${h.line}`))].join(", ")}`] : [];
    });
    expect(found).toEqual([]);
  });

  it("no real env file would be committed; .env.example holds only empty or placeholder values", () => {
    expect(files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== ".env.example")).toEqual([]);
    const example = read(".env.example");
    const secretNames = ["SESSION_SECRET", "CRON_SECRET", "MYLOANS_BASE_URL", "MYLOANS_API_KEY", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID"];
    for (const n of secretNames) expect(example[n] ?? "", n).toBe("");
    for (const n of ["DATABASE_URL", "DIRECT_URL"]) expect(example[n], n).toContain("change-me-local-only@localhost");
  });
});
