"use client";

import { useActionState, useId } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { announcing } from "@/components/ui/live-toast";
import { runSyncNowAction, syncSettingsAction } from "@/app/actions/source";
import { SAVED_EVENT } from "./settings-modal";

const runNow = announcing(runSyncNowAction);

export interface SyncRunRow { when: string; trigger: string; mode: string; status: string; due: number; calls: number; saved: number; avgMs: number; maxMs: number; errors: number; ms: number; updated: number; changes: number; cap: number; hour: string }

export interface SyncCardData {
  refreshOnOpenMinutes: number;
  backgroundMinutes: number;
  businessHoursOnly: boolean;
  maxPerRun: number;
  pauseMs: number;
  tierA: number; tierB: number; tierC: number;
  hourlyCeiling: number;
  replacementWindowDays: number;
  mode: "Mock" | "Live";
  search: boolean;
  changedSince: boolean;
  health: string;
  lines: { label: string; value: string; bad?: boolean }[];
  tiers: { A: number; B: number; C: number };
  runs: SyncRunRow[];
}

/** Settings > System > MyLoans sync: health, the last runs, active loans per tier, and the settings. */
export function MyLoansSyncForm({ d, formId }: { d: SyncCardData; formId: string }) {
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof syncSettingsAction>>, fd: FormData) => {
    const r = await syncSettingsAction(prev, fd);
    if (r?.ok) window.dispatchEvent(new Event(SAVED_EVENT));
    return r;
  }, null);
  const [run, runAction] = useActionState(runNow, null);
  const uid = useId();
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const field = (name: keyof SyncCardData, label: string, help: string, value: number) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="label">{label}</label>
      <input id={`${uid}-${name}`} name={name} inputMode="numeric" defaultValue={value} className="input" aria-invalid={!!err(name)} aria-describedby={`${uid}-${name}-h`} />
      <p id={`${uid}-${name}-h`} className="help">{help}</p>
      {err(name) && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err(name)}</p>}
    </div>
  );
  const tone = d.health === "Healthy" ? "bg-ok-bg text-ok-fg" : d.health.startsWith("Paused") ? "bg-bad-bg text-bad-fg" : "bg-act-bg text-act-fg";
  return (
    <div className="flex flex-col gap-5" data-myloans-sync>
      <p className={`rounded-xl px-3 py-2 text-[15px] font-bold ${tone}`} data-sync-health>{d.health}</p>
      <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-fill p-3 text-sm sm:grid-cols-2" data-sync-status>
        {d.lines.map((l) => (
          <div key={l.label} className="flex min-w-0 justify-between gap-3 border-b border-line/60 pb-1 sm:block sm:border-0">
            <dt className="text-ink-2">{l.label}</dt>
            <dd className={`text-right font-semibold sm:mt-0.5 sm:text-left ${l.bad ? "text-bad-fg" : "text-navy"}`}>{l.value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby={`${uid}-tiers`}>
        <h3 id={`${uid}-tiers`} className="mb-1.5 text-[15px] font-bold text-navy">Active loans by how often they are checked</h3>
        <ul className="grid grid-cols-3 gap-2" data-sync-tiers>
          {([["A", "Work in progress", d.tierA], ["B", "Not yet sent", d.tierB], ["C", "Finished, not closed", d.tierC]] as const).map(([k, label, m]) => (
            <li key={k} className="rounded-xl border border-line px-3 py-2">
              <span className="block text-[22px] font-bold leading-none text-navy">{d.tiers[k]}</span>
              <span className="mt-1 block text-[13px] font-semibold">{k}: {label}</span>
              <span className="block text-[12px] text-ink-2">every {m >= 60 ? `${+(m / 60).toFixed(1)} h` : `${m} min`}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[12px] text-ink-2">Closed and cancelled loans are never checked.</p>
      </section>
      <form action={runAction} className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn-secondary" pendingText="Checking loans...">Run now</SubmitButton>
        <span className="text-[13px] text-ink-2">Checks the loans that are due now (the cap and the hourly limit apply). Recorded in the audit log.</span>
        <div className="basis-full"><FormMessage state={run} /></div>
      </form>
      <section aria-labelledby={`${uid}-runs`}>
        <h3 id={`${uid}-runs`} className="mb-1.5 text-[15px] font-bold text-navy">Last runs</h3>
        {d.runs.length === 0 ? <p className="rounded-xl bg-fill px-3 py-3 text-sm text-ink-2">No runs yet.</p> : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-line" data-sync-runs>
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <caption className="sr-only">Last 10 MyLoans sync runs</caption>
              <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2">
                <tr>{["Time (PHT)", "How", "Result", "Due", "Calls", "Saved", "Avg / slowest", "Errors", "Updated", "Changes", "Cap", "This hour", "Took"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {d.runs.map((r) => (
                  <tr key={r.when + r.trigger} className="border-t border-line-soft">
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.when}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.trigger} · {r.mode}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5"><span className={`chip h-6 text-xs ${r.status === "healthy" ? "c-ok" : r.status === "paused" ? "c-bad" : "c-act"}`}>{r.status === "healthy" ? "Healthy" : r.status === "paused" ? "Paused" : "Slowed down"}</span></td>
                    <td className="px-2.5 py-1.5">{r.due}</td><td className="px-2.5 py-1.5">{r.calls}</td><td className="px-2.5 py-1.5">{r.saved}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.avgMs} / {r.maxMs} ms</td><td className="px-2.5 py-1.5">{r.errors}</td>
                    <td className="px-2.5 py-1.5">{r.updated}</td><td className="px-2.5 py-1.5">{r.changes}</td><td className="px-2.5 py-1.5">{r.cap}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.hour}</td><td className="whitespace-nowrap px-2.5 py-1.5">{r.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <form id={formId} data-track-dirty action={action} className="grid gap-4 sm:grid-cols-2">
        {field("refreshOnOpenMinutes", "Refresh when opened if older than (minutes)", "0 means every time a loan file is opened.", d.refreshOnOpenMinutes)}
        {field("backgroundMinutes", "Background run every (minutes)", "How often the sync runs; each loan is checked by its tier below.", d.backgroundMinutes)}
        {field("tierA", "Work in progress: check every (minutes)", "Sent or in process, cash out, a change under review.", d.tierA)}
        {field("tierB", "Not yet sent: check every (minutes)", "Checking papers, ready to send.", d.tierB)}
        {field("tierC", "Finished, not closed: check every (minutes)", "Vault, DigiCur, pull-out, QA.", d.tierC)}
        {field("maxPerRun", "Loans per run (at most)", "Lowered by itself when MyLoans is slow, and raised again when healthy.", d.maxPerRun)}
        {field("pauseMs", "Pause between calls (milliseconds)", "A little random time is added so calls do not line up.", d.pauseMs)}
        {field("hourlyCeiling", "Calls to MyLoans per hour (at most)", "At the limit the background sync waits for the next hour; people opening a loan still get it.", d.hourlyCeiling)}
        {field("replacementWindowDays", "Replacement: released within (days)", "A new PN is a possible replacement only when released within this many days of the old one, or after it ended.", d.replacementWindowDays)}
        <label className="flex min-h-11 items-start gap-3 sm:col-span-2">
          <input type="checkbox" name="businessHoursOnly" defaultChecked={d.businessHoursOnly} className="mt-0.5 h-5 w-5 accent-[var(--navy)]" />
          <span><span className="block text-[15px] font-semibold">Business hours only</span><span className="block text-[13px] text-ink-2">Mon to Sat, 7:00 AM to 7:00 PM, Philippine time. Holidays are skipped.</span></span>
        </label>
        {state && !state.ok && !["refreshOnOpenMinutes", "backgroundMinutes", "maxPerRun", "pauseMs", "tierA", "tierB", "tierC", "hourlyCeiling", "replacementWindowDays"].includes(state.field ?? "") && <div className="sm:col-span-2"><FormMessage state={state} /></div>}
      </form>
    </div>
  );
}
