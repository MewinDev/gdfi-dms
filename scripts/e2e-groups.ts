/**
 * npm run e2e:groups: the Playwright e2e specs in small groups, one width at a time, 1 worker, on the
 * TEST database only (gdfi_dms_test; the Playwright config and tests/e2e/db.ts refuse anything else).
 *
 * 1. Builds the app once for production (next build into .next-e2e-prod), unless --no-build.
 * 2. For each width (1440, then 820, then 390) and each group of specs: stops anything left on port 3100,
 *    runs Playwright (it starts `next start` for the group), then stops the server again, so memory is
 *    given back between groups.
 * 3. Writes a short pass / fail summary, with the peak memory of each group, to
 *    test-results/e2e-groups-summary.md (and prints it).
 *
 * Options: --size=4 (specs per group), --widths=1440,820,390, --only=funds (specs whose file name
 * contains it; several with commas: --only=funds,journey), --no-build (reuse the last build). Example: npm run e2e:groups -- --widths=390 --only=funds
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFiles } from "../lib/env/load-files";
import { testDatabaseUrl } from "../lib/env/test-db";

const PORT = 3100;
const PROJECTS: Record<string, string> = { "1440": "desktop-1440", "820": "tablet-820", "390": "phone-390" };
const OUT = "test-results";
const SUMMARY = path.join(OUT, "e2e-groups-summary.md");

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const size = Math.max(1, Number(arg("size") ?? 4));
const widths = (arg("widths") ?? "1440,820,390").split(",").filter((w) => PROJECTS[w]);
const only = arg("only");
const build = !process.argv.includes("--no-build");

const fromFiles: Record<string, string | undefined> = {};
loadEnvFiles([".env.local", ".env"], fromFiles);
const testDb = testDatabaseUrl({ ...fromFiles, ...process.env });
if (!testDb || !/test/i.test(new URL(testDb).pathname)) {
  console.error("Refused: no test database (gdfi_dms_test). Run npm run db:create-test first.");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: testDb, DIRECT_URL: testDb, NEXT_DIST_DIR: ".next-e2e-prod", APP_BASE_URL: `http://localhost:${PORT}` };

/** Stops whatever listens on the e2e port (a server left by a group that crashed or timed out). */
function stopPort() {
  try {
    if (process.platform === "win32") {
      const pids = new Set(execSync(`netstat -ano -p tcp`, { encoding: "utf8" }).split(/\r?\n/)
        .filter((l) => l.includes(`:${PORT} `) && /LISTENING/.test(l)).map((l) => l.trim().split(/\s+/).at(-1)!).filter((p) => p && p !== "0"));
      for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
    } else {
      execSync(`lsof -ti tcp:${PORT} | xargs -r kill -9`, { stdio: "ignore", shell: "/bin/sh" });
    }
  } catch { /* nothing listening */ }
}

