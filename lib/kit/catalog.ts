/**
 * The Manual Test Kit's sample accounts and sample loans (data only). The builder (lib/kit/build.ts)
 * creates them; docs/MANUAL-TEST-KIT.md is the test sheet; tests check the two agree.
 */

import { buildPn } from "@/lib/pn/format";

export const KIT_EMAIL_DOMAIN = "@example.test";

export type KitAccountKey = "admin" | "finance" | "supervisor" | "la1" | "la2" | "laAlaminos" | "dp1" | "dp2" | "laMabini" | "laInactive" | "dp3" | "dp4" | "monitor"
  | "areaSupervisor" | "laAreaExcept" | "laRoving" | "laAlicia" | "laNoRefresh" | "financeCash" | "financeTransfer" | "approverCash" | "approverTransfer";

export interface KitAccount {
  key: KitAccountKey;
  email: string;
  name: string;
  /** Built-in role key, or SUPERVISOR / LA_NO_REFRESH for the kit's own sample roles. */
  role: "ADMIN" | "FIN" | "LA" | "DP" | "SUPERVISOR" | "MONITOR" | "LA_NO_REFRESH" | "FIN_CA" | "FIN_FT" | "APPR_CA" | "APPR_FT";
  /** "ALL": All branches. Otherwise single-branch grants (the first is the home branch). */
  branches: KitBranch[] | "ALL";
  /** Extra grants: whole areas (Division, Area), and exceptions (branches unticked inside them). */
  access?: { areas?: { division: string; area: string }[]; except?: KitBranch[]; home?: KitBranch };
  inactive?: boolean;
}

export const KIT_L1 = { division: "Branch Division", area: "LUZON 1 (NGMA + RIZAL)" };


export const KIT_ACCOUNTS: KitAccount[] = [
  { key: "admin", email: `kit.admin${KIT_EMAIL_DOMAIN}`, name: "Admin", role: "ADMIN", branches: "ALL" },
  { key: "finance", email: `kit.finance${KIT_EMAIL_DOMAIN}`, name: "Finance", role: "FIN", branches: "ALL" },
  // Funds handled by different people: Finance and an approver for each type (only that type's ticks).
  { key: "financeCash", email: `kit.finance.cash${KIT_EMAIL_DOMAIN}`, name: "Finance Cash", role: "FIN_CA", branches: "ALL" },
  { key: "financeTransfer", email: `kit.finance.transfer${KIT_EMAIL_DOMAIN}`, name: "Finance Transfer", role: "FIN_FT", branches: "ALL" },
  { key: "approverCash", email: `kit.approver.cash${KIT_EMAIL_DOMAIN}`, name: "Approver Cash", role: "APPR_CA", branches: "ALL" },
  { key: "approverTransfer", email: `kit.approver.transfer${KIT_EMAIL_DOMAIN}`, name: "Approver Transfer", role: "APPR_FT", branches: "ALL" },
  { key: "supervisor", email: `kit.supervisor${KIT_EMAIL_DOMAIN}`, name: "Branch Supervisor", role: "SUPERVISOR", branches: ["101", "165"] },
  { key: "la1", email: `kit.la1${KIT_EMAIL_DOMAIN}`, name: "LA 1", role: "LA", branches: ["101", "165"] },
  { key: "la2", email: `kit.la2${KIT_EMAIL_DOMAIN}`, name: "LA 2", role: "LA", branches: ["101", "165"] },
  { key: "laAlaminos", email: `kit.la.alaminos${KIT_EMAIL_DOMAIN}`, name: "LA Alaminos", role: "LA", branches: ["390"] },
  { key: "dp1", email: `kit.dp1${KIT_EMAIL_DOMAIN}`, name: "DP 1", role: "DP", branches: ["101", "165"] },
  { key: "dp2", email: `kit.dp2${KIT_EMAIL_DOMAIN}`, name: "DP 2", role: "DP", branches: ["101", "165"] },
  { key: "laMabini", email: `kit.la.mabini${KIT_EMAIL_DOMAIN}`, name: "Receiving LA A. Mabini", role: "LA", branches: ["168"] },
  { key: "laInactive", email: `kit.la.inactive${KIT_EMAIL_DOMAIN}`, name: "Inactive LA", role: "LA", branches: ["101", "165"], inactive: true },
  // Monitoring: an Alaminos processor on leave, an A. Mabini processor with her own capacity, and Operations.
  { key: "dp3", email: `kit.dp3${KIT_EMAIL_DOMAIN}`, name: "DP 3", role: "DP", branches: ["390"] },
  { key: "dp4", email: `kit.dp4${KIT_EMAIL_DOMAIN}`, name: "DP 4", role: "DP", branches: ["168"] },
  { key: "monitor", email: `kit.monitor${KIT_EMAIL_DOMAIN}`, name: "Operations Monitor", role: "MONITOR", branches: "ALL" },
  // Branch access samples (Users, Edit, Branch access): a whole Area plus one extra branch, an Area with an
  // exception, All branches, and a user of a branch that MyLoans closed (with an open loan there).
  { key: "areaSupervisor", email: `kit.area.supervisor${KIT_EMAIL_DOMAIN}`, name: "Area Supervisor Luzon 1", role: "SUPERVISOR", branches: ["390"], access: { areas: [KIT_L1], home: "101" } },
  { key: "laAreaExcept", email: `kit.la.luzon1${KIT_EMAIL_DOMAIN}`, name: "LA Luzon 1 (not Amang Rodriguez)", role: "LA", branches: [], access: { areas: [KIT_L1], except: ["174"], home: "165" } },
  { key: "laRoving", email: `kit.la.roving${KIT_EMAIL_DOMAIN}`, name: "Roving LA", role: "LA", branches: "ALL" },
  { key: "laAlicia", email: `kit.la.alicia${KIT_EMAIL_DOMAIN}`, name: "LA Alicia", role: "LA", branches: ["709", "718"] },
  // Roles are just ticks: an LA whose role has every LA tick except "Refresh a loan from MyLoans".
  { key: "laNoRefresh", email: `kit.la.norefresh${KIT_EMAIL_DOMAIN}`, name: "LA No Refresh", role: "LA_NO_REFRESH", branches: ["101", "165"] },
];

