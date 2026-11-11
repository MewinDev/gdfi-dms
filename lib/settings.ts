import { prisma, type Tx } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { MockOverride } from "@/lib/myloans/mock-adapter";
import type { MyLoansRecord } from "@/lib/myloans/types";

/** System toggles and small JSON settings stored in the Setting table. */
export const SETTING_DEFAULTS = {
  "myloans.simulateUnavailable": false as boolean,
  "simulator.enabled": false as boolean,
  /** TEST_MODE only: list the data-check mock PNs under the sample loans. */
  "samples.showDataCheck": false as boolean,
  /** Mock-only: per-PN changes to demonstrate a source change after opening (with when it changed). */
  "myloans.mockOverrides": {} as Record<string, MockOverride>,
  /** Mock-only: extra source loans (a replacement PN made by the simulator). */
  "myloans.mockExtra": [] as MyLoansRecord[],
  /** MyLoans sync: refresh a loan when it is opened if its copy is older than this (minutes; 0 = always). */
  "myloans.refreshOnOpenMinutes": 60 as number,
  /** MyLoans sync: when Find a loan shows a saved loan, refresh it in the background if last checked more than this many hours ago (0 = never). */
  "myloans.refreshOnFindHours": 4 as number,
  /** MyLoans sync: background refresh every this many minutes (active loans only). */
  "myloans.backgroundMinutes": 60 as number,
  /** MyLoans sync: background refresh only Mon to Sat, 7:00 AM to 7:00 PM PHT, holidays skipped. */
  "myloans.businessHoursOnly": true as boolean,
  /** MyLoans sync: at most this many loans per run, with this pause between calls. */
  "myloans.maxPerRun": 50 as number,
  "myloans.pauseMs": 500 as number,
  /** Replacement PN: the new loan must be released within this many days of the old one (or after it ended). */
  "myloans.replacementWindowDays": 30 as number,
  /** MyLoans sync: polling interval per tier, in minutes (A work in progress, B not yet sent, C finished steps not closed). */
  "myloans.tierMinutes": { A: 60, B: 240, C: 1440 } as { A: number; B: number; C: number },
  /** MyLoans sync: at most this many calls to MyLoans an hour; background sync pauses until the hour turns. */
  "myloans.hourlyCeiling": 600 as number,
  /** MyLoans sync: average answer slower than this (ms) halves the per-run cap. */
  "myloans.slowMs": 2000 as number,
  /** Admin: "Pause MyLoans calls". On: the background run, the stale refresh and refresh on open make no call. */
  "myloans.paused": false as boolean,
  /** Admin data check: loans refused because MyLoans has no borrower name at all (the latest 50). */
  "myloans.noNameLoans": [] as { pn: string; branch: string | null; at: string }[],
  /** MyLoans sync: the feed cursor, the adaptive cap and the last 10 runs. */
  "myloans.state": { cursor: null, cap: null, runs: [] } as { cursor: string | null; cap: number | null; runs: import("@/lib/services/source-sync").RunStat[] },
  /** MyLoans sync: the last background run (Run now included). */
  "myloans.lastRun": null as null | { at: string; ok: boolean; checked: number; changes: number; failed: number; error: string | null; trigger: string; status?: string },
  /** Funds: a balance may carry over to the next attempt without approval for up to this many business days. */
  "funds.carryOverLimitDays": 3 as number,
  /** Funds: an advance must be liquidated within this many business days of release (restarts at each carry-over decision). */
  "funds.liquidationDueDays": 10 as number,
  /** Funds: block "At the LTO" while a funds-flagged transaction is not Funded. */
  "funds.blockLtoUntilFunded": true as boolean,
  /** Monitoring: the default capacity of a processor, in open jobs (Settings, Processor capacity). */
  "dp.defaultCapacity": 10 as number,
  /** Email notifications: the master switch. Not active until the system goes live. */
  "email.active": false as boolean,
  /** Email notifications: per-event switches (missing = on). */
  "email.events": {} as Record<string, boolean>,
  /** Email notifications: edited messages per event (missing = the default in lib/email/templates.ts). */
  "email.templates": {} as Record<string, { subject: string; body: string }>,
  /** PN format (Settings, System, PN format): the parts and the switch that turns the check off. */
  "pn.format": { enabled: true, prefix: "GD", branchDigits: 3, yearDigits: 4, system: "9", runningDigits: 5 } as import("@/lib/pn/format").PnFormat,
  /**
   * Branches from MyLoans: the daily run (time in PHT, pause switch), the updated-since cursor (last
   * successful run), the last weekly full check, and the hourly lock for an unknown code in a PN.
   */
  "branches.sync": { time: "02:00", paused: false, lastRunDate: null, lastSuccessAt: null, lastFullAt: null, lastLookupAt: null } as {
    time: string; paused: boolean; lastRunDate: string | null; lastSuccessAt: string | null; lastFullAt: string | null; lastLookupAt: string | null;
  },
  /** Mock-only: branch list changes in the sample MyLoans (rename, code change, close), by MyLoans branch id. */
  "myloans.mockBranches": { overrides: {}, extra: [] } as { overrides: Record<string, Partial<import("@/lib/branches/file").MyLoansBranchRow>>; extra: import("@/lib/branches/file").MyLoansBranchRow[] },
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(key: K, db: Tx | typeof prisma = prisma): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as SettingValue<K> | undefined) ?? SETTING_DEFAULTS[key];
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>, db: Tx | typeof prisma = prisma) {
  const json = value as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

export async function getHolidaySet(db: Tx | typeof prisma = prisma): Promise<Set<string>> {
  // Inactive holidays are no longer skipped when counting business days.
  const rows = await db.holidayCalendar.findMany({ where: { active: true }, select: { date: true } });
  return new Set(rows.map((r) => r.date));
}

export async function getTatMap(db: Tx | typeof prisma = prisma): Promise<Map<string, { businessDays: number; note: string; label: string }>> {
  const rows = await db.tatRule.findMany();
  return new Map(rows.map((r) => [r.key, { businessDays: r.businessDays, note: r.note, label: r.label }]));
}
