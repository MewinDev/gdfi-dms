/**
 * The Manual Test Kit (docs/MANUAL-TEST-KIT.md). Developer tool: refuses anywhere but a local test
 * setup (APP_ENV=local, TEST_MODE=true, the sample MyLoans, the database gdfi_dms on this PC).
 *
 *   npm run kit:start                 the CLEAN kit: restore its baseline, or build it the first time
 *   npm run kit:reset                 back to the clean kit (type RESET; an automatic backup first)
 *   npm run kit:backup -- <name>      save the current state under a name
 *   npm run kit:list                  the baselines and the backups
 *   npm run kit:restore -- <name>     put a backup back (type RESET; an automatic backup first)
 *   npm run kit:rebuild               build the clean kit's baseline again (after a new migration)
 *
 * Add --with-scenarios to start, reset or rebuild for the old scenario data (docs/MANUAL-TEST-KIT-SCENARIOS.md)
 * instead of the clean kit. Without a console to type in (a script), add --confirm=RESET.
 */
import { createInterface } from "node:readline/promises";
import { loadEnvFiles } from "@/lib/env/load-files";
import { psql } from "@/lib/kit/docker";
import { blankGraph, backupNameRefusal, confirmRefusal, KIT_CONFIRM_WORD, kitDatabase, kitRefusal, OUT_OF_DATE } from "@/lib/kit/guard";

loadEnvFiles([".env.local", ".env"]);
const blanked = blankGraph(); // this run can never send an email

const [cmd, ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith("--"));
const name = rest.find((a) => !a.startsWith("--"));
const confirmFlag = flags.find((f) => f.startsWith("--confirm="))?.slice("--confirm=".length) ?? null;
const variant = flags.includes("--with-scenarios") ? "scenarios" : "clean";
const scen = variant === "scenarios" ? " -- --with-scenarios" : "";

const say = (line: string) => console.log(line);
const done = (line: string) => console.log(`- ${line}`);

