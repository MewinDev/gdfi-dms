/**
 * The CLEAN Manual Test Kit (data only): the sign-in accounts and the pool of 44 fresh PNs that exist
 * only in the sample MyLoans. Nothing is opened in the DMS: the tester finds each loan by its PN.
 * lib/kit/build-clean.ts builds it; docs/MANUAL-TEST-KIT.md lists the accounts and the PNs (nothing
 * else); docs/MANUAL-TEST-KIT-ANSWERS.md says what each PN is. tests/integration/kit.test.ts checks
 * the three agree. The old scenario kit (lib/kit/catalog.ts) loads only with --with-scenarios.
 */
import { buildPn } from "@/lib/pn/format";
import { KIT_EMAIL_DOMAIN, KIT_L1 } from "./catalog";

export type CleanRole = "ADMIN" | "FIN" | "LA" | "DP" | "MONITOR" | "VAULT" | "DIG" | "QA" | "SUPERVISOR" | "LA_NO_REFRESH" | "APPROVER_SMALL" | "APPROVER_LARGE"
  | "FIN_CA" | "FIN_FT" | "APPR_CA" | "APPR_FT";

export interface CleanAccount {
  key: string;
  email: string;
  name: string;
  role: CleanRole;
  /** The role as the tester sheet names it. */
  roleLabel: string;
  /** "ALL": All branches. Otherwise single branches (the first is the home branch). */
  branches: string[] | "ALL";
  /** Whole areas (Division, Area) and branches unticked inside them. */
  access?: { areas?: { division: string; area: string }[]; except?: string[]; home?: string };
  /** The branch access as the tester sheet says it. */
  accessLabel: string;
  inactive?: boolean;
}

const e = (slug: string) => `kit.${slug}${KIT_EMAIL_DOMAIN}`;

