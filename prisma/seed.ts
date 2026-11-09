/**
 * Seed. Idempotent (safe to run again).
 *   npm run db:seed              reference data + test users (local)
 *   npm run db:seed:reference    reference data only (Supabase / live). Never seeds test users.
 */
import { PrismaClient, ChecklistKind, Originality } from "@prisma/client";
import { ROLE_DEFAULTS } from "../lib/auth/permissions";
import { DEFAULT_OWN_STAGES, DEFAULT_SYSTEM_STAGES } from "../lib/stages/rules";
import { SEEDED_FUNDS_TYPES } from "../lib/funds/types";

const prisma = new PrismaClient();
const withTestUsers = process.env.SEED_TEST_USERS !== "false";
// Test users (and their simple sign-in) never go into production: reference data only there.
if (withTestUsers && process.env.APP_ENV?.trim().toLowerCase() === "production") {
  console.error("Seeding test users is not available in production. Use npm run db:seed:reference.");
  process.exit(1);
}

// Built-in roles come from the same defaults that "Reset to default" restores (lib/auth/permissions.ts).
const ROLES = Object.entries(ROLE_DEFAULTS).map(([key, r]) => ({ key, ...r, permissions: [...r.permissions], builtIn: true }));

// Branches, areas and divisions come from MyLoans (Settings, Branches, Import from MyLoans). A local or
// test database gets the built-in subset of the real list (lib/branches/builtin.ts) through the same
// import code; reference data only (live) seeds no branches.

const TRANSACTION_TYPES = [
  { code: "NOTARY", name: "Notary", requiresDp: true, needsLto: true, ownerRole: "DP", sortOrder: 1, description: "Notarization of loan documents." },
  { code: "EDST", name: "For EDST", requiresDp: false, needsLto: false, ownerRole: "LA", sortOrder: 2, description: "Enter the account in EDST and record the reference. No DP needed." },
  { code: "PPSR", name: "For Entry PPSR", requiresDp: true, needsLto: true, ownerRole: "DP", sortOrder: 3, description: "PPSR registration (C&M through a DP assignment)." },
  { code: "MORTGAGE", name: "Mortgage", requiresDp: true, needsLto: true, ownerRole: "DP", sortOrder: 4, description: "LTO drop, annotation and pickup of OR/CR." },
];

const DOC_TYPES = [
  ["PN", "Promissory Note"], ["DS", "Disclosure Statement"], ["CHM", "Chattel Mortgage"], ["DOS", "Deed of Sale"],
  ["SI", "Sales Invoice"], ["ID", "Valid ID"], ["ORCR", "OR/CR"], ["OR", "Official Receipt (OR)"], ["CR", "Certificate of Registration (CR)"],
  ["INS", "Insurance policy"], ["PPSR", "PPSR certificate"], ["AMS", "Amortization schedule"], ["SPA", "Special Power of Attorney"],
  ["OTH", "Other document"],
] as const;

type Rule = [docType: string, label: string, kind: ChecklistKind, originality: Originality, group?: string];
const R = ChecklistKind.REQUIRED, O = ChecklistKind.ONE_OF, P = ChecklistKind.OPTIONAL;
const ORIG = Originality.ORIGINAL, COPY = Originality.COPY;
const CHECKLIST: Record<string, Rule[]> = {
  NOTARY: [
    ["PN", "Promissory Note", R, ORIG],
    ["DS", "Disclosure Statement", R, ORIG],
    ["CHM", "Chattel Mortgage (for notarization)", R, ORIG],
    ["ID", "Valid IDs of borrower (2)", R, COPY],
    ["DOS", "Deed of Sale", O, ORIG, "Proof of sale"],
    ["SI", "Sales Invoice", O, ORIG, "Proof of sale"],
    ["ID", "Valid ID of co-maker", P, COPY],
  ],
  EDST: [
    ["DS", "Disclosure Statement", R, COPY],
    ["PN", "Promissory Note", R, COPY],
    ["AMS", "Amortization schedule", P, COPY],
  ],
  PPSR: [
    ["CHM", "Chattel Mortgage (notarized)", R, ORIG],
    ["ID", "Valid IDs of borrower", R, COPY],
    ["ORCR", "OR/CR", O, COPY, "Vehicle registration"],
    ["CR", "CR only", O, COPY, "Vehicle registration"],
    ["PPSR", "Previous PPSR certificate", P, COPY],
  ],
  MORTGAGE: [
    ["OR", "Official Receipt (OR)", R, ORIG],
    ["CR", "Certificate of Registration (CR)", R, ORIG],
    ["CHM", "Chattel Mortgage (notarized)", R, ORIG],
    ["INS", "Insurance policy", R, ORIG],
    ["ID", "Valid ID of borrower", O, COPY, "Proof of identity"],
    ["SPA", "Special Power of Attorney", O, ORIG, "Proof of identity"],
    ["DOS", "Deed of Sale", P, COPY],
    ["PPSR", "PPSR certificate", P, COPY],
  ],
};