/**
 * The Branch Supervisor accounts use the built-in Branch Supervisor role (key SUP, made by migration
 * 20261119090006_decisions_batch). Where a role of that name was made by hand before, that one is used.
 */
export const SUPERVISOR_ROLE_NAME = "Branch Supervisor";
export const SUPERVISOR_ROLE_KEY = "SUP";
/** The kit's sample role for the Refresh tick: the Loan Associate's ticks without "Refresh a loan from MyLoans". */
export const NO_REFRESH_ROLE_NAME = "LA (no refresh)";

export type KitGroup = "Rules" | "Loan Associate" | "Exceptions" | "DP" | "Funds" | "TAT" | "MyLoans" | "Find loan" | "Monitoring" | "Branches";

export interface KitLoan {
  pn: string;
  /** The made-up sample PN it had before the real PN format (the old to new table in the test sheet). */
  oldPn: string;
  /** Short name that says the case. */
  name: string;
  group: KitGroup;
  branch: KitBranch;
  product: string;
  loanType: "New" | "Renewal";
  amount: number;
  /** Released this many business days before kit:start. */
  daysAgo: number;
  borrower: string;
  /** Same CIN = same borrower (related loans). */
  cin?: string;
  /** False: only in the sample MyLoans, for Find loan. */
  opened: boolean;
  /** Financing only: what the LA picked when opening. */
  picks?: { financingType: "UNDERTAKING" | "NON_UNDERTAKING"; orcrStatus: "TRANSFERRED" | "UNTRANSFERRED" };
  /** Who opened it (default LA 1). */
  openedBy?: KitAccountKey;
  /** The branch code in the PN when it is not the loan's branch (the "unknown code" sample). */
  pnBranch?: string;
}

