/**
 * npm run backup (D-055): the database AND the uploaded files, to the target in the environment (BACKUP_TARGET=folder
 * with BACKUP_DIR, or s3 with BACKUP_S3_*), with a manifest of checksums; then sets older than BACKUP_KEEP_DAYS
 * (default 30) are removed. Never prints a key or a password. Exit code 1 when it fails.
 */
import { checkEnvOrExit } from "@/lib/env/startup";
import { backup, keepDays, prune } from "@/lib/backup/run";
import { targetFromEnv } from "@/lib/backup/target";

checkEnvOrExit();
(async () => {
  const target = targetFromEnv();
  await backup(target, { log: console.log });
  await prune(target, keepDays(), new Date(), console.log);
})().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "The backup failed."); process.exitCode = 1; });