const TATS: { key: string; phase: number; step: string; label: string; businessDays: number; note?: string }[] = [
  { key: "P1_SEARCH", phase: 1, step: "1.1", label: "Search PN", businessDays: 0, note: "Same day as release" },
  { key: "P1_OPEN", phase: 1, step: "1.4", label: "Open Loan File", businessDays: 0, note: "Same day" },
  { key: "P2_AUTO", phase: 2, step: "2.6", label: "Automatic classification and transactions", businessDays: 2, note: "Inside Day 2" },
  { key: "P3_CHECKLIST", phase: 3, step: "3.1", label: "Checklist complete", businessDays: 2, note: "Day 2 from release" },
  { key: "P3_LABELS", phase: 3, step: "3.2", label: "Document IDs and QR labels", businessDays: 0, note: "Same day" },
  { key: "P3_EDST", phase: 3, step: "3.3", label: "EDST entry", businessDays: 1 },
  { key: "P3_CA", phase: 3, step: "3.4", label: "Cash advance request", businessDays: 0, note: "Before assignment" },
  { key: "P3_CA_RELEASE", phase: 3, step: "3.5", label: "Cash advance release", businessDays: 1, note: "Per Finance policy" },
  { key: "P3_ASSIGN", phase: 3, step: "3.6", label: "Assign to DP", businessDays: 2, note: "Day 2 from release" },
  { key: "P4_ACCEPT", phase: 4, step: "4.1", label: "DP accepts or declines", businessDays: 0, note: "Same day" },
  { key: "P4_NOTARY", phase: 4, step: "4.2", label: "Notary", businessDays: 3 },
  { key: "P4_PPSR", phase: 4, step: "4.3", label: "PPSR registration", businessDays: 5 },
  { key: "P4_MORTGAGE", phase: 4, step: "4.4", label: "Mortgage (LTO)", businessDays: 10 },
  { key: "P4_LIQUIDATE", phase: 4, step: "4.5", label: "Liquidate cash advance", businessDays: 5, note: "Per Finance policy" },
  { key: "P4_FORWARD", phase: 4, step: "4.6", label: "Forward package to branch", businessDays: 0, note: "Same day as pickup" },
  { key: "P5_ACCEPT", phase: 5, step: "5.1", label: "Receiving LA acceptance", businessDays: 2 },
  { key: "P6_VAULTED", phase: 6, step: "6.1", label: "Transmittal to vaulted", businessDays: 3 },
  { key: "P6_VERIFY", phase: 6, step: "6.3", label: "Vault verification", businessDays: 0, note: "Same day as receipt" },
  { key: "P7_DIGICUR", phase: 7, step: "7", label: "DigiCur to Verified", businessDays: 5 },
  { key: "P8_ESC_DEPT", phase: 8, step: "8", label: "Pull-out overdue: Department Head", businessDays: 7, note: "Day 7 after expected return" },
  { key: "P8_ESC_COMPLIANCE", phase: 8, step: "8", label: "Pull-out overdue: Compliance", businessDays: 30, note: "Day 30 after expected return" },
  { key: "P9_QA_REPEAT_WINDOW", phase: 9, step: "9", label: "Repeat finding window (calendar days)", businessDays: 90, note: "Demerits doubled" },
];

const LTO_OFFICES = [
  ["LTO-QC", "LTO Quezon City District Office", "Quezon City"],
  ["LTO-EAST", "LTO East Avenue (Central Office)", "Quezon City"],
  ["LTO-CEB", "LTO Cebu City District Office", "Cebu"],
  ["LTO-MDE", "LTO Mandaue District Office", "Cebu"],
  ["LTO-DVO", "LTO Davao City District Office", "Davao"],
  ["LTO-MKT", "LTO Makati District Office", "Makati"],
] as const;