export const CLEAN_ACCOUNTS: CleanAccount[] = [
  { key: "admin", email: e("admin"), name: "Admin", role: "ADMIN", roleLabel: "Admin", branches: "ALL", accessLabel: "All branches" },
  { key: "finance", email: e("finance"), name: "Finance", role: "FIN", roleLabel: "Finance", branches: "ALL", accessLabel: "All branches" },
  { key: "approverSmall", email: e("approver.small"), name: "Approver Small", role: "APPROVER_SMALL", roleLabel: "Approver (lowest band)", branches: "ALL", accessLabel: "All branches" },
  { key: "approverLarge", email: e("approver.large"), name: "Approver Large", role: "APPROVER_LARGE", roleLabel: "Approver (higher band)", branches: "ALL", accessLabel: "All branches" },
  { key: "financeCash", email: e("finance.cash"), name: "Finance Cash", role: "FIN_CA", roleLabel: "Finance (cash advance)", branches: "ALL", accessLabel: "All branches" },
  { key: "financeTransfer", email: e("finance.transfer"), name: "Finance Transfer", role: "FIN_FT", roleLabel: "Finance (fund transfer)", branches: "ALL", accessLabel: "All branches" },
  { key: "approverCash", email: e("approver.cash"), name: "Approver Cash", role: "APPR_CA", roleLabel: "Approver (cash advance)", branches: "ALL", accessLabel: "All branches" },
  { key: "approverTransfer", email: e("approver.transfer"), name: "Approver Transfer", role: "APPR_FT", roleLabel: "Approver (fund transfer)", branches: "ALL", accessLabel: "All branches" },
  { key: "monitor", email: e("monitor"), name: "Operations Monitor", role: "MONITOR", roleLabel: "Operations Monitor", branches: "ALL", accessLabel: "All branches" },
  { key: "supervisor", email: e("supervisor"), name: "Branch Supervisor", role: "SUPERVISOR", roleLabel: "Branch Supervisor", branches: ["101", "165"], accessLabel: "Antipolo and Angono" },
  { key: "areaSupervisor", email: e("area.supervisor"), name: "Area Supervisor Luzon 1", role: "SUPERVISOR", roleLabel: "Supervisor (Branch Supervisor role)", branches: ["390"], access: { areas: [KIT_L1], home: "101" }, accessLabel: "Whole Luzon 1 area plus Alaminos" },
  { key: "laAntipolo", email: e("la.antipolo"), name: "LA Antipolo", role: "LA", roleLabel: "Loan Associate", branches: ["101"], accessLabel: "Antipolo (101)" },
  { key: "laAngono", email: e("la.angono"), name: "LA Angono", role: "LA", roleLabel: "Loan Associate", branches: ["165"], accessLabel: "Angono (165)" },
  { key: "laMabini", email: e("la.amabini"), name: "LA A. Mabini", role: "LA", roleLabel: "Loan Associate", branches: ["168"], accessLabel: "A. Mabini (168)" },
  { key: "laAlaminos", email: e("la.alaminos"), name: "LA Alaminos", role: "LA", roleLabel: "Loan Associate", branches: ["390"], accessLabel: "Alaminos (390)" },
  { key: "laLuzon1", email: e("la.luzon1"), name: "LA Luzon 1", role: "LA", roleLabel: "Loan Associate", branches: [], access: { areas: [KIT_L1], except: ["174"], home: "165" }, accessLabel: "All of Luzon 1 except Amang Rodriguez" },
  { key: "laRoving", email: e("la.roving"), name: "Roving LA", role: "LA", roleLabel: "Loan Associate", branches: "ALL", accessLabel: "All branches" },
  { key: "laNoRefresh", email: e("la.norefresh"), name: "LA No Refresh", role: "LA_NO_REFRESH", roleLabel: "LA (no refresh)", branches: ["101"], accessLabel: "Antipolo (101)" },
  { key: "rcvAntipolo", email: e("rla.antipolo"), name: "Receiving LA Antipolo", role: "LA", roleLabel: "Receiving LA (Loan Associate role)", branches: ["101"], accessLabel: "Antipolo (101)" },
  { key: "rcvMabini", email: e("la.mabini"), name: "Receiving LA A. Mabini", role: "LA", roleLabel: "Receiving LA (Loan Associate role)", branches: ["168"], accessLabel: "A. Mabini (168)" },
  { key: "dp1", email: e("dp1"), name: "DP 1", role: "DP", roleLabel: "Document Processor", branches: ["101", "165"], accessLabel: "Antipolo and Angono" },
  { key: "dp2", email: e("dp2"), name: "DP 2", role: "DP", roleLabel: "Document Processor", branches: ["101", "165"], accessLabel: "Antipolo and Angono" },
  { key: "dp3", email: e("dp3"), name: "DP 3", role: "DP", roleLabel: "Document Processor", branches: ["168"], accessLabel: "A. Mabini (168)" },
  { key: "dp4", email: e("dp4"), name: "DP 4", role: "DP", roleLabel: "Document Processor", branches: ["390"], accessLabel: "Alaminos (390)" },
  { key: "vault", email: e("vault"), name: "Vault", role: "VAULT", roleLabel: "Vault", branches: "ALL", accessLabel: "All branches" },
  { key: "digital", email: e("digital"), name: "Digital Records", role: "DIG", roleLabel: "Digital Records", branches: "ALL", accessLabel: "All branches" },
  { key: "qa", email: e("qa"), name: "QA", role: "QA", roleLabel: "QA", branches: "ALL", accessLabel: "All branches" },
  { key: "laInactive", email: e("la.inactive"), name: "LA Inactive", role: "LA", roleLabel: "Loan Associate (inactive)", branches: ["101"], accessLabel: "Antipolo (101)", inactive: true },
];

/** The two approver roles of the clean kit and their approval bands (Settings, Approval bands). */
export const APPROVER_ROLES = {
  small: { name: "Approver (small amounts)", fromCents: 0 },
  large: { name: "Approver (large amounts)", fromCents: 500_000 }, // ₱5,000.00 and up
} as const;

/** The branches of the PN pool, as MyLoans names them. */
export const POOL_BRANCHES: Record<string, string> = {
  "101": "Antipolo", "165": "Angono", "168": "A. Mabini", "390": "Alaminos", "174": "Amang Rodriguez", "102": "Cainta", "123": "Binangonan",
  "104": "Marikina", "163": "Marcos Highway", "147": "Mandaluyong", "155": "Libis", "718": "Alicia-Inactive",
};

export interface PoolLoan {
  pn: string;
  /** The loan's branch in MyLoans. */
  branch: string;
  borrower: string;
  product: string;
  loanType: "New" | "Renewal";
  amount: number;
  /** Released this many business days before the kit was built. */
  daysAgo: number;
  /** Same CIN = same borrower (an additional unit). */
  cin?: string;
  /** The branch code inside the PN when it is not the loan's branch (the unknown-code case). */
  pnBranch?: string;
  /** The answer key (docs/MANUAL-TEST-KIT-ANSWERS.md only): what this PN is and what it is good for. */
  answer: string;
}

