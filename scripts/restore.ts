/**
 * npm run restore -- --into=<new database> --files-into=<empty folder> [--set=gdfi-dms-YYYYMMDD-HHMMSS] [--list]
 * (D-055): restores a backup (the newest unless --set) into a CLEAN COPY: a new database and an empty folder. Never over
 * the database in use. Checksums are verified before anything is restored. --list shows the sets.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { restore } from "@/lib/backup/run";
import { targetFromEnv } from "@/lib/backup/target";

checkEnvOrExit();
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
(async () => {
  const target = targetFromEnv();
  if (process.argv.includes("--list")) { for (const s of await target.sets()) console.log(s); return; }
  const into = arg("into"), files = arg("files-into");
  if (!into || !files) throw new Error("Usage: npm run restore -- --into=<new database name> --files-into=<empty folder> [--set=<set>]");
  await restore(target, { set: arg("set"), intoDatabase: into, intoFiles: files, log: console.log });
})().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "The restore failed."); process.exitCode = 1; });