const CA_RULES = [
  ["NOTARY", "Notarial fees", 1500, 5000, "NOTARY_FEE"],
  ["PPSR", "PPSR registration fee", 1000, 3000, "PPSR_FEE"],
  ["MORTGAGE", "LTO annotation and processing fees", 2500, 8000, "LTO_FEE"],
] as const;

/** Problem reasons (also the result of an attempt that was not processed). */
const PROBLEM_REASONS = [
  ["LTO_DOWN", "LTO maintenance or system down"], ["LTO_CLOSED", "LTO closed or holiday"], ["LONG_QUEUE", "Long queue"],
  ["MISSING_PAPER", "Missing paper"], ["WRONG_PAPER", "Wrong paper"], ["WAITING", "Waiting on borrower or another team"], ["OTHER", "Other"],
] as const;

/** Hold reasons: waiting on something that is not a fault. */
/** Proposed hold reasons, to be confirmed with the team (marked "Proposed" in Settings until Admin saves them). */
const HOLD_REASONS = [
  ["NO-DP", "No available DP"], ["CLIENT-PAPERS", "Waiting for the client's papers"], ["CLIENT-DECISION", "Waiting for the client's decision"],
  ["BRANCH-HEAD", "Waiting for the branch head's approval"], ["FUNDS", "Waiting for funds or payment"], ["CLIENT-CORRECTIONS", "Waiting for corrections from the client"],
  ["MYLOANS-UPDATE", "Waiting for a MyLoans update"], ["OTHER", "Other"],
] as const;

/** Why a processor returns an accepted job to the LA (papers needed). */
const RETURN_REASONS = [
  ["MISSING", "Missing paper"], ["WRONG", "Wrong or unclear paper"], ["OTHER-TXN", "Needs another transaction first"], ["OTHER", "Other"],
] as const;

const HOLIDAYS_2026 = [
  ["2026-01-01", "New Year's Day"], ["2026-04-02", "Maundy Thursday"], ["2026-04-03", "Good Friday"],
  ["2026-04-09", "Araw ng Kagitingan"], ["2026-05-01", "Labor Day"], ["2026-06-12", "Independence Day"],
  ["2026-08-31", "National Heroes Day"], ["2026-11-30", "Bonifacio Day"], ["2026-12-08", "Feast of the Immaculate Conception"],
  ["2026-12-24", "Christmas Eve"], ["2026-12-25", "Christmas Day"], ["2026-12-30", "Rizal Day"], ["2026-12-31", "Last Day of the Year"],
] as const;

