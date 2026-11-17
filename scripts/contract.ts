/**
 * npm run test:contract [-- --target=mock|local|staging]
 * The myloans contract tests (tests/contract). mock (default): the in-process mock. local: a running app's mock over
 * HTTP (MYLOANS_MOCK_URL, default http://localhost:3000/api/dev/myloans/api/dms/v1). staging: myloans staging, by hand,
 * read-only, with MYLOANS_CONTRACT_URL and MYLOANS_CONTRACT_KEY set in the shell (never in the repo). Not for CI.
 */
import { spawnSync } from "node:child_process";

const arg = process.argv.slice(2).find((a) => a.startsWith("--target="));
const target = arg?.slice("--target=".length) ?? "mock";
if (!["mock", "local", "staging"].includes(target)) {
  console.error("Use --target=mock, --target=local or --target=staging.");
  process.exit(2);
}
if (target === "staging" && (!process.env.MYLOANS_CONTRACT_URL || !process.env.MYLOANS_CONTRACT_KEY)) {
  console.error("Set MYLOANS_CONTRACT_URL and MYLOANS_CONTRACT_KEY in this shell first (never in a file in the repo).");
  process.exit(2);
}
console.log(`myloans contract tests against: ${target}${target === "staging" ? " (read-only GETs)" : ""}`);
const r = spawnSync("npx", ["vitest", "run", "tests/contract"], { stdio: "inherit", shell: true, env: { ...process.env, MYLOANS_CONTRACT_TARGET: target } });
process.exit(r.status ?? 1);
