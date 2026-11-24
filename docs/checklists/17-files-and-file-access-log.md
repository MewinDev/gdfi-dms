# 17 Files and file access log

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Uploaded files: receipts, stage evidence (drop-off and pick-up proof) and LTO proof. All are served through one route that checks permission and branch scope, and every open or download is logged (D-019, D-039). Roles: DP (uploads), Finance and LA (view in scope), Superadmin (file access log).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Upload receipts (liquidation) and stage evidence (photo or receipt) | ✅ Built | My funds, Job stages | `funds:liquidate`, `jobs:work` | Processing stages (evidence needed) | `lib/storage/receipts.ts`, `job-stages.ts` | UAT DP-3, DP-8 |
| 2 | One file route; permission and branch scope checked | ✅ Built | `/api/files/<kind>/<id>` | by kind | No | `app/api/files/[kind]/[id]/route.ts` | UAT FIN-5 |
| 3 | Every open and download logged (append-only, user kept forever) | ✅ Built | n/a | n/a | No | `FileAccessLog`, e2e `file-access-log.spec.ts` | Open a receipt, find the row |
| 4 | File access log page: filter, export CSV (each export logged) | ✅ Built | Audit Log, File access log | `audit:files` (Superadmin) | No | `app/api/audit/files`; volume 6 ms at 60,000 rows | UAT SA-4 |
| 5 | Files on local disk (`STORAGE_DRIVER=local`) | ✅ Built | n/a | n/a | `STORAGE_LOCAL_DIR` | `lib/storage/index.ts` | n/a |
| 6 | Supabase Storage (or any cloud object store) driver | ❌ Missing (`STORAGE_DRIVER=supabase` throws "not implemented") | n/a | n/a | n/a | `lib/storage/index.ts` | n/a |
| 7 | Files included in backups with checksums; restore proven through the file route | ✅ Built | console | Infrastructure | Backup target | module 22 | n/a |
| 8 | Upload size and type limits for receipts and evidence | ⚠️ Partial: images and PDF accepted; size limited by the platform's request limit, no DMS setting | n/a | n/a | No | `lib/storage/receipts.ts` | n/a |
| 9 | Scanned documents (Digicur) | 📦 Later phase (C) | n/a | n/a | n/a | STATUS | n/a |

## D. Known limits and open questions

- Row 6 matters only if the app is hosted without a persistent disk (for example a serverless host): then a cloud storage driver is needed before go-live.
