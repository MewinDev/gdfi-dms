# 22 Backup and restore

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

The database and the uploaded files are backed up together, with checksums, to a folder (disk or NAS) or an S3-compatible bucket, and can be restored into a clean copy (D-055). Roles: infrastructure runs and schedules it; the developer rehearses restores.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | `npm run backup`: database dump + uploaded files, timestamped set, SHA-256 list | ✅ Built | console | Infrastructure | Target | `lib/backup/run.ts`, `scripts/backup.ts` | Runbook 5.4 |
| 2 | Target from config: folder or S3-compatible bucket (keys from the environment) | ✅ Built | n/a | n/a | `BACKUP_TARGET`, `BACKUP_DIR`, `BACKUP_S3_*` | `lib/backup/target.ts`, `lib/backup/sigv4.test.ts` | n/a |
| 3 | Retention setting (newest set always kept) | ✅ Built | n/a | n/a | `BACKUP_KEEP_DAYS` (30) | `prune` in `run.ts`, `tests/integration/backup.test.ts` | n/a |
| 4 | `npm run restore`: checks every checksum, then restores BOTH into a clean copy only (never over the database in use) | ✅ Built | console | Developer | n/a | `scripts/restore.ts`, `backup.test.ts` | Runbook 5.4 |
| 5 | Rehearsal: a restored receipt opens through the file route | ✅ Built | n/a | n/a | n/a | `tests/integration/backup.test.ts` (18 Nov 2026); rehearsal on gdfi_dms: 124 files, counts matched | n/a |
| 6 | A damaged backup restores nothing | ✅ Built | n/a | n/a | n/a | `backup.test.ts` | n/a |
| 7 | Runbook per hosting option (on-premise disk / NAS + off-site; cloud bucket with versioning; Supabase) and the 3-2-1 rule | ✅ Built | `docs/GO_LIVE_RUNBOOK.md` section 5 | n/a | n/a | runbook | n/a |
| 8 | Daily backup scheduled in production | ⏸ Blocked (project owner, infrastructure: hosting decision) | n/a | n/a | n/a | runbook section 2 | Go-live checklist step 11 |
| 9 | Monthly restore rehearsal | ⏸ Blocked (after go-live, operations) | n/a | n/a | n/a | runbook 5.4 | n/a |

## D. Known limits and open questions

- The backup machine needs PostgreSQL 16 client tools (`pg_dump`, `pg_restore`) on its PATH.
