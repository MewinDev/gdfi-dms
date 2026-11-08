# Systems around the workflow

MyLoans sync, email and the environment settings.

Last updated: 8 November 2026 (PHT)

- **MyLoans sync.** Find loan is a live lookup by PN; the DMS stores only loans that someone opened. Refresh on open when the copy is older than 15 minutes (default). Background refresh of active loans in tiers: work in progress hourly, not yet sent every 4 hours, finished but not closed daily, closed or cancelled never; business hours; a per-run cap; an hourly call ceiling. Replacement PN (same details, old PN ended, no payment) is linked by Admin; an additional unit (new application, same borrower) is shown in Related loans with no link.
- **Email.** Another channel of the in-app notifications, through Microsoft Graph. One master switch in Settings, System, **Not active** by default. Test mode redirects every email to a test address.
- **Environment.** `.env` for non-secret defaults, `.env.local` for this PC's secrets, hosting settings for production. `APP_ENV` is local, staging or production; production refuses to start with test mode on or mock MyLoans. Details: [Environment variables](../ENVIRONMENT.md).

[Back to the workflow index](README.md)