async function confirm(what: string): Promise<boolean> {
  say(what);
  let typed = confirmFlag;
  if (typed === null) {
    if (!process.stdin.isTTY) {
      say(`No console to type in. Run it again with --confirm=${KIT_CONFIRM_WORD} to go ahead.`);
      return false;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    typed = await rl.question(`Type ${KIT_CONFIRM_WORD} to go ahead: `);
    rl.close();
  }
  const why = confirmRefusal(typed);
  if (why) say(`Stopped: ${why} Nothing was changed.`);
  return !why;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

async function main() {
  const why = kitRefusal();
  if (why) {
    console.error(`Refused: ${why}`);
    process.exitCode = 1;
    return;
  }
  if (blanked.length) say(`(The Microsoft Graph values are blanked for this run, so nothing can be emailed.)`);
  const core = await import("@/lib/kit/core");
  const db = kitDatabase();
  const loans = () => { try { return Number(psql(db, `SELECT count(*) FROM "Loan";`).trim()) || 0; } catch { return 0; } };

  const label = core.variantLabel(variant);
  const contents = variant === "clean"
    ? "migrations, settings and master data, the branches, the sign-in accounts and 40 PNs in the sample MyLoans; no loan files"
    : "migrations, settings and master data, sample accounts and the scenario loans";
  const sheet = variant === "clean" ? "docs/MANUAL-TEST-KIT.md" : "docs/MANUAL-TEST-KIT-SCENARIOS.md";
  switch (cmd) {
    case "start": {
      const base = core.baselineStatus(variant);
      if (base && !base.upToDate) { console.error(`${OUT_OF_DATE.replace("kit:rebuild`", `kit:rebuild${scen}\``)}`); process.exitCode = 1; return; }
      if (base) {
        const ok = loans() === 0 || (await confirm(`Will: put ${db} back to the ${label} (the baseline of ${fmtDate(base.manifest.createdAt)}). It replaces what is in ${db} now (${loans()} loan files); an automatic backup is taken first.`));
        if (!ok) { process.exitCode = 1; return; }
        core.restoreSave(core.baselineName(variant), done);
      } else {
        const ok = loans() === 0 || (await confirm(`Will: build the ${label} in ${db} from nothing (${contents}), then save it as its baseline. It replaces what is in ${db} now (${loans()} loan files); an automatic backup is taken first.`));
        if (!ok) { process.exitCode = 1; return; }
        say(`Building the ${label} in ${db} (about a minute)...`);
        await core.buildBaseline(done, { variant });
      }
      say(`Done: ${db} holds the ${label}. Sign in at the test sign-in page; the test sheet is ${sheet}.`);
      return;
    }
    case "rebuild": {
      if (!(await confirm(`Will: empty ${db}, apply every migration, seed, build the ${label} again (${contents}), and save it as its new baseline. An automatic backup is taken first.`))) { process.exitCode = 1; return; }
      say(`Rebuilding the ${label} (about a minute)...`);
      await core.buildBaseline(done, { variant });
      say(`Done: new baseline saved; ${db} holds the ${label}.`);
      return;
    }
    case "reset":
    case "restore": {
      const target = cmd === "reset" ? core.baselineName(variant) : name;
      if (!target) { console.error("Give the backup name: npm run kit:restore -- <name> (see npm run kit:list)."); process.exitCode = 1; return; }
      if (cmd === "reset") {
        const base = core.baselineStatus(variant);
        if (!base) { console.error(`There is no baseline for the ${label} yet. Run npm run kit:start${scen}.`); process.exitCode = 1; return; }
        if (!base.upToDate) { console.error(OUT_OF_DATE); process.exitCode = 1; return; }
      }
      const m = core.readManifest(target);
      if (!m) { console.error(`There is no backup called "${target}". See npm run kit:list.`); process.exitCode = 1; return; }
      const what = cmd === "reset" ? `the ${label} (its baseline)` : `the backup "${target}"`;
      if (!(await confirm(`Will: replace everything in ${db} with ${what}, saved ${fmtDate(m.createdAt)}. An automatic backup (pre-reset-...) is taken first; the last 5 are kept.`))) { process.exitCode = 1; return; }
      core.restoreSave(target, done);
      say(`Done: ${db} is back to ${what}. The dev server reconnects by itself; refresh the page.`);
      return;
    }
    case "backup": {
      const bad = backupNameRefusal(name);
      if (bad) { console.error(`${bad} Use: npm run kit:backup -- <name>`); process.exitCode = 1; return; }
      say(`Will: save the current state of ${db} as "${name}".`);
      core.saveDump(name!, "backup", done);
      say("Done. Copy the .dump and .json files from storage/kit/backups to use them on another PC.");
      return;
    }
    case "list": {
      const rows = core.listSaves();
      const current = core.currentMigrations();
      const loaded = core.loadedKit(db);
      say(`Loaded now: ${loaded ? `${core.variantLabel(loaded.variant)} (since ${fmtDate(loaded.loadedAt)})` : "not known (built before the clean kit)"}.`);
      say(`Saves in storage/kit (database ${db}; this version has ${current.length} migrations, the last ${current.at(-1)}):`);
      if (!rows.length) { say("  None yet. Run npm run kit:start."); return; }
      for (const r of rows) {
        const fits = r.migrations.length === current.length && r.migrations.every((x, i) => x === current[i]);
        say(`  ${r.name.padEnd(28)} ${r.kind.padEnd(8)} ${(r.variant === "clean" ? "clean" : r.variant === "scenarios" ? "scenarios" : "").padEnd(9)} ${fmtDate(r.createdAt).padEnd(24)} ${(r.sizeBytes / 1024).toFixed(0).padStart(6)} KB  ${String(r.loanFiles).padStart(3)} loans  ${r.migrations.at(-1)}${fits ? "" : "  (other migrations: rebuild or do not restore)"}`);
      }
      return;
    }
    default:
      say("Use: npm run kit:start | kit:reset | kit:backup -- <name> | kit:list | kit:restore -- <name> | kit:rebuild (add --with-scenarios to start, reset or rebuild for the scenario data)");
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
