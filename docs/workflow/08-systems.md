# Systems around the workflow

MyLoans sync, the branch list from MyLoans, email and the environment settings.

Last updated: 9 November 2026 (PHT)

- **MyLoans sync.** Find loan is a live lookup by PN; the DMS stores only loans that someone opened. Refresh on open when the copy is older than 15 minutes (default). Background refresh of active loans in tiers: work in progress hourly, not yet sent every 4 hours, finished but not closed daily, closed or cancelled never; business hours; a per-run cap; an hourly call ceiling. Replacement PN (same details, old PN ended, no payment) is linked by Admin; an additional unit (new application, same borrower) is shown in Related loans with no link.
- **The PN check.** Find loan, the search box, imports and every MyLoans call go through one parser (`parsePn`, lib/pn/format.ts) with the rules in Settings, System, PN format. A wrong PN never reaches MyLoans.
- **Branches from MyLoans.** MyLoans is the source of truth for a branch's code, name, area, division and status (Division > Area > Branch); in the DMS those fields are read-only for MyLoans branches, and DMS-only fields (the usual LTO office, Hide from DMS) stay editable. Branches, areas and divisions are matched by their MyLoans ids first and by code (or name) only when there is no id, so a rename or a changed code is an update, not "new plus missing".
  - **Now (no API yet): Import from MyLoans** (Settings, Branches): the tab-separated dump without a header row (division_id, division_name, area_id, area_name, branch_id, branch_code, an unknown column that is ignored and never stored, branch_name, address) or a CSV with a header row (aliases accepted; optional is_active and updated_at). A preview (New, Changed, Unchanged, Not in this file, counts per Division and Area, the access impact, test-looking rows first) and Admin confirms. Rows without a status are Active, except test or unused-looking rows (name with "test" or "don't use", code 999, address "Test Only"), which come in Inactive with "Looks like a test or unused branch" and a suggestion to hide them.
  - **Later (API): Branches from MyLoans** (`listBranches()` in the MyLoans adapter; mock now, a placeholder in the live adapter and `live-mapping.ts`): the same review. One run a day at about 02:00 PHT through the cron endpoint (the time and a pause switch are settings), with the advisory lock; incremental (updated since the last successful run) when the API allows it, otherwise the full list compared branch by branch; paged; a full list once a week to find branches that disappeared ("Not in the last list", never deleted). An unknown branch code in a PN adds an item to the Branch review and triggers at most one small refresh an hour; the lookup is never blocked. Every run is recorded (time, mode, new, changed, unchanged, missing, errors); a failed run changes nothing.
  - **No direct database access.** The DMS never connects to the MyLoans database (MYLOSDB) and never runs SQL against it. The feed is the API through `listBranches()`, or an export file until then. If the MyLoans team can only offer database access, it must be a read-only login on a read-only view or replica, used only inside that one adapter method, never ad-hoc SQL elsewhere in the app.
- **Email.** Another channel of the in-app notifications, through Microsoft Graph. One master switch in Settings, System, **Not active** by default. Test mode redirects every email to a test address.
- **Environment.** `.env` for non-secret defaults, `.env.local` for this PC's secrets, hosting settings for production. `APP_ENV` is local, staging or production; production refuses to start with test mode on or mock MyLoans. Details: [Environment variables](../ENVIRONMENT.md).

## Questions for the MyLoans team

- A branches endpoint: id, code, name, area (id and name), division (id and name), status (active or inactive), address and updatedAt, paged, ideally with an "updated since" filter.
- Is the branch id stable when a branch's code changes?
- Does the loan record carry its current branch (code and name), and a branch-changed time?
- Can a loan move to another branch after release, and does its PN stay the same?
- Do PNs of the other companies in the MyLoans Company dropdown use another prefix than GD?
- What is the unknown 8-digit column of the branch export (it is not stored)?

[Back to the workflow index](README.md)
