import "server-only";
import { prisma } from "@/lib/db";
import { ADMIN_PERMISSIONS, ALL_PERMISSIONS, normalizePermissions, PERMISSIONS as P, ROLE_DEFAULTS, type Permission } from "@/lib/auth/permissions";
import { writeUserAccess } from "@/lib/services/access";
import { setSetting } from "@/lib/settings";
import { KIT_EMAIL_DOMAIN } from "@/lib/kit/catalog";
import { kitAccess } from "@/lib/kit/build";

/**
 * The foundation layer of npm run db:reset-seed (scripts/db-reset-seed.ts), run after the seed and the
 * scenario kit on the local development database. FAKE data only (example.test addresses).
 *
 * Step 2 version, on today's schema. Piece 2 of IMPLEMENTATION_PLAN.md (permission core) replaces the
 * old roles properly (D-010); until then the kit's old roles (Branch Supervisor, Operations Monitor,
 * approver roles) are left as they are, and this layer only:
 *   - adds the decided roles that do not exist yet (Superadmin, LA Supervisor/Head, Archiver, D-002);
 *   - sets v2 section 7 default ticks with today's permission keys;
 *   - lets all ten decided roles sign in;
 *   - adds one fake user for each decided role the scenario kit has no user for;
 *   - myloans interval 30 minutes (D-005; today's setting is myloans.backgroundMinutes);
 *   - the LTO offices from the templates, LTO-PASIG marked as a sample (D-020).
 */

type Log = (line: string) => void;

/** The ten decided roles (D-002) and the role key that carries each one today. */
export const DECIDED_ROLES = [
  { decided: "Superadmin", key: "SUPERADMIN" },
  { decided: "Admin", key: "ADMIN" },
  { decided: "LA", key: "LA" },
  { decided: "LA Supervisor/Head", key: "LA_HEAD" },
  { decided: "DP", key: "DP" },
  { decided: "Finance", key: "FIN" },
  { decided: "Custodian", key: "VAULT" },
  { decided: "QA", key: "QA" },
  { decided: "Digicur", key: "DIG" },
  { decided: "Archiver", key: "ARCHIVER" },
] as const;

/** Keys only the Superadmin holds (v2 section 7: users, roles, permissions, the myloans integration); Open Items go to the LA Supervisor/Head. */
const NOT_FOR_ADMIN: Permission[] = [P.ROLES_MANAGE, P.ACCESS_MANAGE, P.USERS_EDIT, P.SOURCE_MANAGE, P.MYLOANS_SYNC, P.SOURCE_REVIEW, P.SOURCE_REVIEW_BORROWER];

export function foundationPermissions(): Record<string, Permission[]> {
  const admin = ADMIN_PERMISSIONS.filter((k) => !NOT_FOR_ADMIN.includes(k));
  return {
    SUPERADMIN: [...ALL_PERMISSIONS],
    ADMIN: normalizePermissions(admin),
    LA_HEAD: normalizePermissions([...ROLE_DEFAULTS.LA.permissions, P.SOURCE_REVIEW, P.SOURCE_REVIEW_BORROWER]),
    ARCHIVER: normalizePermissions([P.LOANS_VIEW, P.MYLOANS_VIEW]),
  };
}

const NEW_ROLES: Record<string, { name: string; description: string; sortOrder: number; branchAccess: "ASSIGNED" | "ALL" }> = {
  SUPERADMIN: { name: "Superadmin", description: "Full system access: users, roles, permissions, settings, the myloans integration (v2 section 7).", sortOrder: 0, branchAccess: "ALL" },
  LA_HEAD: { name: "LA Supervisor/Head", description: "Every Loan Associate permission plus approving or rejecting myloans changes (D-002).", sortOrder: 11, branchAccess: "ASSIGNED" },
  ARCHIVER: { name: "Archiver", description: "Files and warehouses documents (work steps come with the archive module).", sortOrder: 12, branchAccess: "ALL" },
};

/** One fake user per decided role that the scenario kit has no user for. */
const FOUNDATION_USERS: { key: string; slug: string; name: string; branches: string[] | "ALL" }[] = [
  { key: "SUPERADMIN", slug: "superadmin", name: "Superadmin", branches: "ALL" },
  { key: "LA_HEAD", slug: "la.head", name: "LA Head Antipolo", branches: ["101", "165"] },
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
  const perms = foundationPermissions();

  // Roles: the three new ones, v2 ticks, and sign-in for all ten.
  for (const [key, r] of Object.entries(NEW_ROLES)) {
    await prisma.role.upsert({
      where: { key },
      create: { key, ...r, permissions: perms[key], canSignIn: true, builtIn: false },
      update: { ...r, permissions: perms[key], canSignIn: true, active: true },
    });
  }
  await prisma.role.update({ where: { key: "ADMIN" }, data: { permissions: perms.ADMIN } });
  await prisma.role.updateMany({ where: { key: { in: DECIDED_ROLES.map((d) => d.key) } }, data: { canSignIn: true } });
  log(`Roles: added Superadmin, LA Supervisor/Head and Archiver; Admin no longer manages users, roles, access or the myloans integration (Superadmin does); all ten decided roles can sign in. The kit's old roles are kept until piece 2 (D-010).`);

  // Users.
  for (const u of FOUNDATION_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.key } });
    const email = `fdn.${u.slug}${KIT_EMAIL_DOMAIN}`;
    const user = await prisma.user.upsert({ where: { email }, create: { email, name: u.name, roleId: role.id, isTestUser: true }, update: { name: u.name, roleId: role.id, active: true } });
    const access = await kitAccess({ branches: u.branches }, async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id);
    await prisma.$transaction((tx) => writeUserAccess(tx, user.id, access));
  }
  log(`Users: added ${FOUNDATION_USERS.length} fake users (fdn.*${KIT_EMAIL_DOMAIN}) for the decided roles the scenario kit has none for.`);

  // Settings.
  await setSetting("myloans.backgroundMinutes", 30);
  log("Settings: myloans check interval 30 minutes (myloans.backgroundMinutes until piece 7 adds myloans.intervalMinutes). Other settings keep their defaults.");

  // LTO offices from the templates.
  for (const o of TEMPLATE_LTO) {
    const data = { name: o.name, city: o.city, distanceKm: o.km, travelHours: o.hours, suggestedTransportCents: o.transportPesos === null ? null : o.transportPesos * 100, active: true };
    await prisma.ltoOffice.upsert({ where: { code: o.code }, create: { code: o.code, ...data }, update: data });
  }
  log(`LTO offices: ${TEMPLATE_LTO.length} from the templates (LTO-PASIG named as a SAMPLE: the sources say 10, 50 and 2 km). Loan types stay New and Renewal; the template's "Test" loan type is a placeholder and is not seeded.`);
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
