import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { DEFAULT_PN_FORMAT, describePn, pnFormatProblem, type PnFormat } from "@/lib/pn/format";
import { UserError } from "./errors";

/** Settings, System, PN format (settings:system). Audited with the pattern before and after. */
export async function savePnFormat(user: CurrentUser, raw: { enabled: boolean; prefix: string; branchDigits: string; yearDigits: string; system: string; runningDigits: string }) {
  if (!can(user, PERMISSIONS.SETTINGS_PN_FORMAT)) throw new UserError("Ask an Admin to turn on \"Change the PN format\" for your role.");
  const num = (v: string, label: string) => {
    const n = Number(v);
    if (!/^\d+$/.test(v.trim()) || !Number.isInteger(n)) throw new UserError(`${label}: type a whole number.`, label.toLowerCase().replace(/\s+/g, ""));
    return n;
  };
  const next: PnFormat = {
    enabled: raw.enabled,
    prefix: raw.prefix.trim().toUpperCase(),
    branchDigits: num(raw.branchDigits, "Branch code"),
    yearDigits: num(raw.yearDigits, "Year"),
    system: raw.system.trim(),
    runningDigits: num(raw.runningDigits, "Running number"),
  };
  const why = pnFormatProblem(next);
  if (why) throw new UserError(why);
  await prisma.$transaction(async (tx) => {
    const before = { ...DEFAULT_PN_FORMAT, ...(await getSetting("pn.format", tx)) };
    await setSetting("pn.format", next, tx);
    await writeAudit(tx, {
      actor: { id: user.id, label: user.name }, mode: "MANUAL", action: "setting_updated", entityType: "Setting", entityId: "pn.format",
      summary: `PN format: ${next.enabled ? describePn(next).pattern : "check switched off"} (was ${before.enabled ? describePn(before).pattern : "switched off"})`,
      before, after: next,
    });
  });
}
