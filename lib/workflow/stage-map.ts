/**
 * THE stage map: the one place that names the loan-file stages and steps on screen.
 *
 * For every stage: its internal key, the stored key (Loan.stage, see STAGES in ./stage) when the
 * stage exists today, the name shown in the Stage column, the stepper step (1-10, or null for a stage
 * with no step), the Next step text, the owner (tooltip "Waiting for: …"; null for the system: no
 * tooltip) and an internal status:
 *   live     a stored stage a loan can be in today
 *   planned  phase 2, not yet in the app: a definition only. No stored key, no transition, no loan
 *            can be in it. Phase 2 adds the stored key and the transitions.
 * The status is internal: "planned" is never shown on screen.
 *
 * Display only. Which stage a loan is in, and how it moves, stays in ./stage (computeStage) and the
 * services. Every screen, list, tooltip and test that shows a stage name, a step name or a next step
 * reads it from here (lib/workflow/stage-map.test.ts fails when another file defines them).
 * The business's table: docs/workflow/13-stages-and-next-steps.md.
 */
import { STAGES, type Stage } from "./stage";

// ---------------------------------------------------------------------------
// The 10 steps (the loan-file stepper)
// ---------------------------------------------------------------------------

/** The 10 steps of a loan's life. Steps 1 and 2 are done as soon as the file exists; never a stage's step. */
export const STEPS = [
  { n: 1, name: "Loan opened", who: "Loan Associate" },
  { n: 2, name: "Classified", who: "Automatic" },
  { n: 3, name: "Check documents", who: "Loan Associate" },
  { n: 4, name: "DP Processing", who: "Document Processor" },
  { n: 5, name: "LA Acceptance", who: "Loan Associate" },
  { n: 6, name: "Collateral", who: "Collateral" },
  { n: 7, name: "Quality Assurance", who: "Quality Assurance" },
  { n: 8, name: "Digital Records", who: "Digital Records" },
  { n: 9, name: "In Safekeeping", who: "Collateral" },
  { n: 10, name: "Closure", who: "Admin" },
] as const;
export const STEP_COUNT = STEPS.length;

export const stepName = (n: number): string => STEPS[n - 1]?.name ?? "";

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------

export type StageStatus = "live" | "planned";

export interface StageDef {
  /** Internal key: the stored key when the stage exists today, else the planned stage's own key. */
  key: string;
  /** Loan.stage value today; null for a planned stage (phase 2 adds it). */
  stored: Stage | null;
  /** Shown in the Stage column (and wherever a stage name is shown). */
  label: string;
  /** The stepper step (3-10); null: the stage has no step (no highlighted step, its word in grey under the stepper). */
  step: number | null;
  /** For a stage with no step: the steps shown done on the stepper (as today: 10 for archived and disposed). */
  doneThrough?: number;
  /** Next step text. */
  next: string;
  /** Who the next step waits for (tooltip "Waiting for: …"); null for the system (no tooltip). */
  owner: string | null;
  status: StageStatus;
  /** The Journey tab's phase for events at this stage, when it differs from the step (the Journey keeps its old order until phase 2). */
  journeyPhase?: number;
  /** Shown in grey (a stage where nothing more happens). */
  grey?: boolean;
}

const LA = "Loan Associate";
const DP_CM = "Document Processor / Collateral & Mortgage";
const QA = "Quality Assurance";
const DR = "Digital Records";
const AW = "Archival & Warehousing";

