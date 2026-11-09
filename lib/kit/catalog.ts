/**
 * The Manual Test Kit's sample accounts and sample loans (data only). The builder (lib/kit/build.ts)
 * creates them; docs/MANUAL-TEST-KIT.md is the test sheet; tests check the two agree.
 */

export const KIT_EMAIL_DOMAIN = "@example.test";

export type KitAccountKey = "admin" | "finance" | "supervisor" | "la1" | "la2" | "laDavao" | "dp1" | "dp2" | "laMakati" | "laInactive" | "dp3" | "dp4" | "monitor";

export interface KitAccount {
  key: KitAccountKey;
  email: string;
  name: string;
  /** Built-in role key, or SUPERVISOR for the kit's own "Branch Supervisor" role. */
  role: "ADMIN" | "FIN" | "LA" | "DP" | "SUPERVISOR" | "MONITOR";
  branches: ("QC" | "CEB" | "DVO" | "MKT")[];
  inactive?: boolean;
}

const ALL = ["QC", "CEB", "DVO", "MKT"] as KitAccount["branches"];

export const KIT_ACCOUNTS: KitAccount[] = [
  { key: "admin", email: `kit.admin${KIT_EMAIL_DOMAIN}`, name: "Admin", role: "ADMIN", branches: ALL },
  { key: "finance", email: `kit.finance${KIT_EMAIL_DOMAIN}`, name: "Finance", role: "FIN", branches: ALL },
  { key: "supervisor", email: `kit.supervisor${KIT_EMAIL_DOMAIN}`, name: "Branch Supervisor", role: "SUPERVISOR", branches: ["QC", "CEB"] },
  { key: "la1", email: `kit.la1${KIT_EMAIL_DOMAIN}`, name: "LA 1", role: "LA", branches: ["QC", "CEB"] },
  { key: "la2", email: `kit.la2${KIT_EMAIL_DOMAIN}`, name: "LA 2", role: "LA", branches: ["QC", "CEB"] },
  { key: "laDavao", email: `kit.la.davao${KIT_EMAIL_DOMAIN}`, name: "LA Davao", role: "LA", branches: ["DVO"] },
  { key: "dp1", email: `kit.dp1${KIT_EMAIL_DOMAIN}`, name: "DP 1", role: "DP", branches: ["QC", "CEB"] },
  { key: "dp2", email: `kit.dp2${KIT_EMAIL_DOMAIN}`, name: "DP 2", role: "DP", branches: ["QC", "CEB"] },
  { key: "laMakati", email: `kit.la.makati${KIT_EMAIL_DOMAIN}`, name: "Receiving LA Makati", role: "LA", branches: ["MKT"] },
  { key: "laInactive", email: `kit.la.inactive${KIT_EMAIL_DOMAIN}`, name: "Inactive LA", role: "LA", branches: ["QC", "CEB"], inactive: true },
  // Monitoring: a Davao processor on leave, a Makati processor with her own capacity, and Operations.
  { key: "dp3", email: `kit.dp3${KIT_EMAIL_DOMAIN}`, name: "DP 3", role: "DP", branches: ["DVO"] },
  { key: "dp4", email: `kit.dp4${KIT_EMAIL_DOMAIN}`, name: "DP 4", role: "DP", branches: ["MKT"] },
  { key: "monitor", email: `kit.monitor${KIT_EMAIL_DOMAIN}`, name: "Operations Monitor", role: "MONITOR", branches: ALL },
];

/** The kit's own role for the hold transfer: no built-in Branch Supervisor role exists. */
export const SUPERVISOR_ROLE_NAME = "Branch Supervisor";

export type KitGroup = "Rules" | "Loan Associate" | "Exceptions" | "DP" | "Funds" | "TAT" | "MyLoans" | "Find loan" | "Monitoring";

export interface KitLoan {
  pn: string;
  /** Short name that says the case. */
  name: string;
  group: KitGroup;
  branch: "QC" | "CEB" | "DVO" | "MKT";
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
}

