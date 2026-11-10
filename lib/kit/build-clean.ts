import "server-only";
import { prisma } from "@/lib/db";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { PERMISSIONS, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { getHolidaySet, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { saveRole } from "@/lib/services/roles";
import { writeUserAccess } from "@/lib/services/access";
import { writeAudit } from "@/lib/audit";
import { NO_REFRESH_ROLE_NAME, SUPERVISOR_ROLE_KEY, SUPERVISOR_ROLE_NAME } from "./catalog";
import { APPROVER_ROLES, CLEAN_ACCOUNTS, CLEAN_POOL, POOL_BRANCHES, type CleanRole } from "./clean";
import { BOTH_TYPES_APPROVER, TYPE_ROLES } from "./funds-roles";
import { TYPE_ID } from "@/lib/funds/access";
import { importKitBranches, kitAccess } from "./build";
import { kitRefusal } from "./guard";
import { shiftBusinessDays } from "./rebase";

type Log = (line: string) => void;

/** The tables the clean kit leaves empty (work data). Checked by the kit's integration test. */
export const CLEAN_EMPTY_TABLES = [
  "Loan", "LoanSourceSnapshot", "SourceChange", "LoanTransaction", "ChecklistCheck", "DocumentItem", "DocumentMovement", "DpAssignment", "JobStage",
  "LoanException", "Problem", "Hold", "HoldTransfer", "Transmittal", "TransmittalItem", "PullOutRequest", "DigitalRecord", "QaFinding", "Attachment",
  "Notification", "EmailOutbox", "CashAdvance", "CashAdvanceLine", "CashAdvanceTopUp", "TransactionAttempt", "AttemptSpend", "Receipt", "CashReturn",
  "PasuyoEvent", "CarryOver", "FundsException", "LtoAdvisory", "BranchReview",
] as const;

/** The pool's records in the sample MyLoans (Setting myloans.mockExtra), released N business days before today. */
export function poolRecords(today: string, holidays: ReadonlySet<string>): MyLoansRecord[] {
  return CLEAN_POOL.map((l) => {
    const n = l.pn.slice(-4);
    return {
      pn: l.pn, cin: l.cin ?? `CIN-KIT-${n}`, cif: l.cin ? `CIF-${l.cin.slice(4)}` : `CIF-KIT-${n}`, sourceLoanId: `ML-KIT-${n}`,
      borrowerName: l.borrower, branchName: POOL_BRANCHES[l.branch], branchCode: l.branch, status: "RELEASED", loanType: l.loanType,
      productName: l.product, totalReleasedAmount: l.amount, releaseDate: shiftBusinessDays(today, -l.daysAgo, holidays),
      vehicle: { plateNo: `KIT ${n}`, engineNo: `ENG-K${n}`, chassisNo: `CHS-K${n}`, make: "Toyota Vios" },
      address: `${n} Mabini St, ${POOL_BRANCHES[l.branch]}`,
    };
  });
}

/**
 * Builds the CLEAN kit on an empty, migrated and seeded database: the real branch list, the sign-in
 * accounts (with the kit's own roles and the two approver bands), the 40 PNs in the sample MyLoans and
 * nothing else. No loan file, transaction, funds, hold, job, notification, email, review item or Journey
 * entry; the audit log is cleared down to one "kit started" line.
 */
export async function buildClean(log: Log = console.log): Promise<void> {
  const why = kitRefusal();
  if (why) throw new Error(why);
  const today = businessDate(new Date());
  const holidays = await getHolidaySet();
  await importKitBranches(log);
  // Alicia-Inactive is closed (inactive), with no review item: MyLoans already closed it.
  await prisma.branch.update({ where: { code: "718" }, data: { active: false, deactivatedAt: new Date() } });

  // Accounts. The Admin first: the kit's roles are made through the Roles screen's own code.
  const branchId = async (code: string) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id;
  const builtIn = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  const create = async (a: (typeof CLEAN_ACCOUNTS)[number], roleId: string) => {
    const made = await prisma.user.create({ data: { email: a.email, name: a.name, roleId, isTestUser: true } });
    await prisma.$transaction(async (tx) => writeUserAccess(tx, made.id, await kitAccess(a, branchId)));
    if (a.inactive) await prisma.user.update({ where: { id: made.id }, data: { active: false, deactivatedAt: new Date() } });
  };
  const adminAcc = CLEAN_ACCOUNTS.find((a) => a.key === "admin")!;
  await create(adminAcc, await builtIn("ADMIN"));
  const admin = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email: adminAcc.email }, include: CURRENT_USER_INCLUDE }));
  const roleIdOf = async (name: string) => (await prisma.role.findFirstOrThrow({ where: { name } })).id;
  const kitRole = async (name: string, description: string, permissions: string[]) => {
    await saveRole(admin, null, { name, branchAccess: "ASSIGNED", description, permissions });
    return roleIdOf(name);
  };
  const ids: Partial<Record<CleanRole, string>> = {
    // The built-in Branch Supervisor role (or one of that name made by hand before).
    SUPERVISOR: (await prisma.role.findUnique({ where: { key: SUPERVISOR_ROLE_KEY } }))?.id ?? await roleIdOf(SUPERVISOR_ROLE_NAME),
    LA_NO_REFRESH: await kitRole(NO_REFRESH_ROLE_NAME, "Sample role (Manual Test Kit): a Loan Associate without \"Refresh a loan from MyLoans\". Tick it in Settings, Roles to try it.",
      ROLE_DEFAULTS.LA.permissions.filter((k) => k !== PERMISSIONS.LOANS_REFRESH)),
    APPROVER_SMALL: await kitRole(APPROVER_ROLES.small.name, "Sample role (Manual Test Kit): approves cash advances and fund transfers in the lowest approval band.", BOTH_TYPES_APPROVER),
    APPROVER_LARGE: await kitRole(APPROVER_ROLES.large.name, "Sample role (Manual Test Kit): approves cash advances and fund transfers in the higher approval band.", BOTH_TYPES_APPROVER),
    // Funds handled by different people: one Finance and one approver role per type.
    ...Object.fromEntries(await Promise.all(Object.entries(TYPE_ROLES).map(async ([k, r]) => [k, await kitRole(r.name, r.description, r.permissions)]))),
  };
  for (const a of CLEAN_ACCOUNTS) {
    if (a.key === "admin") continue;
    await create(a, ids[a.role] ?? (await builtIn(a.role)));
  }
  // Approval bands, the same amounts for both types: the lowest band to Approver Small, ₱5,000.00 and up to
  // Approver Large; each type's own approver shares both bands of its type, so it approves without a manual step.
  await prisma.approvalBand.deleteMany({});
  for (const [fundsTypeId, own] of [[TYPE_ID.CA, ids.APPR_CA!], [TYPE_ID.FT, ids.APPR_FT!]] as const) {
    for (const [fromCents, roleId] of [[APPROVER_ROLES.small.fromCents, ids.APPROVER_SMALL!], [APPROVER_ROLES.small.fromCents, own], [APPROVER_ROLES.large.fromCents, ids.APPROVER_LARGE!], [APPROVER_ROLES.large.fromCents, own]] as const) {
      await prisma.approvalBand.create({ data: { fundsTypeId, fromCents, roleId } });
    }
  }
  log(`Created ${CLEAN_ACCOUNTS.length} sign-in accounts (1 inactive; the supervisors on the built-in ${SUPERVISOR_ROLE_NAME} role) and the roles ${NO_REFRESH_ROLE_NAME}, ${APPROVER_ROLES.small.name} and ${APPROVER_ROLES.large.name}; approval bands: from ₱0 ${APPROVER_ROLES.small.name}, from ₱5,000 ${APPROVER_ROLES.large.name}.`);

  // The PN pool: only in the sample MyLoans. Nothing opened.
  await setSetting("myloans.mockExtra", poolRecords(today, holidays));
  await setSetting("myloans.mockOverrides", {});
  await setSetting("email.active", false);
  await setSetting("samples.showDataCheck", false);
  await setSetting("myloans.simulateUnavailable", false);
  log(`Put ${CLEAN_POOL.length} PNs in the sample MyLoans (none opened in the DMS).`);

  // Work data: none. The audit log keeps one line.
  for (const t of [...CLEAN_EMPTY_TABLES].reverse()) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`); // empty already on a fresh build; a belt and braces
  await prisma.auditLog.deleteMany({});
  await prisma.$transaction((tx) => writeAudit(tx, { actor: { id: null, label: "Test kit" }, mode: "AUTOMATIC", action: "kit_started", entityType: "TestKit", summary: "Test kit started: CLEAN kit (accounts, branches and settings; no loan files)" }));
  log("Work data: none (no loan files, transactions, funds, holds, jobs, notifications, emails or review items). Audit log: one \"kit started\" line.");
}