/** In the order of the process. */
export const STAGE_MAP: readonly StageDef[] = [
  { key: "Opened", stored: "Opened", label: "Check documents", step: 3, next: "System sets up the transactions", owner: null, status: "live" },
  { key: "For checklist", stored: "For checklist", label: "Check documents", step: 3, next: "Check documents, then assign to DP", owner: LA, status: "live" },
  { key: "No DP assignment required", stored: "No DP assignment required", label: "Check documents (LA only)", step: 3, next: "Complete the LA-only transactions", owner: LA, status: "live" },
  { key: "Assigned to DP", stored: "Assigned to DP", label: "DP Assigning", step: 4, next: "DP accepts the assignment", owner: DP_CM, status: "live" },
  { key: "In process", stored: "In process", label: "LTO Processing", step: 4, next: "DP processes the transactions", owner: DP_CM, status: "live" },
  { key: "LTO Done", stored: null, label: "LTO Done", step: 4, next: "DP forwards the package to the LA branch", owner: "Document Processor", status: "planned" },
  { key: "Awaiting LA acceptance", stored: "Awaiting LA acceptance", label: "Forwarding to LA branch", step: 5, next: "LA accepts the package", owner: "Loan Associate (receiving branch)", status: "live" },
  { key: "For Vault Transmittal", stored: "For Vault Transmittal", label: "For transmittal", step: 6, next: "Create the transmittal", owner: LA, status: "live" },
  // "Receiving" is the same stage as In transit to Vault (no separate Receiving stage).
  { key: "In transit to Vault", stored: "In transit to Vault", label: "Receiving", step: 6, next: "Collateral receives by scan", owner: "Collateral", status: "live" },
  // A request-based side process while in safekeeping, not a step of the main flow (the request and approval come in phase 2).
  { key: "Pull out", stored: null, label: "Pull out", step: null, doneThrough: 6, next: "Pull out request in progress: an approver approves, then a custodian releases", owner: "Approver / Collateral custodian", status: "planned" },
  { key: "Prior to safekeeping", stored: null, label: "Prior to safekeeping", step: 7, next: "QA checks the package before safekeeping", owner: QA, status: "planned" },
  { key: "Thorough Checking", stored: null, label: "Thorough checking", step: 7, next: "QA does the thorough check", owner: QA, status: "planned" },
  // The findings loop, in this order: Notice to Comply, then Notice to Explain, then Notice of Decision.
  { key: "For NTC", stored: null, label: "For NTC", step: 7, next: "LA complies with the Notice to Comply", owner: LA, status: "planned" },
  { key: "For NTE (Quality Assurance)", stored: null, label: "For NTE", step: 7, next: "QA issues the Notice to Explain (the LA can view it)", owner: QA, status: "planned" },
  { key: "For NOD", stored: null, label: "For NOD", step: 7, next: "QA issues the Notice of Decision (the LA can view it)", owner: QA, status: "planned" },
  { key: "Validation", stored: null, label: "Digital validation", step: 8, next: "Digital Records validates the digital copy", owner: DR, status: "planned" },
  { key: "For NTE (Digital Records)", stored: null, label: "For NTE (Digital Records)", step: 8, next: "Digital Records issues the Notice to Explain (the LA can view it)", owner: DR, status: "planned" },
  // In the vault from Digital Records until the loan is fully paid (Journey phase 7 as before).
  { key: "In Safekeeping", stored: "In Safekeeping", label: "In safekeeping", step: 9, journeyPhase: 7, next: "Kept in the vault until the loan is fully paid", owner: "Collateral", status: "live" },
  // The fully paid closure; text and owner kept as the code says today.
  { key: "Closed", stored: "Closed", label: "Closed", step: 10, next: "Records archives the file", owner: "Records", status: "live" },
  // After Closed: only once the loan is fully paid and released.
  { key: "Archiving", stored: null, label: "Archiving", step: 10, next: "Archival & Warehousing uploads the scanned ARF", owner: AW, status: "planned" },
  { key: "Warehousing", stored: null, label: "Warehousing", step: 10, next: "Archival & Warehousing forwards the documents to the warehouse", owner: AW, status: "planned" },
  { key: "Warehoused", stored: null, label: "Warehoused", step: 10, next: "No further steps", owner: null, status: "planned" },
  { key: "Cancelled in MyLoans", stored: "Cancelled in MyLoans", label: "Cancelled in MyLoans", step: null, doneThrough: 2, next: "No further steps", owner: null, status: "live", grey: true },
  { key: "Archived", stored: "Archived", label: "Archived", step: null, doneThrough: 10, next: "Kept until the retention period ends", owner: null, status: "live", grey: true },
  { key: "Disposed", stored: "Disposed", label: "Disposed", step: null, doneThrough: 10, next: "No further steps", owner: null, status: "live", grey: true },
];

/** Next step text of In Safekeeping while an exception is open (as before). */
const OPEN_EXCEPTION_NEXT = "Resolve open exceptions";

const BY_STORED = new Map(STAGE_MAP.filter((d) => d.stored).map((d) => [d.stored as string, d]));
const BY_KEY = new Map(STAGE_MAP.map((d) => [d.key, d]));

/** The entry of a stored stage (or of a planned stage by its key). Undefined for an unknown value. */
export function stageDef(stage: string): StageDef | undefined {
  return BY_STORED.get(stage) ?? BY_KEY.get(stage);
}

/** The name shown for a stage (an unknown value shows as stored). */
export function stageLabel(stage: string): string {
  return stageDef(stage)?.label ?? stage;
}

/** The tooltip for an owner: "Waiting for: …"; none for the system. */
export function ownerTooltip(owner: string | null | undefined): string | undefined {
  return owner ? `Waiting for: ${owner}` : undefined;
}

export interface NextStepText {
  label: string;
  /** Null: the system (no tooltip). */
  owner: string | null;
}

/** The Next step text and its owner. */
export function nextStepFor(stage: string, opts: { hasOpenException?: boolean } = {}): NextStepText {
  const d = stageDef(stage);
  if (!d) return { label: stage, owner: null };
  if (d.key === "In Safekeeping" && opts.hasOpenException) return { label: OPEN_EXCEPTION_NEXT, owner: d.owner };
  return { label: d.next, owner: d.owner };
}

export interface StepperAt {
  /** The highlighted step (3-10), or null for a stage with no step. */
  current: number | null;
  /** Steps 1..doneThrough are done (green). */
  doneThrough: number;
  /** For a stage with no step: its word, shown small and grey under the stepper. */
  word: string | null;
}

/** Where the stepper is for a stage. An unknown value: step 3 (as before). */
export function stepperOf(stage: string): StepperAt {
  const d = stageDef(stage);
  if (!d) return { current: 3, doneThrough: 2, word: null };
  if (d.step === null) return { current: null, doneThrough: d.doneThrough ?? 2, word: d.label };
  return { current: d.step, doneThrough: d.step - 1, word: null };
}

/** The Journey phase (1-10) events at this stage belong to: the step, or the step after the last one done. */
export function journeyPhaseOf(stage: string): number {
  const own = stageDef(stage)?.journeyPhase;
  if (own) return own;
  const s = stepperOf(stage);
  return s.current ?? Math.min(STEP_COUNT, s.doneThrough + 1);
}

/** A loan's place for a list (Loans table, Find a loan): the Stage column text and the step it is at. */
export function listStage(stage: string): { step: number | null; label: string; grey: boolean } {
  const d = stageDef(stage);
  return { step: d?.step ?? null, label: d?.label ?? stage, grey: !!d?.grey };
}

/** Every stored stage (the real list a loan can be in), for checks. */
export const STORED_STAGES: readonly Stage[] = STAGES;