const REFI = "Auto Refinancing";
const L = (pn: number, name: string, group: KitGroup, over: Partial<KitLoan> = {}): KitLoan => ({
  pn: `PN-000${pn}`, name, group, branch: "QC", product: REFI, loanType: "New", amount: 400_000, daysAgo: 0, borrower: "", opened: true, ...over,
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
  L(2008, "Renewal at 1,000,000 (Mortgage)", "Rules", { branch: "CEB", loanType: "Renewal", amount: 1_000_000, borrower: "Hilda Aquino" }),
  L(2009, "Renewal at 1,000,001 (no Mortgage)", "Rules", { branch: "CEB", loanType: "Renewal", amount: 1_000_001, borrower: "Ignacio Torres" }),
  L(2010, "Auto Finance is not the word Financing (Refinancing)", "Rules", { product: "Auto Finance", amount: 600_000, borrower: "Josefa Lim" }),

  // Loan Associate journey.
  L(2011, "Needs LTO: office and cash estimate", "Loan Associate", { borrower: "Karen Dizon" }),
  L(2012, "Missing paper, with reminder", "Loan Associate", { borrower: "Leo Bautista" }),
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
  L(2027, "Forwarded to a receiving LA (Makati)", "DP", { borrower: "Amparo Luna" }),
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
  L(2041, "MyLoans change: minor (name and address)", "MyLoans", { borrower: "Ofelia Santiago" }),
  L(2042, "MyLoans change: material (amount)", "MyLoans", { borrower: "Pedro Ilagan" }),
  L(2043, "MyLoans change: status (cancelled)", "MyLoans", { borrower: "Rosario Dela Rosa" }),
  L(2044, "MyLoans: replaced by a new PN", "MyLoans", { borrower: "Samuel Javier" }),
  L(2045, "Same borrower: first unit", "MyLoans", { borrower: "Teresita Gonzales", cin: "CIN-KIT-2045" }),
  L(2046, "Same borrower: additional unit (not opened)", "MyLoans", { borrower: "Teresita Gonzales", cin: "CIN-KIT-2045", opened: false }),
  L(2047, "Davao branch (another branch)", "Loan Associate", { branch: "DVO", borrower: "Ulysses Bravo", openedBy: "laDavao" }),

  // Monitoring (finished jobs with different times, an overdue job, a job at the LTO, a processor on leave).
  L(2060, "Monitoring: finished by DP 2 in 5 business days", "Monitoring", { borrower: "Alma Concepcion" }),
  L(2061, "Monitoring: finished by DP 2 in 1 business day", "Monitoring", { borrower: "Bernardo Yap" }),
  L(2062, "Monitoring: finished by DP 4 in 4 business days (Makati)", "Monitoring", { branch: "MKT", borrower: "Clarissa Ong", openedBy: "laMakati" }),
  L(2063, "Monitoring: DP 4 overdue, not accepted for 3 business days", "Monitoring", { branch: "MKT", borrower: "Dominador Reyes", openedBy: "laMakati" }),
  L(2064, "Monitoring: DP 4 at LTO Makati now", "Monitoring", { branch: "MKT", borrower: "Estela Marquez", openedBy: "laMakati" }),
  L(2065, "Monitoring: sent to DP 3 before the leave (Davao)", "Monitoring", { branch: "DVO", borrower: "Florante Diaz", openedBy: "laDavao" }),

  // Find loan.
  L(2050, "Not opened yet: open it from Find loan", "Find loan", { borrower: "Vilma Estrada", opened: false }),
];

/** The new PN the MyLoans "replaced" simulation gives PN-0002044 (the first free number from 9100). */
export const KIT_REPLACEMENT_PN = "PN-0009100";

export const BRANCH_NAMES = { QC: "Quezon City", CEB: "Cebu", DVO: "Davao", MKT: "Makati" } as const;
