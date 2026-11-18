import { prisma, type Tx } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { MockOverride } from "@/lib/myloans/mock-adapter";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { DEFAULT_CLASSIFICATION_RULES, asRules, type ClassificationRules, type Keyword } from "@/lib/rules/classify";

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
  /** Mock-only (D-048): failure simulation switches for the myloans mock (never in production). */
  "myloans.mockFailures": [] as import("@/lib/myloans/v1/failures").MockFailure[],
  /** MyLoans sync: refresh a loan when it is opened if its copy is older than this (minutes; 0 = always). */
  "myloans.refreshOnOpenMinutes": 60 as number,
  /** MyLoans sync: when Find a loan shows a saved loan, refresh it in the background if last checked more than this many hours ago (0 = never). */
  "myloans.refreshOnFindHours": 4 as number,
  /** MyLoans sync: at most this many calls to MyLoans an hour; background sync pauses until the hour turns. */
  "myloans.hourlyCeiling": 600 as number,
  /** Admin: "Pause MyLoans calls". On: the sync, the stale refresh and refresh on open make no call. */
  "myloans.paused": false as boolean,
  /** Admin data check: loans refused because MyLoans has no borrower name at all (the latest 50). */
  "myloans.noNameLoans": [] as { pn: string; branch: string | null; at: string }[],
  /**
   * Piece 7 (D-052): the one myloans sync (API 2). A change run every intervalMinutes; the daily catch-up at catchUpTime
   * (Manila) over the last catchUpHours; Admin is alerted after alertAfterFailedRuns failed runs in a row. Released
   * loans not yet in the DMS are kept from the branch-pool cutoff (cutoffDate, else go-live minus 30 days).
   */
  "myloans.sync": { intervalMinutes: 30, catchUpTime: "02:00", catchUpHours: 26, alertAfterFailedRuns: 3, goLiveDate: null, cutoffDate: null } as import("@/lib/services/myloans-sync").SyncConfig,
  /** Piece 11 (D-054): when the product list (API 5) was last read. */
  "products.lastReadAt": null as string | null,
  /** Piece 8 (D-012, D-053): the fields that raise Open Items (the status always does: it blocks Forward). */
  "openItems.monitoredFields": ["loanType", "amount", "productCode", "releaseDate", "branchCode", "sourceLoanId", "borrowerName", "cif", "cin"] as string[],
  /** Piece 7: the checkpoint (moves only after a whole good run), failed runs in a row, the last catch-up and run. */
  "myloans.syncState": { checkpoint: null, failedRuns: 0, lastCatchUpDate: null, lastRunAt: null } as import("@/lib/services/myloans-sync").SyncState,
  /** Funds: a balance may carry over to the next attempt without approval for up to this many business days. */
  "funds.carryOverLimitDays": 3 as number,
  /** Funds: block "At the LTO" while a funds-flagged transaction is not Funded. */
  "funds.blockLtoUntilFunded": true as boolean,
  /**
   * Funds (D-024): approval amount bands. Off (the default, as v2): anyone with the type's Approve tick who
   * handles that type approves. On: only the roles of the band for the amount (Settings, Approval bands).
   */
  "funds.approvalBandsOn": false as boolean,
  /** Product classification (D-031): Refinancing keywords first, then Financing, else the default. */
  "classification.rules": DEFAULT_CLASSIFICATION_RULES as { refinancing: (Keyword | string)[]; financing: (Keyword | string)[]; fallback: "FINANCING" | "REFINANCING" },
  /** Working days (D-018, D-041): Sunday (0) to Saturday (6); default Monday to Saturday. At least one must be on. */
  "calendar.workingDays": [false, true, true, true, true, true, true] as boolean[],
  /** A holiday or closure dated before today may be added this many days back at most (D-041), with a reason. */
  "calendar.backdateMaxDays": 7 as number,
  /** Branch pool (D-046): an item waiting this many working days or more is amber, then red. */
  "pool.amberAfterDays": 1 as number,
  "pool.redAfterDays": 2 as number,
  /** Due-date colour (D-041): amber when this many working days are left or fewer (0 = only on the due day). */
  "tat.amberWithinDays": 1 as number,
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

export async function getTatMap(db: Tx | typeof prisma = prisma): Promise<Map<string, { businessDays: number; note: string; label: string }>> {
  const rows = await db.tatRule.findMany();
  return new Map(rows.map((r) => [r.key, { businessDays: r.businessDays, note: r.note, label: r.label }]));
}

/** Product classification (D-031, D-034): the saved keyword lists, older plain strings read as "starts a word". */
export async function getClassificationRules(db: Tx | typeof prisma = prisma): Promise<ClassificationRules> {
  // D-049: products set to Financing or Refinancing by hand override the keywords (matched by code, else name).
  const [rules, manual] = await Promise.all([
    getSetting("classification.rules", db),
    db.product.findMany({ where: { classification: { not: null } }, select: { code: true, name: true, classification: true } }),
  ]);
  return { ...asRules(rules), manual: manual.map((p) => ({ code: p.code, name: p.name, value: p.classification! })) };
}
