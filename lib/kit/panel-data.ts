import "server-only";
import type { KitBaseline, KitLoaded, KitSaveRow } from "@/components/admin/test-kit";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { baselineStatus, currentMigrations, listSaves, loadedKit, type KitVariant } from "./core";
import { kitDatabase } from "./guard";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

function baselineOf(variant: KitVariant): KitBaseline | null {
  const b = baselineStatus(variant);
  return b ? { when: when(b.manifest.createdAt), loanFiles: b.manifest.loanFiles, migrationCount: b.manifest.migrations.length, lastMigration: b.manifest.migrations.at(-1) ?? "", upToDate: b.upToDate } : null;
}

/** What Settings > Test kit shows (only called once the kit is known to be available). */
export async function kitPanelData(): Promise<{ loaded: KitLoaded; clean: KitBaseline | null; scenarios: KitBaseline | null; saves: KitSaveRow[]; database: string }> {
  const current = currentMigrations();
  const fits = (m: string[]) => m.length === current.length && m.every((x, i) => x === current[i]);
  const k = loadedKit();
  const [users, branches, loans, pool] = await Promise.all([prisma.user.count(), prisma.branch.count(), prisma.loan.findMany({ select: { pn: true } }), getSetting("myloans.mockExtra")]);
  const opened = new Set(loans.map((l) => l.pn));
  return {
    database: kitDatabase(),
    loaded: { variant: k?.variant ?? null, when: k?.loadedAt ? when(k.loadedAt) : null, users, branches, pnsAvailable: pool.filter((r) => !opened.has(r.pn)).length, loanFiles: loans.length },
    clean: baselineOf("clean"),
    scenarios: baselineOf("scenarios"),
    saves: listSaves().map((s) => ({ name: s.name, kind: s.kind, variant: s.variant ?? null, when: when(s.createdAt), sizeKb: Math.round(s.sizeBytes / 1024), loanFiles: s.loanFiles, fits: fits(s.migrations) })),
  };
}