async function main() {
  // Roles
  for (const r of ROLES) {
    // Existing roles keep their switches and branch access (changed in Settings); only the fixed parts are refreshed.
    await prisma.role.upsert({ where: { key: r.key }, create: r, update: { name: r.name, canSignIn: r.canSignIn, builtIn: true } });
  }
  // Loan types (exact MyLoans values)
  await prisma.loanType.upsert({ where: { code: "New" }, create: { code: "New", name: "New", description: "Mortgage when amount is PHP 500,000 or below" }, update: {} });
  await prisma.loanType.upsert({ where: { code: "Renewal" }, create: { code: "Renewal", name: "Renewal", description: "Mortgage when amount is PHP 1,000,000 or below" }, update: {} });
  // Transaction types
  for (const t of TRANSACTION_TYPES) await prisma.transactionType.upsert({ where: { code: t.code }, create: { ...t, builtIn: true }, update: { builtIn: true } });
  // Processing stages (proposed defaults; Settings > Processing stages). Existing stages are left as they are.
  for (const t of await prisma.transactionType.findMany({ where: { requiresDp: true } })) {
    const have = await prisma.processingStage.findMany({ where: { typeId: t.id }, select: { code: true, kind: true } });
    const wanted = [...(have.some((h) => h.kind === "OWN") ? [] : DEFAULT_OWN_STAGES[t.code] ?? []), ...DEFAULT_SYSTEM_STAGES.filter((d) => !have.some((h) => h.kind === d.kind))];
    for (const d of wanted.filter((w) => !have.some((h) => h.code === w.code))) {
      await prisma.processingStage.create({ data: { typeId: t.id, code: d.code, name: d.name, kind: d.kind, sortOrder: d.sortOrder, fields: d.fields as never } });
    }
  }
  // Document types + retention (10 years default, O-6)
  for (const [code, name] of DOC_TYPES) {
    const dt = await prisma.documentType.upsert({ where: { code }, create: { code, name }, update: {} });
    await prisma.retentionRule.upsert({ where: { documentTypeId: dt.id }, create: { documentTypeId: dt.id, retentionYears: 10 }, update: {} });
  }
  // Checklist rules (only when a type has none yet, so Settings edits are kept)
  for (const [typeCode, rules] of Object.entries(CHECKLIST)) {
    const type = await prisma.transactionType.findUniqueOrThrow({ where: { code: typeCode } });
    if ((await prisma.checklistRule.count({ where: { transactionTypeId: type.id } })) > 0) continue;
    let i = 0;
    for (const [docCode, label, kind, originality, group] of rules) {
      const dt = await prisma.documentType.findUniqueOrThrow({ where: { code: docCode } });
      await prisma.checklistRule.create({
        // Valid IDs and the SPA belong to the borrower: reusable on a replacement PN.
        data: { transactionTypeId: type.id, documentTypeId: dt.id, label, kind, originality, oneOfGroup: group ?? null, required: kind !== ChecklistKind.OPTIONAL, reusable: ["ID", "SPA"].includes(docCode), sortOrder: ++i },
      });
    }
  }
  // TATs
  for (const t of TATS) await prisma.tatRule.upsert({ where: { key: t.key }, create: { ...t, note: t.note ?? "" }, update: {} });
  // LTO offices
  for (const [code, name, city] of LTO_OFFICES) await prisma.ltoOffice.upsert({ where: { code }, create: { code, name, city }, update: {} });
  // Cash-advance rules
  for (const [typeCode, purpose, suggested, max, kind] of CA_RULES) {
    const type = await prisma.transactionType.findUniqueOrThrow({ where: { code: typeCode } });
    const exists = await prisma.cashAdvanceRule.findFirst({ where: { transactionTypeId: type.id } });
    if (!exists) await prisma.cashAdvanceRule.create({ data: { transactionTypeId: type.id, purpose, suggestedAmount: suggested, maxAmount: max, kind } });
  }
  // Problem reasons
  for (const [i, [code, name]] of PROBLEM_REASONS.entries()) await prisma.problemReason.upsert({ where: { code }, create: { code, name, sortOrder: i + 1 }, update: {} });
  // Hold reasons
  for (const [i, [code, name]] of HOLD_REASONS.entries()) await prisma.holdReason.upsert({ where: { code }, create: { code, name, sortOrder: i + 1, proposed: true }, update: {} });
  // Funds types: Cash advance (CA) and Fund transfer (FT), "Proposed, to be confirmed with Finance" until Admin saves them.
  for (const t of SEEDED_FUNDS_TYPES) await prisma.fundsType.upsert({ where: { code: t.code }, create: { ...t, proposed: true }, update: {} });
  // Return reasons
  for (const [i, [code, name]] of RETURN_REASONS.entries()) await prisma.returnReason.upsert({ where: { code }, create: { code, name, sortOrder: i + 1 }, update: {} });
  // Approval bands: one default band, any amount, Finance.
  if ((await prisma.approvalBand.count()) === 0) {
    const fin = await prisma.role.findUniqueOrThrow({ where: { key: "FIN" } });
    await prisma.approvalBand.create({ data: { fromCents: 0, roleId: fin.id } });
  }
  // Holidays
  for (const [date, name] of HOLIDAYS_2026) await prisma.holidayCalendar.upsert({ where: { date }, create: { date, name }, update: { name } });
  // Vault locations (Main Vault, rack A, 2 shelves x 2 boxes x 5 slots)
  for (const shelf of ["1", "2"]) for (const box of ["01", "02"]) for (let s = 1; s <= 5; s++) {
    const slot = String(s).padStart(2, "0");
    const label = `MV-A-${shelf}-${box}-${slot}`;
    await prisma.vaultLocation.upsert({ where: { label }, create: { vault: "Main Vault", rack: "A", shelf, box, slot, label }, update: {} });
  }
  // Settings
  for (const [key, value] of [["myloans.simulateUnavailable", false], ["simulator.enabled", false], ["myloans.mockOverrides", {}]] as const) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  if (withTestUsers) await seedTestUsers();
  console.log(`Seed complete (${withTestUsers ? "reference data + test users" : "reference data only"}).`);
}