/** Memory in use by node and the test browser right now, in bytes (0 when it cannot be read). */
function memoryNow(): number {
  try {
    if (process.platform === "win32") {
      const out = execSync(`powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; (Get-Process node,chrome,chromium,headless_shell -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return Number(out.trim()) || 0;
    }
    const out = execSync(`ps -A -o rss=,comm= | grep -Ei 'node|chrom|headless' | awk '{s+=$1} END {print s*1024}'`, { encoding: "utf8", shell: "/bin/sh" });
    return Number(out.trim()) || 0;
  } catch { return 0; }
}
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;

function run(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; peak: number }> {
  return new Promise((resolve) => {
    let peak = memoryNow();
    const timer = setInterval(() => { peak = Math.max(peak, memoryNow()); }, 5000);
    const child = spawn(cmd, args, { env: { ...env, ...extraEnv }, stdio: "inherit", shell: true });
    child.on("exit", (code) => { clearInterval(timer); resolve({ code: code ?? 1, peak }); });
  });
}

interface JsonReport { stats?: { expected: number; unexpected: number; flaky: number; skipped: number }; suites?: Suite[] }
interface Suite { title: string; file?: string; specs?: { title: string; ok: boolean; file: string }[]; suites?: Suite[] }
const failedOf = (suites: Suite[] = []): string[] => suites.flatMap((s) => [...(s.specs ?? []).filter((sp) => !sp.ok).map((sp) => `${sp.file}: ${sp.title}`), ...failedOf(s.suites)]);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const specs = readdirSync(path.join("tests", "e2e")).filter((f) => f.endsWith(".spec.ts") && (!only || only.split(",").some((o) => o && f.includes(o)))).sort();
  if (!specs.length) { console.error("No spec matches."); process.exit(1); }
  const groups: string[][] = [];
  for (let i = 0; i < specs.length; i += size) groups.push(specs.slice(i, i + size));
  const lines: string[] = [`# E2E in groups`, "", `Started ${new Date().toISOString()} · ${specs.length} specs in ${groups.length} groups of up to ${size} · widths ${widths.join(", ")} · 1 worker · production build`, ""];
  const save = () => writeFileSync(SUMMARY, lines.join("\n") + "\n");

  stopPort();
  lines.push(`Memory (node and browsers) before: ${gb(memoryNow())}`, "");
  if (build) {
    console.log("Building the app for the e2e server (next build)...");
    const b = await run("npx", ["next", "build"]);
    lines.push(`Build: ${b.code === 0 ? "ok" : `FAILED (exit ${b.code})`} · peak memory ${gb(b.peak)}`, "");
    save();
    if (b.code !== 0) { console.error("next build failed; nothing ran."); process.exit(1); }
  } else if (!existsSync(path.join(".next-e2e-prod", "BUILD_ID"))) {
    console.error("No build in .next-e2e-prod: run without --no-build first.");
    process.exit(1);
  }

  const totals: Record<string, { passed: number; failed: number; flaky: number; skipped: number }> = {};
  const failures: string[] = [];
  for (const w of widths) {
    totals[w] = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    lines.push(`## ${w} px`, "");
    for (const [i, g] of groups.entries()) {
      stopPort();
      const json = path.join(OUT, `e2e-group-${w}-${i + 1}.json`);
      rmSync(json, { force: true });
      console.log(`\n=== ${w} px · group ${i + 1}/${groups.length}: ${g.join(", ")}`);
      const r = await run("npx", ["playwright", "test", ...g.map((f) => `tests/e2e/${f}`), `--project=${PROJECTS[w]}`, "--workers=1", "--reporter=list,json"],
        { E2E_SKIP_BUILD: "1", PLAYWRIGHT_JSON_OUTPUT_NAME: json, PLAYWRIGHT_JSON_OUTPUT_FILE: json });
      stopPort();
      let rep: JsonReport = {};
      try { rep = JSON.parse(readFileSync(json, "utf8")); } catch { /* no report: the run crashed */ }
      const st = rep.stats ?? { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
      const failed = failedOf(rep.suites);
      totals[w].passed += st.expected; totals[w].failed += st.unexpected; totals[w].flaky += st.flaky; totals[w].skipped += st.skipped;
      for (const f of failed) failures.push(`${w} px · ${f}`);
      const crashed = !rep.stats ? " · NO REPORT (the run stopped; see the console)" : "";
      lines.push(`- Group ${i + 1} (${g.map((f) => f.replace(".spec.ts", "")).join(", ")}): ${st.expected} passed, ${st.unexpected} failed${st.flaky ? `, ${st.flaky} flaky` : ""}${st.skipped ? `, ${st.skipped} skipped` : ""} · peak memory ${gb(r.peak)}${crashed}`);
      if (!rep.stats) totals[w].failed += 1;
      save();
    }
    lines.push("", `Total ${w} px: ${totals[w].passed} passed, ${totals[w].failed} failed${totals[w].flaky ? `, ${totals[w].flaky} flaky` : ""}`, "");
    save();
  }
  lines.push("## Failures", "", ...(failures.length ? failures.map((f) => `- ${f}`) : ["None."]), "", `Memory (node and browsers) after: ${gb(memoryNow())}`, `Finished ${new Date().toISOString()}`);
  save();
  console.log(`\n${readFileSync(SUMMARY, "utf8")}`);
  process.exit(Object.values(totals).some((t) => t.failed > 0) ? 1 : 0);
}

main().catch((e) => { console.error(e); stopPort(); process.exit(1); });
