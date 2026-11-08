import "server-only";
import type { KitBaseline, KitSaveRow } from "@/components/admin/test-kit";
import { baselineStatus, currentMigrations, listSaves } from "./core";
import { kitDatabase } from "./guard";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

/** What Settings > Test kit shows (only called once the kit is known to be available). */
export function kitPanelData(): { baseline: KitBaseline | null; saves: KitSaveRow[]; database: string } {
  const current = currentMigrations();
  const b = baselineStatus();
  const fits = (m: string[]) => m.length === current.length && m.every((x, i) => x === current[i]);
  return {
    database: kitDatabase(),
    baseline: b ? { when: when(b.manifest.createdAt), loanFiles: b.manifest.loanFiles, migrationCount: b.manifest.migrations.length, lastMigration: b.manifest.migrations.at(-1) ?? "", upToDate: b.upToDate } : null,
    saves: listSaves().map((s) => ({ name: s.name, kind: s.kind, when: when(s.createdAt), sizeKb: Math.round(s.sizeBytes / 1024), loanFiles: s.loanFiles, fits: fits(s.migrations) })),
  };
}
