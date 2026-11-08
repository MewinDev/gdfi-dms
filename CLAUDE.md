# GDFI-DMS: notes for Claude Code

@AGENTS.md

## Documentation rule

- When a change alters a workflow rule, a status, a turnaround target, a role or permission, or a screen flow described in `docs/workflow/`, update the matching file and its "Last updated" date (Philippine date) in the same change.
- When a planned item in `docs/workflow/09-status-and-open-questions.md` is built, change its status to Built only after verifying it in the app, with one line of evidence.
- Keep the diagrams' meaning unless the workflow itself changed. `lib/docs/workflow-docs.test.ts` checks titles, dates, links and Mermaid blocks.
