# Go-live runbook

Last updated: 24 November 2026 (PHT)

How to bring GDFI-DMS live for phase A (LA, DP and Funds on the live myloans feed), how to keep it backed up, and how to step back if go-live day goes wrong. Decisions: D-021 (no test sign-in outside local), D-052 (one sync entry point), D-055 (backups, headers, this runbook).

**Not ready yet (blocks go-live):** Microsoft sign-in (Entra ID) is not built. With `AUTH_MODE=entra` nobody can sign in to staging or production; that is intended until it is built (`docs/PHASE_A_GAPS.md`). Uploaded files are stored on the app server's disk only (`STORAGE_DRIVER=local`; the `supabase` driver is not built), so the host must give the app a **persistent disk**.

## 1. Sign-in (Entra) and environment settings

1. **Entra app registration** (IT owner): one app for sign-in, the redirect URL the sign-in piece sets (`https://<dms address>/…`), users limited to the GDFI tenant. Mail.Send (application, admin consent) stays on the email app (`docs/ENVIRONMENT.md`, Production checklist, step 7).
2. **Environment** (the host's Environment Variables screen; full list in `docs/ENVIRONMENT.md`):
   - `APP_ENV=production`, `TEST_MODE=false`, `MYLOANS_MODE=live`, `AUTH_MODE=entra`, `APP_BASE_URL=https://…`;
   - secrets: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET` (32+), `CRON_SECRET` (24+), `MYLOANS_BASE_URL`, `MYLOANS_API_KEY`, `GRAPH_*`, the `ENTRA_*` values, and the `BACKUP_S3_*` keys if backups go to a bucket;
   - `STORAGE_LOCAL_DIR` (and `RECEIPTS_DIR` if used) on the persistent disk.
3. **Start the app.** Production refuses to start with an unsafe setting and names the variable (never its value). Fix and start again.
4. **Health:** point the host's health check at `GET /api/health` (200 healthy, 503 when the database is down).
5. **Security headers** are set by the app itself (`lib/security/headers.ts`): CSP, HSTS (production only), nosniff, frame DENY, Referrer-Policy same-origin. The host must serve https only.

6. **No internet needed to build (D-057).** `next build` needs no internet access except the package registry for `npm install`: the font is self-hosted (`app/fonts`) and Next.js telemetry is off. At run time only the server calls outside hosts, each set in the environment: Microsoft Graph (email), Microsoft sign-in (Entra), the myloans API, and the backup bucket if backups go to S3. Allow those in the server's firewall; the browser needs only the DMS address.

## 2. Scheduler

Every 5 minutes, all day, call **both** (details and examples for Windows Task Scheduler, cron and cloud schedulers: `docs/SCHEDULER.md`):

- `POST /api/cron/myloans-sync` with `x-cron-secret: <CRON_SECRET>` (or `npm run sync:myloans` on the app machine): the 30-minute change runs, the 02:00 catch-up and the daily branch and product lists. It decides itself what is due; runs never overlap.
- `POST /api/cron/email-reminders` with the same header.

Plus a daily backup (section 5), for example 01:00 Manila, before the 02:00 catch-up.

Check: Settings, MyLoans sync shows a run in the run log within 30 minutes; 3 failed runs in a row notify Admin and Superadmin.

## 3. First load from the cutoff

1. Settings, MyLoans sync: set **Go-live date**, and **Branch pool from (release date)** if it should differ from go-live minus 30 days.
2. Run once, from a trusted machine with the production environment: `npm run sync:myloans -- --first-load`. Released loans from the cutoff appear in each branch's LA pool (10b). Exit code 0 = done, 1 = failed (run again; nothing is lost), 2 = another run is busy.
3. Check: the run log shows the first load with its count; an LA of one sample branch sees the pool.

## 4. Go-live date

The go-live date is the day the DMS starts for real (Settings, MyLoans sync). It sets the default branch-pool cutoff (go-live minus 30 days). Pick a working day early in the week; avoid month-end release peaks.

## 5. Backups (D-055)

`npm run backup` writes one set: `gdfi-dms-YYYYMMDD-HHMMSS/` with `db.dump` (the whole database), `files/…` (receipts, stage evidence, LTO proof) and `manifest.json` (every file with its SHA-256). `npm run restore -- --into=<new database> --files-into=<empty folder>` checks every checksum first and only restores into a **clean copy**, never over the database in use. `npm run restore -- --list` lists the sets. Old sets are removed after `BACKUP_KEEP_DAYS` (default 30; the newest set is always kept).

Target, from the environment:

| Setting | Folder (disk / NAS) | S3-compatible bucket |
|---|---|---|
| `BACKUP_TARGET` | `folder` | `s3` |
| Where | `BACKUP_DIR` | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` |
| Keys | none | `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (secrets; never in the repository) |

The machine that runs the backup needs `pg_dump` / `pg_restore` (PostgreSQL 16 client tools) on its PATH, and read access to the storage folder.

**The 3-2-1 rule:** keep **3** copies of the data (the live database and files, plus two backups), on **2** different kinds of storage, with **1** copy off-site. Test a restore at least once a month (section 5.4) and after any hosting change; a backup that has never been restored is not a backup.

### 5.1 On-premise: disk or NAS, plus off-site

- App and database on a GDFI server. `BACKUP_TARGET=folder`, `BACKUP_DIR` on a **NAS share** (not the server's own disk). Copy 2 of 3.
- Off-site (copy 3): either a second `npm run backup` run with `BACKUP_TARGET=s3` to a cloud bucket, or the NAS's own replication to another office or the cloud. Keep the off-site copy for at least as long as `BACKUP_KEEP_DAYS`.
- Schedule: Windows Task Scheduler or cron, daily at 01:00, `npm run backup >> backup.log`. Check the log weekly.
- Protect the NAS share: only the backup account can write; staff cannot browse it.

### 5.2 Cloud object storage with versioning

- `BACKUP_TARGET=s3` to AWS S3, Cloudflare R2, Backblaze B2 or Wasabi (any S3-compatible service; path-style, Signature V4).
- Turn on **bucket versioning** and, where offered, **object lock** for at least 30 days, so a mistake or a ransomware run cannot delete the backups. Put a lifecycle rule to expire old versions after the retention period.
- Use keys that can only write to and read from that one bucket (no delete when object lock is on; retention then happens by lifecycle rule and `BACKUP_KEEP_DAYS` only tidies the listing).
- Keep a second copy in another region or another provider (bucket replication) for the off-site rule.

### 5.3 Supabase

- **Database:** Supabase keeps its own daily backups (and point-in-time recovery on paid plans). Treat those as copy 2, not as the only backup: they restore the whole project and do not hold the uploaded files.
- **Files and the DMS's own sets:** run `npm run backup` with `DIRECT_URL` (port 5432) as the connection, `BACKUP_TARGET=s3` and Supabase Storage's S3 endpoint (`https://<project>.supabase.co/storage/v1/s3`, region as shown in the Storage settings, the S3 access keys from there) **or**, better for the off-site rule, a bucket at another provider.
- Uploaded files stay on the app host's persistent disk until a Supabase Storage driver is built (`STORAGE_DRIVER=supabase` is not built).

### 5.4 Restore rehearsal (monthly)

1. `npm run restore -- --list`, pick the newest set.
2. `npm run restore -- --into=gdfi_dms_restore_check --files-into=<empty folder>`.
3. Point a staging copy of the app at the restored database and folder; sign in; open a loan and a receipt (the file route `/api/files/receipt/<id>`).
4. Drop the restore database. Write the date and result in the operations log.

(This was rehearsed on 18 November 2026: `tests/integration/backup.test.ts` restores a receipt into a clean copy and opens it through the file route.)

## 6. Go-live day checklist

| # | Step | Who | Done |
|---|---|---|---|
| 1 | `npm run test:contract` against myloans **staging** passes (APIs 1, 2, 4, 5) | Developer | ☐ |
| 2 | A backup of staging, and a restore rehearsal (5.4), both green | Developer | ☐ |
| 3 | Production environment set (section 1); the app starts; `/api/health` is 200 | Infrastructure | ☐ |
| 4 | `MYLOANS_MODE=live` with the production myloans address and key | Infrastructure | ☐ |
| 5 | Migrations: `npm run db:deploy`, then `npm run db:seed:reference` (never test users) | Developer | ☐ |
| 6 | Official holiday list entered (Settings, Holidays and working days) for this year and next | Admin | ☐ |
| 7 | Go-live date and branch-pool cutoff set (Settings, MyLoans sync) | Admin | ☐ |
| 8 | Users and roles: every LA, LA Supervisor/Head, DP, Finance, Admin; branches assigned; at least one approver per branch for Open Items (Admin Home warns when a branch has none) | Admin | ☐ |
| 9 | First load: `npm run sync:myloans -- --first-load`; the run log shows it; pools filled | Developer | ☐ |
| 10 | Scheduler on (section 2); a scheduled run appears within 30 minutes | Infrastructure | ☐ |
| 11 | Daily backup scheduled (section 5); the first set is written and listed | Infrastructure | ☐ |
| 12 | Sign-in checked: one person per role signs in with Microsoft and sees the right menu and branches | Admin, one tester per role | ☐ |
| 13 | Smoke: an LA accepts a pool item and opens a loan file; a DP accepts a job; Finance sees the funds queue | Testers | ☐ |
| 14 | Go / no-go call (section 7, "Who decides") | Project owner | ☐ |

## 7. Rollback plan

**Who decides:** the project owner, with the operations head. The developer and infrastructure advise. Roll back when staff cannot do their daily work in the DMS and the cause cannot be fixed the same day (for example: sign-in fails for many users, the sync cannot reach myloans for a working day, data shown is wrong).

**Switching the DMS off safely:**

1. Settings, MyLoans sync: **Pause MyLoans calls** (the run log shows it). Turn off the scheduler tasks.
2. Take a backup now (`npm run backup`) and write down the set name.
3. Tell staff the time the DMS stops; then stop the app (or put the host's maintenance page in front). Nothing is deleted.

**Staff back to the current process:** each team returns to the current paper and spreadsheet process from that moment. Team leads keep a list of loans handled while the DMS was off.

**Keeping the work entered:** the database and the files stay as they were (and in the backup). Nothing entered in the DMS is lost. Before trying again, the work done on paper meanwhile is entered or noted in the DMS (an LA per branch, from the team leads' lists); the myloans sync catches up by itself (the checkpoint did not move while paused).

**Trying again:** fix the cause; rehearse it on staging; agree a new date; run the go-live checklist again from step 1 (skipping the first load: it has run; the sync resumes from its checkpoint when unpaused).

## 8. After go-live (first weeks)

- Daily: the run log (Settings, MyLoans sync), Admin Home warnings, the backup log.
- Weekly: Open Items waiting (colours), the Unassigned queue, branches without an approver.
- Monthly: a restore rehearsal (5.4); review `BACKUP_KEEP_DAYS` and the bucket's retention.