const REFI = "Auto Refinancing";
/** Real PN format: GD + the branch code + 2026 + 9 + a 5-digit running number (the old sample number). */
const L = (n: number, name: string, group: KitGroup, over: Partial<KitLoan> = {}): KitLoan => ({
  pn: buildPn(over.pnBranch ?? over.branch ?? "101", 2026, n), oldPn: n >= 2070 ? "(new)" : `PN-000${n}`, name, group, branch: "101", product: REFI, loanType: "New", amount: 400_000, daysAgo: 0, borrower: "", opened: true, ...over,
});

export const KIT_LOANS: KitLoan[] = [
  // Rules 1 to 4 (opened by LA 1; the result shows on the loan file).
  L(2001, "Refinancing, no mortgage", "Rules", { amount: 650_000, borrower: "Andres Bonifacio Cruz" }),
  L(2002, "Financing, Undertaking, Transferred", "Rules", { product: "Auto Financing", amount: 350_000, borrower: "Bea Alonzo Reyes", picks: { financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" } }),
  L(2003, "Blank product, default Refinancing", "Rules", { product: "", loanType: "Renewal", amount: 800_000, borrower: "Carlos Mendoza" }),
  L(2004, "Financing, Non-Undertaking", "Rules", { product: "Truck Financing", amount: 450_000, borrower: "Diana Santos", picks: { financingType: "NON_UNDERTAKING", orcrStatus: "TRANSFERRED" } }),
  L(2005, "Financing, Untransferred (Notary and EDST)", "Rules", { product: "Auto Financing", amount: 300_000, borrower: "Emilio Garcia", picks: { financingType: "UNDERTAKING", orcrStatus: "UNTRANSFERRED" } }),
  L(2006, "New at 500,000 (Mortgage)", "Rules", { amount: 500_000, borrower: "Fe Villanueva" }),
  L(2007, "New at 500,001 (no Mortgage)", "Rules", { amount: 500_001, borrower: "Gilbert Ramos" }),
  L(2008, "Renewal at 1,000,000 (Mortgage)", "Rules", { branch: "165", loanType: "Renewal", amount: 1_000_000, borrower: "Hilda Aquino" }),
  L(2009, "Renewal at 1,000,001 (no Mortgage)", "Rules", { branch: "165", loanType: "Renewal", amount: 1_000_001, borrower: "Ignacio Torres" }),
  L(2010, "Auto Finance is not the word Financing (Refinancing)", "Rules", { product: "Auto Finance", amount: 600_000, borrower: "Josefa Lim" }),

  // Loan Associate journey.
  L(2011, "Needs LTO: office and cash estimate", "Loan Associate", { borrower: "Karen Dizon" }),
  L(2012, "Required paper missing, with remarks", "Loan Associate", { borrower: "Leo Bautista" }),
  // Missing papers with reasons (a required paper above; an optional one included; through the vault gate; Present but not there).
  L(2080, "Optional paper included and missing, with remarks", "Loan Associate", { borrower: "Lorna Abad" }),
  L(2081, "Through the vault gate with a missing paper (Complete with exceptions)", "Exceptions", { amount: 650_000, borrower: "Lucio Barrera" }),
  L(2082, "LA ticked a paper Present that is not there (waiting at DP 1)", "DP", { borrower: "Luz Carpio" }),
  L(2013, "On hold (LA 1 and LA 2)", "Exceptions", { borrower: "Marites Flores" }),
  L(2014, "Pull back before accept", "Loan Associate", { borrower: "Nestor Castillo" }),
  L(2015, "Sent, waiting to accept", "DP", { borrower: "Olivia Navarro" }),
  L(2016, "DP declines", "DP", { borrower: "Paulo Domingo" }),
  L(2017, "Returned to the LA with findings and papers", "Exceptions", { borrower: "Queenie Salazar" }),
  L(2018, "Round 2 (sent again after a return)", "DP", { borrower: "Ramon Velasco" }),
  L(2019, "Inactive sender", "Exceptions", { borrower: "Susan Pascual", openedBy: "laInactive" }),

  // DP stages.
  L(2020, "Notary stages in progress", "DP", { borrower: "Tomas Rivera" }),
  L(2021, "Entry of PPSR stages in progress", "DP", { borrower: "Ursula Ocampo" }),
  L(2022, "Mortgage stages in progress", "DP", { borrower: "Victor Manalo" }),
  L(2023, "Check and verify blocking", "DP", { borrower: "Wilma Soriano" }),
  L(2024, "Pasuyo (cash decision first)", "DP", { borrower: "Xavier Tan" }),
  L(2025, "Hold a supervisor can transfer", "Exceptions", { borrower: "Yolanda Perez" }),
  L(2026, "Problem at the LTO", "Exceptions", { borrower: "Zaldy Gomez" }),
  L(2027, "Forwarded to a receiving LA (A. Mabini)", "DP", { borrower: "Amparo Luna" }),
  L(2028, "Complete", "DP", { amount: 650_000, borrower: "Benito Rosales" }),
  L(2029, "Incomplete, back to the DP", "DP", { borrower: "Cora Medina" }),

  // Funds (Mortgage, LTO fee, DP 1).
  L(2030, "Funds: needed, no request yet", "Funds", { borrower: "Dante Aguilar" }),
  L(2031, "Funds: requested", "Funds", { borrower: "Elsa Morales" }),
  L(2032, "Funds: approved", "Funds", { borrower: "Fidel Herrera" }),
  L(2033, "Funds: released", "Funds", { borrower: "Gloria Chua" }),
  L(2034, "Funds: overdue notice", "Funds", { borrower: "Hector Sison" }),
  L(2035, "Funds: liquidated", "Funds", { borrower: "Irma Valdez" }),
  L(2036, "Funds: closed", "Funds", { borrower: "Jaime Padilla" }),
  L(2037, "Funds: cash to settle after a return", "Funds", { borrower: "Kristine Uy" }),
  // Fund transfers (same flow; Finance enters the transfer reference, date and account ending).
  L(2051, "Fund transfer: requested", "Funds", { borrower: "Leonora Basa" }),
  L(2052, "Fund transfer: approved (changed from Cash advance)", "Funds", { borrower: "Mario Dizon" }),
  L(2053, "Fund transfer: sent", "Funds", { borrower: "Nora Aunor Reyes" }),
  L(2054, "Fund transfer: liquidated", "Funds", { borrower: "Oscar Lopez" }),
  L(2055, "Fund transfer: closed", "Funds", { borrower: "Perla Ramos" }),
  L(2056, "Fund transfer: cash to settle after a return", "Funds", { borrower: "Quintin Sy" }),
  L(2057, "Fund transfer: overdue notice", "Funds", { borrower: "Rosa Villanueva" }),

  // TAT (Assign to DP: Day 2 from release).
  L(2038, "TAT on time", "TAT", { borrower: "Lorenzo Cabrera", daysAgo: 0 }),
  L(2039, "TAT due today", "TAT", { borrower: "Mila Robles", daysAgo: 2 }),
  L(2040, "TAT late (late reason needed)", "TAT", { borrower: "Noel Fajardo", daysAgo: 4 }),

  // MyLoans.
  L(2041, "MyLoans change: borrower details (name, address, contact)", "MyLoans", { borrower: "Ofelia Santiago" }),
  L(2042, "MyLoans change: material (amount)", "MyLoans", { borrower: "Pedro Ilagan" }),
  L(2043, "MyLoans change: status (cancelled)", "MyLoans", { borrower: "Rosario Dela Rosa" }),
  L(2044, "MyLoans: replaced by a new PN", "MyLoans", { borrower: "Samuel Javier" }),
  L(2045, "Same borrower: first unit", "MyLoans", { borrower: "Teresita Gonzales", cin: "CIN-KIT-2045" }),
  L(2046, "Same borrower: additional unit (not opened)", "MyLoans", { borrower: "Teresita Gonzales", cin: "CIN-KIT-2045", opened: false }),
  L(2047, "Alaminos branch (another branch)", "Loan Associate", { branch: "390", borrower: "Ulysses Bravo", openedBy: "laAlaminos" }),

  // Monitoring (finished jobs with different times, an overdue job, a job at the LTO, a processor on leave).
  L(2060, "Monitoring: finished by DP 2 in 5 business days", "Monitoring", { borrower: "Alma Concepcion" }),
  L(2061, "Monitoring: finished by DP 2 in 1 business day", "Monitoring", { borrower: "Bernardo Yap" }),
  L(2062, "Monitoring: finished by DP 4 in 4 business days (A. Mabini)", "Monitoring", { branch: "168", borrower: "Clarissa Ong", openedBy: "laMabini" }),
  L(2063, "Monitoring: DP 4 overdue, not accepted for 3 business days", "Monitoring", { branch: "168", borrower: "Dominador Reyes", openedBy: "laMabini" }),
  L(2064, "Monitoring: DP 4 at LTO Makati now", "Monitoring", { branch: "168", borrower: "Estela Marquez", openedBy: "laMabini" }),
  L(2065, "Monitoring: sent to DP 3 before the leave (Alaminos)", "Monitoring", { branch: "390", borrower: "Florante Diaz", openedBy: "laAlaminos" }),

  // Find loan.
  L(2050, "Not opened yet: open it from Find loan", "Find loan", { borrower: "Vilma Estrada", opened: false }),

  // Branches and the PN format.
  L(2070, "Unknown branch code 777 in the PN (loan at Antipolo)", "Branches", { borrower: "Wenceslao Ramirez", opened: false, pnBranch: "777" }),
  L(2071, "MyLoans moved it to another branch: waiting for review", "Branches", { borrower: "Ximena Robles" }),
  L(2072, "Opened at Antipolo, now at Angono (branch change applied)", "Branches", { borrower: "Yasmin Dela Paz" }),
  L(2073, "Open loan at a branch MyLoans closed (Alicia-Inactive)", "Branches", { branch: "718", borrower: "Zosimo Tolentino", openedBy: "laAlicia" }),
];

/** MyLoans branch changes waiting in the Branch review (sample MyLoans list): a rename and a code change. */
export const KIT_BRANCH_CHANGES = {
  rename: { branchId: 3, code: "174", from: "Amang Rodriguez", to: "Amang Rodriguez - Pasig" },
  code: { branchId: 398, name: "Alicia", from: "709", to: "710" },
} as const;

/** A PN typed the way people paste it (the test sheet): spaces, dashes and lower case. */
export const KIT_PASTED_PN = { typed: "gd 101-2026-9-02050", pn: "GD1012026902050" } as const;

/** The new PN the MyLoans "replaced" simulation gives GD1012026902044 (the first free number from 9100). */
/**
 * Two general expenses typed as Other ("Courier") by DP 1, Cash advance, still waiting for approval:
 * Settings, Expense kinds shows "Often typed as Other" once a third "Courier" is typed.
 */
export const KIT_OTHER_SAMPLES = [
  { description: "Courier", cents: 15_000 },
  { description: "Courier", cents: 18_000 },
] as const;

export const KIT_REPLACEMENT_PN = "GD1012026909100";

/** The kit's branches (real MyLoans branches; see lib/branches/builtin.ts). */
export const BRANCH_NAMES = { "101": "Antipolo", "165": "Angono", "390": "Alaminos", "168": "A. Mabini", "174": "Amang Rodriguez", "189": "Angono - Car Financing", "709": "Alicia", "718": "Alicia-Inactive" } as const;
export type KitBranch = keyof typeof BRANCH_NAMES;

/** The old made-up sample branches and the real branches that replaced them. */
export const OLD_BRANCHES: { old: string; code: KitBranch }[] = [
  { old: "Quezon City (QC)", code: "101" }, { old: "Cebu (CEB)", code: "165" }, { old: "Davao (DVO)", code: "390" }, { old: "Makati (MKT)", code: "168" },
];