/**
 * The built-in subset of the real MyLoans branch list (12 branches, 3 divisions), through the same import
 * code as Settings, Branches, Import from MyLoans. Only for a local or test database (never live).
 * Sample branches: Antipolo 101, Angono 165, Alaminos 390 and A. Mabini 168 (each with its usual LTO office).
 */
async function seedBranches() {
  const { BUILTIN_BRANCHES, BUILTIN_USUAL_LTO } = await import("../lib/branches/builtin");
  const { importBranchRowsAsSystem } = await import("../lib/services/branches");
  if ((await prisma.branch.count({ where: { code: { in: BUILTIN_BRANCHES.map((b) => b.code) } } })) < BUILTIN_BRANCHES.length) {
    await importBranchRowsAsSystem(BUILTIN_BRANCHES);
  }
  for (const [code, lto] of Object.entries(BUILTIN_USUAL_LTO)) {
    const office = await prisma.ltoOffice.findUnique({ where: { code: lto } });
    if (office) await prisma.branch.updateMany({ where: { code, usualLtoOfficeId: null }, data: { usualLtoOfficeId: office.id } });
  }
}

async function seedTestUsers() {
  await seedBranches();
  const { writeUserAccess, branchGrants } = await import("../lib/services/access");
  const role = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  const branch = async (code: string) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id;
  // "ALL": All branches. Codes: Antipolo 101, Angono 165, Alaminos 390 (the "other branch").
  const users: { email: string; name: string; role: string; branches: string[] | "ALL"; isTestUser: boolean }[] = [
    { email: "test.admin@gdfi.ph", name: "Test Admin", role: "ADMIN", branches: "ALL", isTestUser: true },
    { email: "test.la@gdfi.ph", name: "Test Loan Associate", role: "LA", branches: ["101", "165"], isTestUser: true },
    // Test mode only: sign in as a processor or as Finance to walk the funds flow.
    { email: "test.dp@gdfi.ph", name: "Test Document Processor", role: "DP", branches: ["101", "165"], isTestUser: true },
    { email: "test.finance@gdfi.ph", name: "Test Finance", role: "FIN", branches: "ALL", isTestUser: true },
    // Operations Monitor (read-only, all branches): the Monitoring page and LTO advisories.
    { email: "test.monitor@gdfi.ph", name: "Test Operations Monitor", role: "MONITOR", branches: "ALL", isTestUser: true },
    // Document Processors: no sign-in yet, needed so the LA can assign transactions.
    { email: "dp.rico@gdfi.ph", name: "Rico Dela Cruz", role: "DP", branches: ["101"], isTestUser: false },
    { email: "dp.joy@gdfi.ph", name: "Joy Navarro", role: "DP", branches: ["101"], isTestUser: false },
    { email: "dp.paolo@gdfi.ph", name: "Paolo Lim", role: "DP", branches: ["165"], isTestUser: false },
    { email: "dp.grace@gdfi.ph", name: "Grace Tan", role: "DP", branches: ["165"], isTestUser: false },
    { email: "dp.ben@gdfi.ph", name: "Ben Ocampo", role: "DP", branches: ["390"], isTestUser: false },
  ];
  for (const u of users) {
    const roleId = await role(u.role);
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const user = existing ?? (await prisma.user.create({ data: { email: u.email, name: u.name, roleId, isTestUser: u.isTestUser } }));
    // Existing users keep the access they have (changed in Users); a new one gets the default.
    if (existing && (existing.allBranches || (await prisma.userAccessGrant.count({ where: { userId: existing.id } })) > 0)) continue;
    const ids = u.branches === "ALL" ? [] : await Promise.all(u.branches.map(branch));
    await prisma.$transaction((tx) => writeUserAccess(tx, user.id, { all: u.branches === "ALL", grants: branchGrants(ids), homeBranchId: ids[0] ?? null }));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
