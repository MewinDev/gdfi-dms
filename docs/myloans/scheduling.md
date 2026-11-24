# MyLoans sync: scheduling (moved)

Last updated: 18 November 2026 (PHT)

This page described the old tiered background refresh, replaced by the one myloans sync on API 2 in piece 7 (D-052). Everything about scheduling is now in one place:

- **[../SCHEDULER.md](../SCHEDULER.md):** the myloans sync (`npm run sync:myloans`, `POST /api/cron/myloans-sync`), the email reminders (`POST /api/cron/email-reminders`) and the daily backup, with Windows Task Scheduler, cron and cloud examples.
- **[../GO_LIVE_RUNBOOK.md](../GO_LIVE_RUNBOOK.md):** the scheduler step of go-live and the backups.
- **[field-map.md](field-map.md):** what a sync compares.
