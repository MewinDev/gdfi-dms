"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { kitBackupAction, kitResetAction, kitRestoreAction } from "@/app/actions/kit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ActionState } from "@/lib/action";

export interface KitSaveRow { name: string; kind: "baseline" | "backup" | "auto"; when: string; sizeKb: number; loanFiles: number; fits: boolean }
export interface KitBaseline { when: string; loanFiles: number; migrationCount: number; lastMigration: string; upToDate: boolean }

const KIND = { baseline: "Starting state", backup: "Backup", auto: "Automatic (before a reset)" } as const;

/** One reset or restore question: the person types RESET; the server checks it again. */
function TypedConfirm({ formId, open, title, body, pending, onCancel }: { formId: string; open: boolean; title: string; body: string; pending: boolean; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      body={
        <span className="flex flex-col gap-3">
          <span>{body}</span>
          <span className="flex flex-col gap-1">
            <label htmlFor={`${formId}-confirm`} className="label">Type RESET to confirm</label>
            <input id={`${formId}-confirm`} name="confirm" form={formId} className="input" autoComplete="off" spellCheck={false} />
          </span>
        </span>
      }
      confirmLabel={pending ? "Working..." : title.startsWith("Reset") ? "Reset" : "Restore"}
      tone="danger"
      confirmForm={formId}
      pending={pending}
      onCancel={onCancel}
    />
  );
}

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.ok
    ? <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-ok-fg">{state.message}</p>
    : <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-bad-fg">{state.error}</p>;
}

/** Settings > Test kit (only rendered, and only allowed, on a local test setup: see lib/kit/access.ts). */
export function TestKitPanel({ baseline, saves, database }: { baseline: KitBaseline | null; saves: KitSaveRow[]; database: string }) {
  const [ask, setAsk] = useState<null | { kind: "reset" } | { kind: "restore"; name: string }>(null);
  const [resetState, resetAction, resetting] = useActionState(async (p: ActionState, fd: FormData) => { const r = await kitResetAction(p, fd); setAsk(null); return r; }, null);
  const [restoreState, restoreAction, restoring] = useActionState(async (p: ActionState, fd: FormData) => { const r = await kitRestoreAction(p, fd); setAsk(null); return r; }, null);
  const [backupState, backupAction, saving] = useActionState(kitBackupAction, null);
  const backups = saves.filter((s) => s.kind !== "baseline");

  return (
    <div className="flex flex-col gap-6" data-test-kit>
      <section aria-labelledby="kit-start-title" className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="kit-start-title" className="text-lg font-bold text-navy">Starting state</h2>
          <span className="rounded-md bg-fill-strong px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-navy">TEST MODE</span>
        </div>
        {baseline ? (
          <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[auto_1fr]" data-kit-baseline>
            <dt className="text-ink-2">Saved</dt><dd>{baseline.when}</dd>
            <dt className="text-ink-2">Loan files</dt><dd>{baseline.loanFiles}</dd>
            <dt className="text-ink-2">Migration version</dt><dd className="break-all">{baseline.migrationCount} migrations, the last {baseline.lastMigration}</dd>
            <dt className="text-ink-2">Database</dt><dd>{database}</dd>
          </dl>
        ) : (
          <p className="text-[15px] text-ink-2">No starting state saved yet. Run <code>npm run kit:start</code> in a terminal.</p>
        )}
        {baseline && !baseline.upToDate && (
          <p role="alert" className="rounded-xl bg-warn-bg px-4 py-3 text-warn-fg">The baseline is out of date. Run <code>npm run kit:rebuild</code>.</p>
        )}
        <p className="text-[15px] text-ink-2">Reset puts every loan, account and setting back to the starting state. A backup of what is there now is taken first (the last 5 are kept). Emails stay off.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-danger" disabled={!baseline || !baseline.upToDate} onClick={() => setAsk({ kind: "reset" })}>Reset to start</button>
          <Link href="/admin/test-kit/sheet" className="link inline-flex min-h-11 items-center">Open the test sheet</Link>
        </div>
        <Result state={resetState} />
        <form id="kit-reset-form" action={resetAction} hidden />
      </section>

      <section aria-labelledby="kit-backup-title" className="card flex flex-col gap-3 p-5">
        <h2 id="kit-backup-title" className="text-lg font-bold text-navy">Take a backup</h2>
        <p className="text-[15px] text-ink-2">Saves everything as it is now, under a name. The file is in storage/kit/backups; copy it to use it on another PC.</p>
        <form action={backupAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="kit-backup-name" className="label">Backup name</label>
            <input id="kit-backup-name" name="name" className="input" placeholder="after-funds-round" maxLength={60} autoComplete="off" />
          </div>
          <button type="submit" className="btn-secondary" disabled={saving}>{saving ? "Saving..." : "Take backup"}</button>
        </form>
        <Result state={backupState} />
      </section>

      <section aria-labelledby="kit-list-title" className="card flex flex-col gap-3 p-5">
        <h2 id="kit-list-title" className="text-lg font-bold text-navy">Backups</h2>
        {backups.length === 0 ? (
          <p className="text-[15px] text-ink-2">No backups yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-kit-backups>
            {backups.map((s) => (
              <li key={s.name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-ink-2">{KIND[s.kind]} · {s.when} · {s.sizeKb} KB · {s.loanFiles} loan files{s.fits ? "" : " · other migrations, cannot be restored"}</p>
                </div>
                <button type="button" className="btn-secondary btn-sm min-h-11 shrink-0" disabled={!s.fits} onClick={() => setAsk({ kind: "restore", name: s.name })} aria-label={`Restore ${s.name}`}>Restore</button>
              </li>
            ))}
          </ul>
        )}
        <Result state={restoreState} />
        <form id="kit-restore-form" action={restoreAction} hidden>
          <input type="hidden" name="name" value={ask?.kind === "restore" ? ask.name : ""} />
        </form>
      </section>

      <TypedConfirm formId="kit-reset-form" open={ask?.kind === "reset"} title="Reset to the starting state?" pending={resetting}
        body="Everything in this database goes back to the starting state: loans, accounts, settings. A backup is taken first." onCancel={() => setAsk(null)} />
      <TypedConfirm formId="kit-restore-form" open={ask?.kind === "restore"} title={`Restore ${ask?.kind === "restore" ? ask.name : ""}?`} pending={restoring}
        body="Everything in this database is replaced by this backup. A backup of what is there now is taken first." onCancel={() => setAsk(null)} />
    </div>
  );
}
