"use client";

import { useActionState, useId } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { pauseMyLoansAction, runSyncNowAction, syncSettingsAction } from "@/app/actions/source";
import { SAVED_EVENT } from "./settings-modal";

const runNow = announcing(runSyncNowAction);
const pauseIt = announcing(pauseMyLoansAction);
const FIND_LABEL = "When a saved loan is found, refresh it from MyLoans if last checked more than this many hours ago";

/** One row of the run log (piece 7). */
export interface SyncRunRow { id: string; when: string; how: string; kind: string; result: "ok" | "failed" | "skipped"; rows: number; reviews: number; candidates: number; duplicates: number; took: string; note: string }

export interface SyncCardData {
  refreshOnOpenMinutes: number;
  refreshOnFindHours: number;
  hourlyCeiling: number;
  intervalMinutes: number;
  catchUpTime: string;
  catchUpHours: number;
  alertAfterFailedRuns: number;
  goLiveDate: string;
  cutoffDate: string;
  health: string;
  lines: { label: string; value: string; bad?: boolean }[];
  runs: SyncRunRow[];
  /** Admin's "Pause MyLoans calls". */
  paused: boolean;
}

/** "Pause MyLoans calls" (myloans:manage): the automatic paths make no call; a person's Refresh and Find loan still do. */
function PauseSwitch({ paused, canManage }: { paused: boolean; canManage: boolean }) {
  const [state, action] = useActionState(pauseIt, null);
  return (
    <form action={action} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${paused ? "border-bad-fg/50 bg-bad-bg" : "border-line"}`} data-myloans-pause={paused ? "on" : "off"}>
      <input type="hidden" name="paused" value={paused ? "off" : "on"} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-navy">Pause MyLoans calls: {paused ? "On" : "Off"}</p>
        <p className="text-[13px] text-ink-2">{paused
          ? "MyLoans calls are paused by Admin. The sync, the refresh when a saved loan is found and the refresh when a loan file is opened make no call. Refresh from MyLoans and Find loan for a new PN still work."
          : "When on, the sync and the automatic refreshes make no call to MyLoans. Refresh from MyLoans and Find loan for a new PN still work."}</p>
      </div>
      {canManage && <SubmitButton className={paused ? "btn-secondary" : "btn-ghost"}>{paused ? "Turn MyLoans calls back on" : "Pause MyLoans calls"}</SubmitButton>}
      <div className="basis-full empty:hidden"><FormMessage state={state} /></div>
    </form>
  );
}

const FIELDS = ["refreshOnOpenMinutes", "refreshOnFindHours", "hourlyCeiling", "intervalMinutes", "catchUpTime", "catchUpHours", "alertAfterFailedRuns", "goLiveDate", "cutoffDate"] as const;

/**
 * Settings > System > MyLoans sync (piece 7, D-052): health, the run log, Run now, and the settings.
 * canManage: the settings form (myloans:manage); canRun: Run now (myloans:sync). The other part is read only.
 */
export function MyLoansSyncForm({ d, formId, canManage = true, canRun = true }: { d: SyncCardData; formId: string; canManage?: boolean; canRun?: boolean }) {
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof syncSettingsAction>>, fd: FormData) => {
    const r = await syncSettingsAction(prev, fd);
    if (r?.ok) window.dispatchEvent(new Event(SAVED_EVENT));
    return r;
  }, null);
  const [run, runAction] = useActionState(runNow, null);
  const uid = useId();
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const field = (name: (typeof FIELDS)[number], label: string, help: string, value: number | string, type: "text" | "date" | "time" = "text") => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="label">{label}</label>
      <input id={`${uid}-${name}`} name={name} type={type} inputMode={type === "text" ? "numeric" : undefined} defaultValue={value} className="input" aria-invalid={!!err(name)} aria-describedby={`${uid}-${name}-h`} />
      <p id={`${uid}-${name}-h`} className="help">{help}</p>
      {err(name) && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err(name)}</p>}
    </div>
  );
  const tone = d.health === "Healthy" ? "bg-ok-bg text-ok-fg" : d.health.startsWith("Paused") || d.health.startsWith("Failing") ? "bg-bad-bg text-bad-fg" : "bg-act-bg text-act-fg";
  return (
    <div className="flex flex-col gap-5" data-myloans-sync>
      <p className={`rounded-xl px-3 py-2 text-[15px] font-bold ${tone}`} data-sync-health>{d.health}</p>
      <PauseSwitch paused={d.paused} canManage={canManage} />
      <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-fill p-3 text-sm sm:grid-cols-2" data-sync-status>
        {d.lines.map((l) => (
          <div key={l.label} className="flex min-w-0 justify-between gap-3 border-b border-line/60 pb-1 sm:block sm:border-0">
            <dt className="text-ink-2">{l.label}</dt>
            <dd className={`text-right font-semibold sm:mt-0.5 sm:text-left ${l.bad ? "text-bad-fg" : "text-navy"}`}>{l.value}</dd>
          </div>
        ))}
      </dl>
      {canRun && (
        <form action={runAction} className="flex flex-wrap items-center gap-3" data-sync-run-now>
          <SubmitButton className="btn-secondary" pendingText="Reading changes..." name="mode" value="CHANGE">Run now</SubmitButton>
          <SubmitButton className="btn-ghost" pendingText="Reading changes..." name="mode" value="CATCHUP">Run the catch-up now</SubmitButton>
          <span className="text-[13px] text-ink-2">Reads what changed in myloans. Nothing is applied: a change to a loan or borrower field waits as an Open Item for the branch&rsquo;s approvers; renames update by themselves.</span>
          <div className="basis-full"><FormMessage state={run} /></div>
        </form>
      )}
      <section aria-labelledby={`${uid}-runs`}>
        <h3 id={`${uid}-runs`} className="mb-1.5 text-[15px] font-bold text-navy">Run log</h3>
        {d.runs.length === 0 ? <p className="rounded-xl bg-fill px-3 py-3 text-sm text-ink-2">No runs yet.</p> : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-line" data-sync-runs>
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <caption className="sr-only">The latest myloans sync runs</caption>
              <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2">
                <tr>{["Time (PHT)", "How", "Result", "Changes read", "Loans with Open Items", "Not in DMS yet", "Sent twice", "Took", "Note"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {d.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft" data-sync-run={r.result}>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.when}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.how} · {r.kind}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5"><span className={`chip h-6 text-xs ${r.result === "ok" ? "c-ok" : r.result === "failed" ? "c-bad" : "c-wait"}`}>{r.result === "ok" ? "Done" : r.result === "failed" ? "Failed" : "Skipped"}</span></td>
                    <td className="px-2.5 py-1.5">{r.rows}</td><td className="px-2.5 py-1.5">{r.reviews}</td><td className="px-2.5 py-1.5">{r.candidates}</td><td className="px-2.5 py-1.5">{r.duplicates}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.took}</td>
                    <td className="px-2.5 py-1.5">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!canManage ? (
        <section aria-label="Sync settings (read only)" data-sync-settings-readonly>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {([
              ["Run the sync every (minutes)", d.intervalMinutes], ["Daily catch-up at (Philippine time)", d.catchUpTime], ["Catch-up reads the last (hours)", d.catchUpHours],
              ["Alert Admin after this many failed runs in a row", d.alertAfterFailedRuns], ["Go-live date", d.goLiveDate || "Not set"], ["Branch pool from (release date)", d.cutoffDate || "Go-live minus 30 days"],
              ["Refresh when opened if older than (minutes)", d.refreshOnOpenMinutes], [FIND_LABEL, d.refreshOnFindHours], ["Calls to MyLoans per hour (at most)", d.hourlyCeiling],
            ] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line py-1"><dt className="text-ink-2">{k}</dt><dd className="font-semibold text-navy">{v}</dd></div>)}
          </dl>
          <p className="mt-2 text-[13px] text-ink-2">Read only. Ask a Superadmin to turn on &ldquo;Change MyLoans sync settings&rdquo; for your role to change them.</p>
        </section>
      ) : (
      <form id={formId} data-track-dirty action={action} className="grid gap-4 sm:grid-cols-2">
        {field("intervalMinutes", "Run the sync every (minutes)", "The scheduler calls often; a change run starts when this much time has passed.", d.intervalMinutes)}
        {field("catchUpTime", "Daily catch-up at (Philippine time)", "Reads again everything changed in the last hours below, in case a run missed something.", d.catchUpTime, "time")}
        {field("catchUpHours", "Catch-up reads the last (hours)", "26 hours covers a whole day with some overlap.", d.catchUpHours)}
        {field("alertAfterFailedRuns", "Alert Admin after this many failed runs in a row", "A failed run keeps the checkpoint: nothing is lost, the next good run catches up.", d.alertAfterFailedRuns)}
        {field("goLiveDate", "Go-live date", "The day the DMS starts for real.", d.goLiveDate, "date")}
        {field("cutoffDate", "Branch pool from (release date)", "Released loans not yet in the DMS are kept from this date. Empty: go-live minus 30 days.", d.cutoffDate, "date")}
        {field("refreshOnOpenMinutes", "Refresh when opened if older than (minutes)", "0 means every time a loan file is opened.", d.refreshOnOpenMinutes)}
        {field("refreshOnFindHours", FIND_LABEL, "Runs once in the background after Find a loan shows the saved loan; it never delays opening it. 0 means never.", d.refreshOnFindHours)}
        {field("hourlyCeiling", "Calls to MyLoans per hour (at most)", "For Find loan and the refreshes of one loan. The sync reads pages and is not counted here.", d.hourlyCeiling)}
        {state && !state.ok && !(FIELDS as readonly string[]).includes(state.field ?? "") && <div className="sm:col-span-2"><FormMessage state={state} /></div>}
      </form>
      )}
    </div>
  );
}
