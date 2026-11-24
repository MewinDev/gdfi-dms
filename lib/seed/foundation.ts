import "server-only";
import { prisma } from "@/lib/db";
import { writeUserAccess } from "@/lib/services/access";
import { KIT_EMAIL_DOMAIN } from "@/lib/kit/catalog";
import { kitAccess } from "@/lib/kit/build";
import { ticksFromRole } from "@/lib/auth/effective";
import { applyRoleMigration } from "@/lib/services/role-migration";
import { permissionLabel } from "@/lib/auth/permissions";
import { applyStageSpread } from "./stage-spread";

/**
 * The foundation layer of npm run db:reset-seed (scripts/db-reset-seed.ts), run after the seed and the
 * scenario kit on the local development database. FAKE data only (example.test addresses).
 *
 * The built-in roles come from the seed (ROLE_DEFAULTS: the ten decided roles, D-002, and Monitoring);
 * the Superadmin and the LA Supervisors/Heads come from the scenario kit. This layer:
 *   - adds one fake user for each decided role the scenario kit has none for (Custodian, QA, Digicur, Archiver);
 *   - myloans interval 30 minutes (D-005; today's setting is myloans.backgroundMinutes);
 *   - the LTO offices from the templates, LTO-PASIG marked as a sample (D-020);
 *   - sample loans at every reachable stage (lib/seed/stage-spread.ts);
 *   - the D-010 role migration (lib/services/role-migration.ts), with the people it moved in the log.
 */

type Log = (line: string) => void;

/** The ten decided roles (D-002) and the role key that carries each one today. */
export const DECIDED_ROLES = [
  { decided: "Superadmin", key: "SUPERADMIN" },
  { decided: "Admin", key: "ADMIN" },
  { decided: "LA", key: "LA" },
  { decided: "LA Supervisor/Head", key: "SUP" },
  { decided: "DP", key: "DP" },
  { decided: "Finance", key: "FIN" },
  { decided: "Custodian", key: "VAULT" },
  { decided: "QA", key: "QA" },
  { decided: "Digicur", key: "DIG" },
  { decided: "Archiver", key: "ARCHIVER" },
] as const;

/** One fake user per decided role that the scenario kit has no user for. */
const FOUNDATION_USERS: { key: string; slug: string; name: string; branches: string[] | "ALL" }[] = [
  { key: "VAULT", slug: "custodian", name: "Custodian", branches: "ALL" },
  { key: "QA", slug: "qa", name: "QA", branches: "ALL" },
  { key: "DIG", slug: "digicur", name: "Digicur", branches: "ALL" },
  { key: "ARCHIVER", slug: "archiver", name: "Archiver", branches: "ALL" },
];

/**
 * LTO offices from the templates (Downloads: gdfi-dms-lto-offices*.csv, gdfi-dms-template-lto-offices*.csv).
 * LTO-BAG is left out: it appears only as an "EXAMPLE, delete this row" line.
 * LTO-PASIG: the three files disagree (10 km "Iloilo City", 50 km, 2 km), so it is a SAMPLE (D-020).
 */
export const PASIG_SAMPLE_NAME = "LTO Pasig District Office (SAMPLE distance: verify with Operations)";
const TEMPLATE_LTO: { code: string; name: string; city: string; km: number | null; hours: number | null; transportPesos: number | null }[] = [
  { code: "LTO-MKT", name: "LTO Makati District Office", city: "Makati", km: 12, hours: 1.5, transportPesos: 600 },
  { code: "LTO-QC", name: "LTO Quezon City District Office", city: "Quezon City", km: 8, hours: 1, transportPesos: 400 },
  { code: "LTO-ILO", name: "LTO Iloilo District Office", city: "Iloilo City", km: 25, hours: 1, transportPesos: 600 },
  { code: "LTO-PASIG", name: PASIG_SAMPLE_NAME, city: "Pasig", km: 10, hours: 1, transportPesos: 200 },
];

export async function applyFoundationSeed(log: Log = console.log): Promise<void> {
  // Users.
  for (const u of FOUNDATION_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.key } });
    const email = `fdn.${u.slug}${KIT_EMAIL_DOMAIN}`;
    const user = await prisma.user.upsert({ where: { email }, create: { email, name: u.name, roleId: role.id, isTestUser: true, ...ticksFromRole(role.permissions) }, update: { name: u.name, roleId: role.id, active: true } });
    const access = await kitAccess({ branches: u.branches }, async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id);
    await prisma.$transaction((tx) => writeUserAccess(tx, user.id, access));
  }
  log(`Users: added ${FOUNDATION_USERS.length} fake users (fdn.*${KIT_EMAIL_DOMAIN}) for the decided roles the scenario kit has none for.`);

  // Settings.
  log("Settings: the myloans sync runs every 30 minutes (myloans.sync, its default). Other settings keep their defaults.");

  // LTO offices from the templates.
  for (const o of TEMPLATE_LTO) {
    const data = { name: o.name, city: o.city, distanceKm: o.km, travelHours: o.hours, suggestedTransportCents: o.transportPesos === null ? null : o.transportPesos * 100, active: true,
      // D-020: the sample office carries the badge until Operations verifies it.
      isSample: o.code === "LTO-PASIG", sampleNote: o.code === "LTO-PASIG" ? "Sample. Verify with Operations" : "" };
    await prisma.ltoOffice.upsert({ where: { code: o.code }, create: { code: o.code, ...data }, update: data });
  }
  log(`LTO offices: ${TEMPLATE_LTO.length} from the templates (LTO-PASIG named as a SAMPLE: the sources say 10, 50 and 2 km). Loan types stay New and Renewal; the template's "Test" loan type is a placeholder and is not seeded.`);

  // Sample loans at every loan-file stage the app can reach today (some near or over TAT).
  await applyStageSpread(log);

  // The D-010 role migration on this data (the same code as npm run roles:migrate -- --apply).
  const plan = await applyRoleMigration({ id: null, label: "db:reset-seed (role migration D-010)" });
  log(`Role migration (D-010): ${plan.moves.length} people moved; roles updated: ${plan.roleUpdates.map((r) => `${r.key}${r.deactivate ? " (inactive)" : ` -> ${r.name}`}`).join(", ") || "none"}.`);
  for (const m of plan.moves) {
    log(`  ${m.name} <${m.email}>: ${m.fromRole} -> ${m.toRole}${m.grants.length ? `; granted ${m.grants.map(permissionLabel).join(", ")}` : ""}${m.denies.length ? `; denied ${m.denies.map(permissionLabel).join(", ")}` : ""}`);
  }
}

/** Users per decided role, for the summary. */
export async function decidedRoleCounts(): Promise<{ decided: string; key: string; users: number }[]> {
  const out = [];
  for (const d of DECIDED_ROLES) {
    const role = await prisma.role.findUnique({ where: { key: d.key }, include: { _count: { select: { users: { where: { active: true } } } } } });
    out.push({ decided: d.decided, key: d.key, users: role?._count.users ?? 0 });
  }
  return out;
}
