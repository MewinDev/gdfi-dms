/**
 * The 10-phase journey (prompt section 6). Phases 1-6 are evaluated from the Loan File's state;
 * phases 7-10 are shown as upcoming steps with their owner role and target TAT.
 */
import { STAGES, type Stage } from "./stage";
import type { TatMap } from "./tat";

export type StepState = "done" | "current" | "pending" | "na";

export interface StepDef {
  id: string;
  title: string;
  owner: string[]; // role keys
  mode: string;
  tatKey?: string;
  tatText?: string;
}

export interface PhaseDef {
  n: number;
  title: string;
  built: boolean;
  steps: StepDef[];
}

export const PHASES: PhaseDef[] = [
  {
    n: 1, title: "Search PN and open the Loan File", built: true,
    steps: [
      { id: "1.1", title: "Search PN", owner: ["LA"], mode: "Manual", tatKey: "P1_SEARCH" },
      { id: "1.2", title: "Call MyLoans API, validate PN, branch, RELEASED", owner: ["SYS"], mode: "Auto", tatText: "Seconds" },
      { id: "1.3", title: "Data Check", owner: ["SYS"], mode: "Auto", tatText: "Seconds" },
      { id: "1.4", title: "Open Loan File", owner: ["LA"], mode: "Manual", tatKey: "P1_OPEN" },
      { id: "1.5", title: "Fix bad source data and search again", owner: ["LA"], mode: "Manual, only on failure", tatText: "Same day" },
    ],
  },
  {
    n: 2, title: "Automatic classification and transaction selection", built: true,
    steps: [
      { id: "2.1", title: "Classify from Product Name", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "2.2", title: "Financing: Undertaking / Non-Undertaking", owner: ["LA"], mode: "Manual (preview card)", tatText: "Before Open Loan File" },
      { id: "2.3", title: "Financing: ORCR Transferred / Untransferred", owner: ["LA"], mode: "Manual (preview card)", tatText: "Before Open Loan File" },
      { id: "2.4", title: "Mortgage rule", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "2.5", title: "Generate transactions", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "2.6", title: "Auto-confirm, create expected document set, audit", owner: ["SYS"], mode: "Auto", tatKey: "P2_AUTO" },
      { id: "2.7", title: "Override a wrong automatic result, with reason", owner: ["SUP"], mode: "Manual (rare)", tatText: "When needed" },
    ],
  },
  {
    n: 3, title: "Checklist, Document IDs, EDST, cash advance, assign DP", built: true,
    steps: [
      { id: "3.1", title: "Check physical documents against the checklist", owner: ["LA"], mode: "Manual", tatKey: "P3_CHECKLIST" },
      { id: "3.2", title: "Generate Document IDs", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "3.3", title: "For EDST: enter in EDST, record reference", owner: ["LA"], mode: "Manual", tatKey: "P3_EDST" },
      { id: "3.4", title: "Request cash advance if fees need funds", owner: ["LA", "DP"], mode: "Manual", tatKey: "P3_CA" },
      { id: "3.5", title: "Approve and release cash advance", owner: ["FIN"], mode: "Manual", tatKey: "P3_CA_RELEASE" },
      { id: "3.6", title: "Assign to DP (Notary, For Entry PPSR, Mortgage)", owner: ["LA"], mode: "Manual", tatKey: "P3_ASSIGN" },
      { id: "3.7", title: "Notify the DP in-app and by email", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
    ],
  },
  {
    n: 4, title: "DP processing", built: false,
    steps: [
      { id: "4.1", title: "Accept or decline the assignment", owner: ["DP"], mode: "Manual", tatKey: "P4_ACCEPT" },
      { id: "4.2", title: "Notary: send to notary, record details", owner: ["DP"], mode: "Manual", tatKey: "P4_NOTARY" },
      { id: "4.3", title: "For Entry PPSR: registration, number and certificate", owner: ["DP"], mode: "Manual", tatKey: "P4_PPSR" },
      { id: "4.4", title: "Mortgage: LTO drop and pickup of the annotated OR/CR (attempts logged daily; problems shown beside the TAT, the clock keeps running)", owner: ["DP", "LA"], mode: "Manual", tatKey: "P4_MORTGAGE" },
      { id: "4.5", title: "Liquidate the cash advance with receipts", owner: ["DP"], mode: "Manual", tatKey: "P4_LIQUIDATE" },
      { id: "4.6", title: "Forward the package to a named LA", owner: ["DP", "SYS"], mode: "Manual + notify", tatKey: "P4_FORWARD" },
    ],
  },
  {
    n: 5, title: "Branch acceptance and completion", built: false,
    steps: [
      { id: "5.1", title: "Receiving LA scans and records Complete / Incomplete / Other", owner: ["LA"], mode: "Manual", tatKey: "P5_ACCEPT" },
      { id: "5.2", title: "Transaction COMPLETED, DP assignment CLOSED", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "5.3", title: "All complete and CA liquidated: For Vault Transmittal", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "5.4", title: "Follow up overdue cash-advance liquidation", owner: ["FIN"], mode: "Manual", tatText: "Escalates if overdue" },
    ],
  },
  {
    n: 6, title: "Transmittal and vaulting", built: false,
    steps: [
      { id: "6.1", title: "Create transmittal, scan Document IDs, dispatch", owner: ["LA"], mode: "Manual", tatKey: "P6_VAULTED" },
      { id: "6.2", title: "Receive by scan against the manifest", owner: ["VAULT"], mode: "Manual", tatText: "Transit TAT" },
      { id: "6.3", title: "Verify originals, annotation, plate, engine, chassis", owner: ["VAULT"], mode: "Manual", tatKey: "P6_VERIFY" },
      { id: "6.4", title: "Tag, scan location; In Safekeeping", owner: ["VAULT", "SYS"], mode: "Manual + suggest", tatText: "Same day" },
    ],
  },
  {
    n: 7, title: "DigiCur digitization", built: false,
    steps: [
      { id: "7.1", title: "Queue For Scanning", owner: ["SYS"], mode: "Auto", tatText: "Instant" },
      { id: "7.2", title: "Scan with page count; quality check; rescan with reason", owner: ["DIG"], mode: "Manual", tatKey: "P7_DIGICUR" },
      { id: "7.3", title: "Index PN, CIN, document type, Document ID; upload and link", owner: ["DIG", "SYS"], mode: "Manual + auto", tatKey: "P7_DIGICUR" },
      { id: "7.4", title: "Supervisor verifies; all items Verified: DigiCur Completed", owner: ["DIG"], mode: "Manual", tatKey: "P7_DIGICUR" },
    ],
  },
  {
    n: 8, title: "Pull-out and return loop", built: false,
    steps: [
      { id: "8.1", title: "Raise pull-out request (purpose, expected return)", owner: ["LA"], mode: "Manual", tatText: "When needed" },
      { id: "8.2", title: "Approve: internal (Vault Supervisor + Dept Head) or third party (Dept Head + C&M Head)", owner: ["APPR"], mode: "Manual", tatText: "Per approval matrix" },
      { id: "8.3", title: "Vault scans out; receiver signs acknowledgment", owner: ["VAULT"], mode: "Manual", tatText: "Same day" },
      { id: "8.4", title: "Overdue escalation (Dept Head day 7, Compliance day 30)", owner: ["SYS"], mode: "Auto", tatKey: "P8_ESC_DEPT" },
      { id: "8.5", title: "Return: scan in, check condition and pages, back to slot", owner: ["VAULT"], mode: "Manual", tatText: "Same day as return" },
    ],
  },
  {
    n: 9, title: "QA review (any stage)", built: false,
    steps: [
      { id: "9.1", title: "Select accounts by sampling rule, audit plan or event", owner: ["SYS"], mode: "Auto", tatText: "Per audit plan" },
      { id: "9.2", title: "Review documents, trail, digital record; pass or finding", owner: ["QA"], mode: "Manual", tatText: "Per audit plan" },
      { id: "9.3", title: "Corrective action, QA validates, Resolved, Closed", owner: ["QA"], mode: "Manual", tatText: "Finding due date" },
    ],
  },
  {
    n: 10, title: "Closure, archival, retention", built: false,
    steps: [
      { id: "10.1", title: "Detect fully paid / written off / foreclosed via MyLoans", owner: ["SYS"], mode: "Auto", tatText: "On open or Check paid status" },
      { id: "10.2", title: "Mortgage cancellation, PPSR discharge, approve release", owner: ["DP", "APPR"], mode: "Manual", tatText: "Per policy" },
      { id: "10.3", title: "Vault releases originals; borrower acknowledgment with ID", owner: ["VAULT"], mode: "Manual", tatText: "Per policy" },
      { id: "10.4", title: "Archive the file and scan archive location", owner: ["APPR"], mode: "Manual", tatText: "When nothing is open" },
      { id: "10.5", title: "Retention clock per document type (legal hold pauses)", owner: ["SYS"], mode: "Auto", tatText: "Per retention rule" },
      { id: "10.6", title: "Disposal batch, Compliance approval, witnessed destruction", owner: ["APPR"], mode: "Manual", tatText: "Monthly batch" },
    ],
  },
];

export interface JourneyContext {
  stage: Stage | string;
  classification: "FINANCING" | "REFINANCING";
  mortgageResult: "MORTGAGE" | "NOT_MORTGAGE" | "NOT_EVALUATED";
  overridden: boolean;
  openedAt: Date;
  openedBy: string;
  openSourceChange: boolean;
  transactions: { code: string; requiresDp: boolean; status: string; processed: boolean }[];
  cashAdvances: { status: string }[];
  documents: { hasId: boolean; stage: string }[];
  transmittalDispatched: boolean;
  transmittalReceived: boolean;
  /** Latest audit entry per journey step. */
  audit: Map<string, { at: Date; actor: string; simulated: boolean }>;
}

export interface JourneyStep extends StepDef {
  state: StepState;
  who?: string;
  when?: Date;
  note?: string;
  tat: string;
  simulated?: boolean;
}

export interface JourneyPhase extends Omit<PhaseDef, "steps"> {
  steps: JourneyStep[];
  state: "done" | "current" | "upcoming";
}

const stageIdx = (s: string) => STAGES.indexOf(s as Stage);

function tatText(s: StepDef, tats: TatMap): string {
  if (s.tatText) return s.tatText;
  const t = s.tatKey ? tats.get(s.tatKey) : undefined;
  if (!t) return "-";
  if (t.note) return t.note;
  return t.businessDays === 0 ? "Same day" : `${t.businessDays} business day${t.businessDays === 1 ? "" : "s"}`;
}

export function computeJourney(ctx: JourneyContext, tats: TatMap): JourneyPhase[] {
  const live = ctx.transactions.filter((t) => t.status !== "CANCELLED");
  const dp = live.filter((t) => t.requiresDp);
  const has = (code: string) => live.find((t) => t.code === code);
  const past = (t: { status: string }, statuses: string[]) => statuses.includes(t.status);
  const assignedOrLater = ["ASSIGNED", "IN_PROCESS", "FORWARDED", "COMPLETED"];
  const acceptedOrLater = ["IN_PROCESS", "FORWARDED", "COMPLETED"];
  const forwardedOrLater = ["FORWARDED", "COMPLETED"];
  const checklistDone = live.length > 0 && live.every((t) => t.status !== "FOR_CHECKLIST");
  const docsWithId = ctx.documents.filter((d) => d.hasId);
  const caReleased = ctx.cashAdvances.filter((c) => c.status === "RELEASED" || c.status === "LIQUIDATED");

  const typeStep = (code: string): StepState | ((s: StepState) => StepState) => {
    const t = has(code);
    if (!t) return "na";
    return t.processed || past(t, forwardedOrLater) ? "done" : "pending";
  };

  const evaluate: Record<string, () => { state: Exclude<StepState, "current">; note?: string }> = {
    "1.1": () => ({ state: "done" }),
    "1.2": () => ({ state: "done" }),
    "1.3": () => ({ state: "done", note: "Passed" }),
    "1.4": () => ({ state: "done" }),
    "1.5": () => (ctx.openSourceChange ? { state: "pending", note: "Source change flagged" } : { state: "na", note: "Only on failure" }),
    "2.1": () => ({ state: "done" }),
    "2.2": () => (ctx.classification === "FINANCING" ? { state: "done" } : { state: "na", note: "Refinancing" }),
    "2.3": () => (ctx.classification === "FINANCING" ? { state: "done" } : { state: "na", note: "Refinancing" }),
    "2.4": () => (ctx.mortgageResult === "NOT_EVALUATED" ? { state: "na", note: "ORCR Untransferred" } : { state: "done" }),
    "2.5": () => ({ state: "done", note: `${live.length} transactions` }),
    "2.6": () => ({ state: "done" }),
    "2.7": () => (ctx.overridden ? { state: "done" } : { state: "na", note: "Not needed" }),
    "3.1": () => ({ state: checklistDone ? "done" : "pending" }),
    "3.2": () => ({ state: checklistDone ? "done" : "pending" }),
    "3.3": () => {
      const t = has("EDST");
      if (!t) return { state: "na" };
      return { state: t.status === "COMPLETED" ? "done" : "pending" };
    },
    "3.4": () => (ctx.cashAdvances.length ? { state: "done" } : { state: "na", note: "Only if fees need funds" }),
    "3.5": () => {
      if (!ctx.cashAdvances.length) return { state: "na" };
      if (caReleased.length) return { state: "done" };
      if (ctx.cashAdvances.some((c) => c.status === "REQUESTED")) return { state: "pending" };
      return { state: "done", note: "Rejected: No Funds exception" };
    },
    "3.6": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => past(t, assignedOrLater)) ? "done" : "pending" }),
    "3.7": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => past(t, assignedOrLater)) ? "done" : "pending" }),
    "4.1": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => past(t, acceptedOrLater)) ? "done" : "pending" }),
    "4.2": () => ({ state: typeStep("NOTARY") as Exclude<StepState, "current"> }),
    "4.3": () => ({ state: typeStep("PPSR") as Exclude<StepState, "current"> }),
    "4.4": () => ({ state: typeStep("MORTGAGE") as Exclude<StepState, "current"> }),
    "4.5": () => {
      if (!caReleased.length) return { state: "na", note: "No cash advance released" };
      return { state: caReleased.every((c) => c.status === "LIQUIDATED") ? "done" : "pending" };
    },
    "4.6": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => past(t, forwardedOrLater)) ? "done" : "pending" }),
    "5.1": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => t.status === "COMPLETED") ? "done" : "pending" }),
    "5.2": () => (dp.length === 0 ? { state: "na" } : { state: dp.every((t) => t.status === "COMPLETED") ? "done" : "pending" }),
    "5.3": () => ({ state: stageIdx(ctx.stage) >= stageIdx("For Vault Transmittal") ? "done" : "pending" }),
    "5.4": () => ({ state: "na", note: "Only if overdue" }),
    "6.1": () => ({ state: ctx.transmittalDispatched ? "done" : "pending" }),
    "6.2": () => ({ state: ctx.transmittalReceived ? "done" : "pending" }),
    "6.3": () => ({ state: ctx.transmittalReceived ? "done" : "pending" }),
    "6.4": () => ({ state: docsWithId.length > 0 && docsWithId.every((d) => d.stage === "IN_SAFEKEEPING") ? "done" : "pending" }),
  };

  let currentFound = false;
  const phases: JourneyPhase[] = PHASES.map((p) => {
    const steps: JourneyStep[] = p.steps.map((s) => {
      const r = evaluate[s.id]?.() ?? { state: "pending" as const };
      let state: StepState = r.state;
      if (state === "pending" && !currentFound) {
        state = "current";
        currentFound = true;
      }
      const a = ctx.audit.get(s.id);
      const doneWho = state === "done" ? a?.actor ?? (s.owner.includes("SYS") ? "System" : ctx.openedBy) : undefined;
      const doneWhen = state === "done" ? a?.at ?? ctx.openedAt : undefined;
      return { ...s, state, note: r.note, who: doneWho, when: doneWhen, tat: tatText(s, tats), simulated: a?.simulated };
    });
    const allDone = steps.every((s) => s.state === "done" || s.state === "na");
    return { n: p.n, title: p.title, built: p.built, steps, state: allDone ? "done" : steps.some((s) => s.state === "current") ? "current" : "upcoming" };
  });
  return phases;
}