/** Running numbers 03001 to 03044: well clear of the old kit (02001-02073, the replacement 09100). */
const P = (n: number, branch: string, borrower: string, answer: string, over: Partial<PoolLoan> = {}): PoolLoan => ({
  pn: buildPn(over.pnBranch ?? branch, 2026, 3000 + n), branch, borrower, product: "Auto Refinancing", loanType: "New", amount: 400_000, daysAgo: 0, answer, ...over,
});

export const CLEAN_POOL: PoolLoan[] = [
  // Antipolo (101)
  P(1, "101", "Andrea Villareal", "Refinancing, New, ₱650,000: above the ₱500,000 limit, so no Mortgage.", { amount: 650_000 }),
  P(2, "101", "Benjie Soriano", "Auto Financing, ₱350,000: you pick Undertaking or Non-Undertaking, and Transferred or Untransferred, when opening.", { product: "Auto Financing", amount: 350_000 }),
  P(3, "101", "Celia Domingo", "Blank product, Renewal, ₱800,000: the rules treat it as Refinancing; Renewal up to ₱1,000,000 needs a Mortgage.", { product: "", loanType: "Renewal", amount: 800_000 }),
  P(4, "101", "Danilo Reyes", "New at exactly ₱500,000: Mortgage needed (the limit is included).", { amount: 500_000 }),
  P(5, "101", "Erlinda Cruz", "New at ₱500,001: one peso over, no Mortgage.", { amount: 500_001 }),
  P(6, "101", "Fernando Lim", "Released 2 business days ago: Assign to DP is due today (TAT).", { daysAgo: 2 }),
  P(7, "101", "Gemma Tolentino", "Released 4 business days ago: Assign to DP is late; Send asks for the late reason (TAT).", { daysAgo: 4 }),
  P(8, "101", "Herminio Bautista", "Same borrower, first unit (CIN shared with GD1012026903009). Open this one first.", { cin: "CIN-KIT-3008" }),
  P(9, "101", "Herminio Bautista", "Same borrower, additional unit: after opening GD1012026903008, Find loan shows it as related (same CIN).", { cin: "CIN-KIT-3008", amount: 380_000 }),
  P(10, "101", "Imelda Navarro", "MyLoans change after Refresh: open it, then as Admin use Simulate a MyLoans change (amount or name) on its loan file; the change shows only after Refresh or the next sync.", { amount: 450_000 }),
  P(11, "101", "Jovito Ramos", "Unknown branch code 777 in the PN; MyLoans puts the loan at Antipolo, so it opens at Antipolo (the branch comes from MyLoans, not from the PN).", { pnBranch: "777" }),
  // Angono (165)
  P(12, "165", "Karla Mendoza", "Renewal at exactly ₱1,000,000: Mortgage needed.", { loanType: "Renewal", amount: 1_000_000 }),
  P(13, "165", "Leandro Pascual", "Renewal at ₱1,000,001: no Mortgage.", { loanType: "Renewal", amount: 1_000_001 }),
  P(14, "165", "Marivic Santos", "Truck Financing, ₱450,000: pick Non-Undertaking when opening.", { product: "Truck Financing", amount: 450_000 }),
  P(15, "165", "Nicanor Aquino", "Auto Financing, ₱300,000: pick Untransferred to get Notary and EDST.", { product: "Auto Financing", amount: 300_000 }),
  P(16, "165", "Ofelia Garcia", "Product \"Auto Finance\" (not the word Financing): treated as Refinancing.", { product: "Auto Finance", amount: 600_000 }),
  P(17, "165", "Porfirio Diaz", "Branch moved by MyLoans later: open it, then as Admin Simulate a MyLoans change, Branch; it waits for review until applied.", { amount: 420_000 }),
  P(18, "165", "Remedios Flores", "Unit change (replacement): open it, then as Admin Simulate a MyLoans change, Replace; MyLoans gives a new PN and the old one waits for review.", { amount: 410_000 }),
  P(19, "165", "Salvador Castillo", "Plain Mortgage loan: good for a full Send to DP, Pasuyo between DP 1 and DP 2, and a cash advance for the LTO fee.", { amount: 390_000 }),
  // A. Mabini (168)
  P(20, "168", "Teodora Velasco", "Plain Mortgage loan at A. Mabini: send it to DP 3 and forward to Receiving LA A. Mabini.", { amount: 380_000 }),
  P(21, "168", "Ulysses Manalo", "Plain Mortgage loan at A. Mabini: good for a hold, a missing paper or a problem.", { amount: 360_000 }),
  P(22, "168", "Veronica Ocampo", "Auto Financing at A. Mabini.", { product: "Auto Financing", amount: 340_000 }),
  P(23, "168", "Wilfredo Salazar", "Renewal at A. Mabini, ₱900,000: Mortgage needed.", { loanType: "Renewal", amount: 900_000 }),
  P(24, "168", "Xyza Rivera", "Refinancing above the limit at A. Mabini (₱700,000): no Mortgage.", { amount: 700_000 }),
  P(25, "168", "Yvonne Perez", "Released 2 business days ago at A. Mabini: Assign to DP due today.", { daysAgo: 2, amount: 330_000 }),
  // Alaminos (390)
  P(26, "390", "Zenaida Gomez", "Plain Mortgage loan at Alaminos: send it to DP 4.", { amount: 370_000 }),
  P(27, "390", "Arturo Luna", "Plain Mortgage loan at Alaminos: good for Return to LA with findings.", { amount: 350_000 }),
  P(28, "390", "Bernadette Rosales", "Auto Financing at Alaminos.", { product: "Auto Financing", amount: 320_000 }),
  P(29, "390", "Cesar Medina", "Renewal at Alaminos, ₱1,000,000: Mortgage needed.", { loanType: "Renewal", amount: 1_000_000 }),
  P(30, "390", "Delia Aguilar", "Released 4 business days ago at Alaminos: late (TAT).", { daysAgo: 4, amount: 310_000 }),
  P(31, "390", "Eduardo Herrera", "Alaminos is outside Luzon 1: LA Luzon 1 is refused (Outside your branch access). LA Alaminos or Roving LA can open it; Area Supervisor Luzon 1 then sees it (that role views loans but does not open them).", { amount: 300_000 }),
  // Other Luzon 1 branches
  P(32, "174", "Felicidad Chua", "Amang Rodriguez: LA Luzon 1 is excluded from this branch, so it is refused for them; Roving LA can open it.", { amount: 360_000 }),
  P(33, "174", "Gregorio Sison", "Amang Rodriguez, second loan: once Roving LA opens it, Area Supervisor Luzon 1 sees it and LA Luzon 1 does not.", { amount: 340_000 }),
  P(34, "102", "Herlinda Valdez", "Cainta (Luzon 1): LA Luzon 1 and Roving LA can open it; LA Antipolo cannot (Outside your branch access).", { amount: 330_000 }),
  P(35, "123", "Isagani Padilla", "Binangonan (Luzon 1).", { amount: 320_000 }),
  P(36, "104", "Josefina Uy", "Marikina (Luzon 1), Renewal ₱950,000: Mortgage needed.", { loanType: "Renewal", amount: 950_000 }),
  P(37, "163", "Kristoffer Basa", "Marcos Highway (Luzon 1), Auto Financing.", { product: "Auto Financing", amount: 310_000 }),
  P(38, "147", "Lourdes Dizon", "Mandaluyong (Luzon 1).", { amount: 300_000 }),
  P(39, "155", "Mauricio Reyes", "Libis (Luzon 1), released 2 business days ago.", { daysAgo: 2, amount: 290_000 }),
  // Missing papers with reasons (Antipolo)
  P(41, "101", "Ruperto Alonzo", "Missing papers: mark a required Notary paper Missing, try to Send (it names the paper: \"Add remarks for: ...\"), write a reason and remarks, then Send. As DP 1, the paper is in \"Review the papers\" as an amber Missing row (no tick box) and cannot be named in a return.", { amount: 395_000 }),
  P(42, "101", "Soledad Bernal", "Missing papers, optional paper: on Notary tick \"Include in this file\" for Valid ID of co-maker, mark it Missing with remarks; an optional paper left unticked needs nothing.", { amount: 385_000 }),
  P(43, "101", "Teofilo Cabral", "Missing papers through the vault gate: Refinancing above ₱500,000 (EDST and Notary). Send Notary with a paper Missing (with remarks), finish it; the loan file shows \"Complete with exceptions\" until the paper is Received.", { amount: 650_000 }),
  P(44, "101", "Ursula Dimaculangan", "Ticked Present but not there: tick every Notary paper and send it to DP 1; as DP 1, at Accept mark one paper not received: the Return to LA still works for a paper the LA ticked Present.", { amount: 375_000 }),
  // The inactive branch
  P(40, "718", "Natividad Lopez", "At Alicia-Inactive (718), a branch MyLoans closed: opening it is refused (\"Alicia-Inactive (718) is inactive in Settings, so no new loan files can be opened for it.\").", { amount: 280_000 }),
];

/** The heading a PN is listed under on the tester sheet: its MyLoans branch. */
export const poolHeading = (l: PoolLoan) => `${POOL_BRANCHES[l.branch]} (${l.branch})`;
